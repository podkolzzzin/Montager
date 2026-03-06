/**
 * Silero VAD wrapper — runs the Silero v5 ONNX model via onnxruntime-web.
 *
 * The model accepts 512-sample (32 ms @ 16 kHz) chunks of mono PCM, each
 * prepended with a 64-sample context buffer (total input: [1, 576]).
 * It carries RNN hidden state across chunks and produces a speech
 * probability in [0, 1] per chunk.
 *
 * Public API:
 *   createSileroVad(modelBuffer)  → SileroVad instance
 *   SileroVad.process(pcm16k)     → Float32Array of per-chunk probabilities
 *   SileroVad.reset()             → reset hidden state + context
 *
 * Segment extraction from probabilities is handled by the caller
 * (voiceDetection.js) so that parameters stay in one place.
 */

import * as ort from 'onnxruntime-web'

const CHUNK       = 512          // samples per model call (32 ms @ 16 kHz)
const CONTEXT     = 64           // context samples prepended (for 16 kHz)
const SR          = 16000n       // model expects this sample rate (BigInt for int64 tensor)
const STATE_DIM   = [2, 1, 128]  // hidden-state shape [2, batch, 128]

/**
 * Create a Silero VAD instance from a pre-loaded ArrayBuffer.
 *
 * @param {ArrayBuffer} modelBuffer  – the silero_vad.onnx bytes
 * @returns {Promise<SileroVad>}
 */
export async function createSileroVad(modelBuffer) {
  // Prefer WASM backend (CPU, works everywhere including Workers)
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4

  // onnxruntime-web requires Uint8Array (not bare ArrayBuffer) in Workers
  const bytes = modelBuffer instanceof ArrayBuffer
    ? new Uint8Array(modelBuffer) : modelBuffer

  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  return new SileroVad(session)
}

class SileroVad {
  /** @param {ort.InferenceSession} session */
  constructor(session) {
    this._session = session
    this.reset()
  }

  /** Reset RNN hidden state and context (call between files). */
  reset() {
    this._state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), STATE_DIM)
    this._sr = new ort.Tensor('int64', BigInt64Array.from([SR]), [])
    this._context = new Float32Array(CONTEXT) // zero-filled initial context
  }

  /**
   * Run VAD over a complete waveform (offline / non-streaming).
   *
   * The Silero VAD v5 model expects each input chunk to be prepended
   * with a context buffer of 64 samples (for 16 kHz), making the actual
   * input tensor shape [1, 576] (= 64 context + 512 new samples).
   *
   * @param {Float32Array} pcm – 16 kHz mono PCM
   * @returns {Promise<Float32Array>} speech probability per CHUNK
   */
  async process(pcm) {
    this.reset()

    const nChunks = Math.floor(pcm.length / CHUNK)
    const probs = new Float32Array(nChunks)
    const inputLen = CONTEXT + CHUNK  // 576 total

    for (let i = 0; i < nChunks; i++) {
      const chunk = pcm.subarray(i * CHUNK, i * CHUNK + CHUNK)

      // Concatenate context + chunk → [1, 576]
      const combined = new Float32Array(inputLen)
      combined.set(this._context, 0)
      combined.set(chunk, CONTEXT)

      const input = new ort.Tensor('float32', combined, [1, inputLen])
      const feeds = { input, state: this._state, sr: this._sr }
      const results = await this._session.run(feeds)

      probs[i] = results.output.data[0]
      this._state = results.stateN

      // Update context: last CONTEXT samples of the combined input
      this._context = combined.slice(combined.length - CONTEXT)

    }

    return probs
  }

  /** Clean up the ONNX session. */
  async dispose() {
    await this._session.release()
  }
}

/* ── Segment extraction from probabilities ───────────────── */

/**
 * Convert per-chunk speech probabilities into time-stamped segments.
 *
 * @param {Float32Array} probs      – one probability per 32 ms chunk
 * @param {object}       [opts]
 * @param {number}       opts.threshold    – speech threshold (default 0.5)
 * @param {number}       opts.minSpeechSec – minimum speech duration in seconds (default 0.25)
 * @param {number}       opts.minSilenceSec – minimum silence to split (default 0.3)
 * @param {number}       opts.padSec       – padding added to each side (default 0.08)
 * @returns {{ start: number, end: number }[]}
 */
export function extractSegmentsFromProbs(probs, opts = {}) {
  const {
    threshold    = 0.5,
    minSpeechSec = 0.25,
    minSilenceSec = 0.3,
    padSec       = 0.08,
  } = opts

  const chunkSec = CHUNK / Number(SR)  // 0.032 s
  const minSpeechChunks = Math.ceil(minSpeechSec / chunkSec)
  const minSilenceChunks = Math.ceil(minSilenceSec / chunkSec)
  const padChunks = Math.ceil(padSec / chunkSec)

  const segments = []
  let segStart = -1
  let silenceRun = 0

  for (let i = 0; i < probs.length; i++) {
    const isSpeech = probs[i] >= threshold

    if (isSpeech) {
      if (segStart === -1) segStart = i
      silenceRun = 0
    } else if (segStart !== -1) {
      silenceRun++
      if (silenceRun >= minSilenceChunks) {
        const endChunk = i - silenceRun
        if (endChunk - segStart >= minSpeechChunks) {
          segments.push({
            start: Math.max(0, (segStart - padChunks) * chunkSec),
            end: Math.min(probs.length * chunkSec, (endChunk + padChunks) * chunkSec),
          })
        }
        segStart = -1
        silenceRun = 0
      }
    }
  }

  // Trailing segment
  if (segStart !== -1) {
    const endChunk = probs.length
    if (endChunk - segStart >= minSpeechChunks) {
      segments.push({
        start: Math.max(0, (segStart - padChunks) * chunkSec),
        end: Math.min(probs.length * chunkSec, (endChunk + padChunks) * chunkSec),
      })
    }
  }

  return segments
}
