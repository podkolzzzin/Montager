/**
 * Speaker embedding via Wespeaker ResNet-34 ONNX model.
 *
 * The model expects 80-dim log-Mel filterbank features and produces a
 * 256-dimensional L2-normalised speaker embedding vector.
 *
 * Public API:
 *   createSpeakerEncoder(modelBuffer)  → SpeakerEncoder
 *   SpeakerEncoder.embed(pcm16k)       → Float32Array(256)
 *   SpeakerEncoder.embedBatch(segments, fullPcm) → Float32Array[]
 */

import * as ort from 'onnxruntime-web'

/* ── Constants ────────────────────────────────────────────── */

const SR         = 16000
const N_MELS     = 80
const FFT_SIZE   = 512
const HOP_LENGTH = 160   // 10 ms @ 16 kHz
const WIN_LENGTH = 400   // 25 ms @ 16 kHz
const EMBED_DIM  = 256

/* ── Public factory ───────────────────────────────────────── */

/**
 * @param {ArrayBuffer} modelBuffer – wespeaker ONNX bytes
 * @returns {Promise<SpeakerEncoder>}
 */
export async function createSpeakerEncoder(modelBuffer) {
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4

  // onnxruntime-web requires Uint8Array (not bare ArrayBuffer) in Workers
  const bytes = modelBuffer instanceof ArrayBuffer
    ? new Uint8Array(modelBuffer) : modelBuffer

  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  // Cache the mel filterbank (computed once)
  const melBank = buildMelFilterBank(N_MELS, FFT_SIZE, SR)
  const window  = buildHannWindow(WIN_LENGTH)

  return new SpeakerEncoder(session, melBank, window)
}

/* ── SpeakerEncoder class ─────────────────────────────────── */

class SpeakerEncoder {
  constructor(session, melBank, window) {
    this._session = session
    this._melBank = melBank
    this._window  = window
  }

  /**
   * Compute a 256-dim speaker embedding from a 16 kHz mono PCM slice.
   * @param {Float32Array} pcm
   * @returns {Promise<Float32Array>}
   */
  async embed(pcm) {
    const fbank = this._computeFbank(pcm)
    if (fbank.length === 0) return new Float32Array(EMBED_DIM)

    const nFrames = fbank.length / N_MELS
    const input = new ort.Tensor('float32', new Float32Array(fbank), [1, nFrames, N_MELS])

    const results = await this._session.run({ feats: input })
    // Model may output under key 'embs' or 'output' — try both
    const out = results.embs || results.output || results[Object.keys(results)[0]]
    const emb = new Float32Array(out.data)

    // L2-normalise
    let norm = 0
    for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < emb.length; i++) emb[i] /= norm

