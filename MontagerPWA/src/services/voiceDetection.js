/**
 * Voice activity detection & speaker diarization — browser-only, ML-powered.
 *
 * Pipeline:
 *   1. Audio extraction via FFmpeg WASM  (unchanged)
 *   2. Silero VAD (ONNX)                → speech segments
 *   3. Wespeaker ResNet-34 (ONNX)       → 256-dim speaker embeddings
 *   4. AHC clustering (cosine distance)  → speaker labels
 *
 * This module is designed to run on the main thread OR inside a Web Worker.
 * When used from a Worker, the caller injects model ArrayBuffers directly
 * instead of going through modelManager (which uses OPFS and may not be
 * available on the main thread in every context).
 */

import { getModel } from './modelManager.js'
import { createSileroVad, extractSegmentsFromProbs } from './sileroVad.js'
import { createSpeakerEncoder } from './speakerEmbedding.js'
import { clusterEmbeddings } from './clustering.js'

const SAMPLE_RATE = 16000

/* ── Public API ─────────────────────────────────────────── */

/**
 * Run the full voice detection + diarization pipeline.
 *
 * Signature is kept compatible with the original so that App.vue,
 * VoiceDetection.vue and VoiceTimeline.vue require no changes.
 *
 * @param {string}   videoSrc     – object URL or path to the video
 * @param {number}   speakerCount – hint from scene detection
 * @param {(msg: string, pct: number) => void} onProgress
 * @returns {Promise<{ segments: { start: number, end: number, speakerId: string }[] }>}
 */
export async function detectVoices(videoSrc, speakerCount = 2, onProgress = () => {}) {
  /* ── Step 1: Extract audio ────────────────────────────── */
  onProgress('Extracting audio from video…', 0)
  const waveform = await extractAudioFromVideo(videoSrc, onProgress)

  /* ── Step 2: Load ML models ───────────────────────────── */
  onProgress('Loading Silero VAD model…', 16)
  const vadBuf = await getModel('silero_vad', (l, t) =>
    onProgress(`Downloading VAD model… ${Math.round(l / t * 100)}%`, 16))

  onProgress('Loading speaker embedding model…', 18)
  const embBuf = await getModel('speaker_embedding', (l, t) =>
    onProgress(`Downloading embedding model… ${Math.round(l / t * 100)}%`, 18))

  /* ── Step 3: Silero VAD ───────────────────────────────── */
  onProgress('Running voice activity detection…', 20)
  const vad = await createSileroVad(vadBuf)
  const probs = await vad.process(waveform)
  await vad.dispose()

  const speechSegments = extractSegmentsFromProbs(probs, {
    threshold: 0.5,
    minSpeechSec: 0.25,
    minSilenceSec: 0.3,
    padSec: 0.08,
  })

  if (speechSegments.length === 0) {
    onProgress('No speech detected', 100)
    return { segments: [] }
  }

  onProgress(`Found ${speechSegments.length} speech segments`, 40)

  /* ── Step 4: Speaker embeddings ───────────────────────── */
  onProgress('Computing speaker embeddings…', 45)
  const encoder = await createSpeakerEncoder(embBuf)
  const embeddings = await encoder.embedBatch(speechSegments, waveform)
  await encoder.dispose()

  /* ── Step 5: Clustering ───────────────────────────────── */
  if (speakerCount < 2 || speechSegments.length < 2) {
    onProgress('Done (single speaker)', 100)
    return {
      segments: speechSegments.map(s => ({
        start: round3(s.start),
        end: round3(s.end),
        speakerId: 'speaker_1',
      }))
    }
  }

  onProgress('Clustering speakers…', 75)
  const { labels, k, method } = clusterEmbeddings(embeddings, {
    hintK: speakerCount,
    threshold: 0.35,
    maxK: Math.min(speakerCount + 2, 10),
  })

  onProgress(`Identified ${k} speakers (${method})`, 90)

  // Map cluster labels → human-readable IDs
  const labelMap = {}
  let nextId = 1
  const segments = speechSegments.map((seg, i) => {
    const lbl = labels[i]
    if (!(lbl in labelMap)) labelMap[lbl] = `speaker_${nextId++}`
    return {
      start: round3(seg.start),
      end: round3(seg.end),
      speakerId: labelMap[lbl],
    }
  })

  // Merge adjacent same-speaker segments with gap ≤ 1s
  const merged = mergeAdjacentSegments(segments, 1.0)

  onProgress('Done', 100)
  return { segments: merged }
}

/* ── Audio extraction via FFmpeg WASM ─────────────────────── */

let ffmpegInstance = null

async function getFFmpeg(onProgress) {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance

  onProgress('Loading FFmpeg…', 2)
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const { toBlobURL } = await import('@ffmpeg/util')

  const ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  ffmpegInstance = ffmpeg
  return ffmpeg
}

async function extractAudioFromVideo(videoSrc, onProgress) {
  const ffmpeg = await getFFmpeg(onProgress)

  onProgress('Reading video file…', 5)
  const response = await fetch(videoSrc)
  const videoData = new Uint8Array(await response.arrayBuffer())

  onProgress('Extracting audio with FFmpeg…', 8)
  await ffmpeg.writeFile('input.video', videoData)

  await ffmpeg.exec([
    '-i', 'input.video',
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'wav',
    'output.wav'
  ])

  const wavData = await ffmpeg.readFile('output.wav')
  await ffmpeg.deleteFile('input.video')
  await ffmpeg.deleteFile('output.wav')

  onProgress('Decoding WAV…', 14)
  const mono = decodeWav(wavData.buffer)

  onProgress('Audio extracted', 15)
  return mono
}

/**
 * Parse a WAV file (PCM s16le or f32le, mono) into Float32Array.
 * Works in Web Workers (no OfflineAudioContext needed).
 */
function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer)

  // Find "fmt " chunk
  let offset = 12 // skip RIFF header
  let audioFormat, numChannels, sampleRate, bitsPerSample
  let dataOffset = -1, dataSize = 0

  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    )
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true)   // 1 = PCM, 3 = IEEE float
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }
    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++ // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error('WAV: data chunk not found')

  const numSamples = dataSize / (bitsPerSample / 8) / numChannels
  const out = new Float32Array(numSamples)

  if (audioFormat === 3 && bitsPerSample === 32) {
    // IEEE 32-bit float
    for (let i = 0; i < numSamples; i++) {
      out[i] = view.getFloat32(dataOffset + i * 4 * numChannels, true)
    }
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    // PCM 16-bit signed
    for (let i = 0; i < numSamples; i++) {
      out[i] = view.getInt16(dataOffset + i * 2 * numChannels, true) / 32768
    }
  } else if (audioFormat === 1 && bitsPerSample === 24) {
    // PCM 24-bit signed
    for (let i = 0; i < numSamples; i++) {
      const byteOff = dataOffset + i * 3 * numChannels
      const val = (view.getUint8(byteOff) | (view.getUint8(byteOff + 1) << 8) | (view.getInt8(byteOff + 2) << 16))
      out[i] = val / 8388608
    }
  } else {
    throw new Error(`WAV: unsupported format ${audioFormat} / ${bitsPerSample}-bit`)
  }

  return out
}

/* ── Utils ────────────────────────────────────────────────── */

function mergeAdjacentSegments(segments, maxGap) {
  if (segments.length <= 1) return segments
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.speakerId === prev.speakerId && cur.start - prev.end <= maxGap) {
      prev.end = cur.end
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

function round3(v) { return Math.round(v * 1000) / 1000 }
