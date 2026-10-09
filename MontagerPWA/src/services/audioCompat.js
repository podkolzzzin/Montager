/** Check the audio track before playback and, when necessary, remux with AAC audio. */

const CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
const MP4_TYPES = new Set(['mp4', 'm4v', 'mov'])
const AUDIO_MIME = {
  mp4a: 'audio/mp4; codecs="mp4a.40.2"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  ac3: 'audio/mp4; codecs="ac-3"',
  'ac-3': 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  'ec-3': 'audio/mp4; codecs="ec-3"',
  alac: 'audio/mp4; codecs="alac"',
  opus: 'audio/webm; codecs="opus"',
  Opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/webm; codecs="vorbis"',
  mp3: 'audio/mpeg',
  '.mp3': 'audio/mpeg',
  flac: 'audio/flac',
  fLaC: 'audio/flac',
}
const MP4_AUDIO_MIME = {
  ...AUDIO_MIME,
  opus: 'audio/mp4; codecs="Opus"',
  Opus: 'audio/mp4; codecs="Opus"',
  vorbis: 'audio/mp4; codecs="vorbis"',
  mp3: 'audio/mp4; codecs="mp3"',
  '.mp3': 'audio/mp4; codecs="mp3"',
  flac: 'audio/mp4; codecs="fLaC"',
  fLaC: 'audio/mp4; codecs="fLaC"',
}

const defaultRuntime = {
  canPlayType: mime => document.createElement('audio').canPlayType(mime),
  async createFFmpeg() {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'), import('@ffmpeg/util'),
    ])
    const ff = new FFmpeg()
    await ff.load({
      coreURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    return ff
  },
}

function boxes(view, start, end) {
  const result = []
  for (let pos = start; pos + 8 <= end;) {
    let size = view.getUint32(pos)
    const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + pos + 4, 4))
    let header = 8
    if (size === 1) {
      if (pos + 16 > end) break
      const high = view.getUint32(pos + 8)
      const low = view.getUint32(pos + 12)
      size = high * 2 ** 32 + low
      header = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (!Number.isSafeInteger(size) || size < header || pos + size > end) break
    result.push({ type, start: pos + header, end: pos + size })
    pos += size
  }
  return result
}

function child(view, parent, type) {
  return boxes(view, parent.start, parent.end).find(box => box.type === type)
}

function fourCC(view, pos) {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + pos, 4))
}

/** Returns null for silent MP4 files, or the audio sample entry code. */
function mp4AudioCodec(buffer) {
  const view = new DataView(buffer)
  const moov = boxes(view, 0, view.byteLength).find(box => box.type === 'moov')
  if (!moov) throw new Error('MP4 metadata is missing')
  for (const trak of boxes(view, moov.start, moov.end).filter(box => box.type === 'trak')) {
    const mdia = child(view, trak, 'mdia')
    const hdlr = mdia && child(view, mdia, 'hdlr')
    if (!hdlr || hdlr.start + 12 > hdlr.end || fourCC(view, hdlr.start + 8) !== 'soun') continue
    const minf = child(view, mdia, 'minf')
    const stbl = minf && child(view, minf, 'stbl')
    const stsd = stbl && child(view, stbl, 'stsd')
    if (!stsd || stsd.start + 16 > stsd.end) throw new Error('MP4 audio sample description is missing')
    return fourCC(view, stsd.start + 12)
  }
  return null
}

async function inspectMp4(file) {
  let pos = 0
  while (pos + 8 <= file.size) {
    const header = new DataView(await file.slice(pos, pos + 16).arrayBuffer())
    let size = header.getUint32(0)
    const type = fourCC(header, 4)
    if (size === 1) {
      if (header.byteLength < 16) break
      size = header.getUint32(8) * 2 ** 32 + header.getUint32(12)
    } else if (size === 0) size = file.size - pos
    if (!Number.isSafeInteger(size) || size < 8 || pos + size > file.size) break
    if (type === 'moov') return mp4AudioCodec(await file.slice(pos, pos + size).arrayBuffer())
    pos += size
  }
  throw new Error('MP4 metadata is missing')
}

function inputName(file) {
  const extension = file.name?.match(/\.[a-z0-9]+$/i)?.[0] || '.video'
  return `audio-compat-input${extension}`
}

async function withFFmpeg(file, runtime, task) {
  const ff = await runtime.createFFmpeg()
  const name = inputName(file)
  try {
    await ff.writeFile(name, new Uint8Array(await file.arrayBuffer()))
    return await task(ff, name)
  } finally {
    await ff.deleteFile(name).catch(() => {})
    ff.terminate()
  }
}

async function probeAudioCodec(file, runtime) {
  return withFFmpeg(file, runtime, async (ff, name) => {
    const lines = []
    ff.on('log', ({ message }) => lines.push(message))
    await ff.exec(['-hide_banner', '-i', name, '-t', '0', '-f', 'null', '-'])
    const log = lines.join('\n')
    if (!/Input #\d+/.test(log)) throw new Error('Unable to inspect the video audio track')
    const match = log.match(/Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^)]*\))?: Audio: ([\w-]+)/)
    return match?.[1] ?? null
  })
}

/** @returns {Promise<{supported: boolean, codec: string|null}>} */
export async function checkAudioCompat(file, runtime = defaultRuntime) {
  if (!file || typeof file.slice !== 'function') throw new TypeError('A video File is required')
  const extension = file.name?.split('.').pop()?.toLowerCase()
  const isMp4 = MP4_TYPES.has(extension) || file.type === 'video/mp4'
  const codec = isMp4
    ? await inspectMp4(file)
    : await probeAudioCodec(file, runtime)
  if (!codec) return { supported: true, codec: null }
  const mime = (isMp4 ? MP4_AUDIO_MIME : AUDIO_MIME)[codec]
  return { supported: !!mime && !!runtime.canPlayType(mime), codec }
}

/** @returns {Promise<{file: File, transcoded: boolean}>} */
export async function ensurePlayableAudio(file, onProgress, compatibility, runtime = defaultRuntime) {
  const result = compatibility ?? await checkAudioCompat(file, runtime)
  if (result.supported) return { file, transcoded: false }

  onProgress?.(`Converting ${result.codec || 'audio'} to AAC…`)
  return withFFmpeg(file, runtime, async (ff, name) => {
    const output = 'audio-compat-output.mp4'
    try {
      const exitCode = await ff.exec([
        '-i', name, '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', output,
      ])
      if (exitCode !== 0) throw new Error(`Audio conversion failed (FFmpeg exit ${exitCode})`)
      const bytes = await ff.readFile(output)
      if (!bytes.length) throw new Error('Audio conversion produced an empty file')
      onProgress?.('Audio conversion complete')
      const base = file.name?.replace(/\.[^.]+$/, '') || 'video'
      return { file: new File([bytes], `${base}_aac.mp4`, { type: 'video/mp4' }), transcoded: true }
    } finally {
      await ff.deleteFile(output).catch(() => {})
    }
  })
}
