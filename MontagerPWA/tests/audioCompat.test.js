import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAudioCompat, ensurePlayableAudio } from '../src/services/audioCompat.js'

function box(type, ...parts) {
  const payload = Buffer.concat(parts)
  const result = Buffer.alloc(8 + payload.length)
  result.writeUInt32BE(result.length, 0)
  result.write(type, 4, 'ascii')
  payload.copy(result, 8)
  return result
}

function mp4(codec) {
  const tracks = codec ? [box('trak', box('mdia',
    box('hdlr', Buffer.alloc(8), Buffer.from('soun')),
    box('minf', box('stbl', box('stsd', Buffer.alloc(4),
      Buffer.from([0, 0, 0, 1]), box(codec))))))] : []
  return new File([box('ftyp'), box('moov', ...tracks)], 'sample.mp4', { type: 'video/mp4' })
}

function fakeRuntime({ playable = [], codec = null, exitCode = 0, output = [1, 2, 3] } = {}) {
  const state = { commands: [], deleted: [], terminated: false, loads: 0 }
  const runtime = {
    canPlayType: mime => playable.includes(mime) ? 'probably' : '',
    async createFFmpeg() {
      state.loads++
      return {
        on(event, callback) { state.log = callback },
        async writeFile(name) { state.input = name },
        async exec(args) {
          state.commands.push(args)
          if (codec) {
            state.log?.({ message: 'Input #0, matroska, from input:' })
            state.log?.({ message: `Stream #0:1: Audio: ${codec}, 48000 Hz` })
          } else if (args.includes('-hide_banner')) {
            state.log?.({ message: 'Input #0, matroska, from input:' })
          }
          return exitCode
        },
        async readFile() { return Uint8Array.from(output) },
        async deleteFile(name) { state.deleted.push(name) },
        terminate() { state.terminated = true },
      }
    },
  }
  return { runtime, state }
}

test('supported AAC MP4 skips FFmpeg and preserves the original file', async () => {
  const file = mp4('mp4a')
  const { runtime, state } = fakeRuntime({ playable: ['audio/mp4; codecs="mp4a.40.2"'] })
  const result = await checkAudioCompat(file, runtime)
  assert.deepEqual(result, { supported: true, codec: 'mp4a' })
  assert.deepEqual(await ensurePlayableAudio(file, undefined, result, runtime), { file, transcoded: false })
  assert.equal(state.loads, 0)
})

test('MP4 without an audio track needs no conversion', async () => {
  const { runtime, state } = fakeRuntime()
  assert.deepEqual(await checkAudioCompat(mp4(null), runtime), { supported: true, codec: null })
  assert.equal(state.loads, 0)
})

test('unsupported AC-3 audio is converted to AAC while video is copied', async () => {
  const file = mp4('ac-3')
  const { runtime, state } = fakeRuntime()
  const compatibility = await checkAudioCompat(file, runtime)
  assert.deepEqual(compatibility, { supported: false, codec: 'ac-3' })
  const messages = []
  const result = await ensurePlayableAudio(file, msg => messages.push(msg), compatibility, runtime)
  assert.equal(result.transcoded, true)
  assert.equal(result.file.type, 'video/mp4')
  assert.equal(result.file.name, 'sample_aac.mp4')
  assert.deepEqual(Array.from(new Uint8Array(await result.file.arrayBuffer())), [1, 2, 3])
  assert.ok(state.commands[0].includes('copy'))
  assert.ok(state.commands[0].includes('aac'))
  assert.deepEqual(state.deleted, ['audio-compat-output.mp4', 'audio-compat-input.mp4'])
  assert.equal(state.terminated, true)
  assert.equal(messages.at(-1), 'Audio conversion complete')
})

test('unknown container is probed; silent media remains unchanged', async () => {
  const file = new File(['video'], 'sample.mkv', { type: 'video/x-matroska' })
  const { runtime, state } = fakeRuntime()
  assert.deepEqual(await checkAudioCompat(file, runtime), { supported: true, codec: null })
  assert.equal(state.loads, 1)
  assert.equal(state.terminated, true)
})

test('probe recognizes unsupported audio and failed conversion cleans up', async () => {
  const file = new File(['video'], 'sample.mkv', { type: 'video/x-matroska' })
  const { runtime } = fakeRuntime({ codec: 'dts', exitCode: 1 })
  const compatibility = await checkAudioCompat(file, runtime)
  assert.deepEqual(compatibility, { supported: false, codec: 'dts' })
  const conversion = fakeRuntime({ exitCode: 1 })
  await assert.rejects(ensurePlayableAudio(file, undefined, compatibility, conversion.runtime), /FFmpeg exit 1/)
  assert.deepEqual(conversion.state.deleted, ['audio-compat-output.mp4', 'audio-compat-input.mkv'])
  assert.equal(conversion.state.terminated, true)
})
