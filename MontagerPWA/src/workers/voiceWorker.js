/**
 * Web Worker for the voice detection pipeline.
 *
 * Runs the full extract → VAD → embed → cluster pipeline off the main thread
 * so the UI stays responsive.  Communicates via postMessage:
 *
 *   Main → Worker:
 *     { type: 'start', videoSrc, speakerCount }
 *
 *   Worker → Main:
 *     { type: 'progress', msg, pct }
 *     { type: 'result',   segments }
 *     { type: 'error',    message }
 */

import { detectVoices } from '../services/voiceDetection.js'

self.addEventListener('message', async (e) => {
  const { type, videoSrc, speakerCount } = e.data

  if (type !== 'start') return

  try {
    const result = await detectVoices(videoSrc, speakerCount, (msg, pct) => {
      self.postMessage({ type: 'progress', msg, pct })
    })
    self.postMessage({ type: 'result', segments: result.segments })
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) })
  }
})