    return emb
  }

  /**
   * Batch-embed multiple segments (more ergonomic for the pipeline).
   *
   * @param {{ start: number, end: number }[]} segments – time spans (seconds)
   * @param {Float32Array}                      fullPcm – the complete 16 kHz waveform
   * @returns {Promise<Float32Array[]>}
   */
  async embedBatch(segments, fullPcm) {
    const embeddings = []
    for (const seg of segments) {
      const startSample = Math.max(0, Math.floor(seg.start * SR))
      const endSample   = Math.min(fullPcm.length, Math.ceil(seg.end * SR))
      const slice = fullPcm.subarray(startSample, endSample)
      embeddings.push(await this.embed(slice))
    }
    return embeddings
  }

  /** Release ONNX session resources. */
  async dispose() {
    await this._session.release()
  }

  /* ── Internal: log-Mel filterbank features ────────────── */

  /**
   * Compute 80-dim log-Mel filterbank features from PCM.
   * Returns a flat Float32Array of shape [nFrames, 80].
   */
  _computeFbank(pcm) {
    if (pcm.length < WIN_LENGTH) return new Float32Array(0)

    const nFrames = 1 + Math.floor((pcm.length - WIN_LENGTH) / HOP_LENGTH)
    const out = new Float32Array(nFrames * N_MELS)
    const fftBuf = new Float64Array(FFT_SIZE)
    const fftIm  = new Float64Array(FFT_SIZE)

    for (let f = 0; f < nFrames; f++) {
      const offset = f * HOP_LENGTH

      // Zero the buffers
      fftBuf.fill(0)
      fftIm.fill(0)

      // Windowed frame → fftBuf
      for (let j = 0; j < WIN_LENGTH; j++) {
        fftBuf[j] = pcm[offset + j] * this._window[j]
      }

      // In-place FFT (Cooley-Tukey radix-2)
      fft(fftBuf, fftIm)

      // Power spectrum (only need first FFT_SIZE/2 + 1 bins)
      const half = FFT_SIZE / 2 + 1
      const ps = new Float64Array(half)
      for (let k = 0; k < half; k++) {
        ps[k] = (fftBuf[k] * fftBuf[k] + fftIm[k] * fftIm[k])
      }

      // Mel filterbank energies → log
      for (let m = 0; m < N_MELS; m++) {
        let energy = 0
        const filters = this._melBank[m]
        for (let b = 0; b < filters.length; b++) {
          energy += filters[b].weight * ps[filters[b].bin]
        }
        out[f * N_MELS + m] = Math.log(Math.max(energy, 1e-10))
      }
    }

    // Per-feature CMVN (mean subtraction)
    for (let m = 0; m < N_MELS; m++) {
      let sum = 0
      for (let f = 0; f < nFrames; f++) sum += out[f * N_MELS + m]
      const mean = sum / nFrames
      for (let f = 0; f < nFrames; f++) out[f * N_MELS + m] -= mean
    }

    return out
  }
}

/* ── Mel filterbank construction ──────────────────────────── */

function buildMelFilterBank(nMels, fftSize, sampleRate) {
  const half = fftSize / 2 + 1
  const fMax = sampleRate / 2
  const melMin = hzToMel(0)
  const melMax = hzToMel(fMax)

  const melPoints = []
  for (let i = 0; i <= nMels + 1; i++) {
    melPoints.push(melToHz(melMin + (melMax - melMin) * i / (nMels + 1)))
  }
  const binPoints = melPoints.map(f => Math.floor((fftSize + 1) * f / sampleRate))

  const bank = []
  for (let m = 0; m < nMels; m++) {
    const filters = []
    for (let k = binPoints[m]; k <= binPoints[m + 2] && k < half; k++) {
      let w = 0
      if (k <= binPoints[m + 1]) {
        w = binPoints[m + 1] === binPoints[m]
          ? 1
          : (k - binPoints[m]) / (binPoints[m + 1] - binPoints[m])
      } else {
        w = binPoints[m + 2] === binPoints[m + 1]
          ? 1
          : (binPoints[m + 2] - k) / (binPoints[m + 2] - binPoints[m + 1])
      }
      if (w > 0) filters.push({ bin: k, weight: w })
    }
    bank.push(filters)
  }
  return bank
}

function hzToMel(hz)  { return 2595 * Math.log10(1 + hz / 700) }
function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1) }

function buildHannWindow(length) {
  const w = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)))
  }
  return w
}

/* ── Cooley-Tukey radix-2 FFT (in-place) ─────────────────── */

function fft(re, im) {
  const N = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]]
    }
  }
  // Butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < halfLen; j++) {
        const tRe = curRe * re[i + j + halfLen] - curIm * im[i + j + halfLen]
        const tIm = curRe * im[i + j + halfLen] + curIm * re[i + j + halfLen]
        re[i + j + halfLen] = re[i + j] - tRe
        im[i + j + halfLen] = im[i + j] - tIm
        re[i + j] += tRe
        im[i + j] += tIm
        const newCurRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = newCurRe
      }
    }
  }
}
