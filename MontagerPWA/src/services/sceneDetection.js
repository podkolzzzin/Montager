/**
 * Scene detection service — runs entirely in the browser.
 *
 * 1. Samples frames from a <video> at fixed intervals.
 * 2. Detects faces via TensorFlow.js BlazeFace (short-range) model.
 * 3. Estimates scene changes by pixel-difference between consecutive frames.
 * 4. Clusters detected faces into speakers and builds crop rectangles.
 */

// Lazy-loaded to enable code-splitting (TF.js is ~2 MB)
let tf = null
let faceDetection = null

async function loadTf() {
  if (!tf) {
    tf = await import('@tensorflow/tfjs')
  }
  if (!faceDetection) {
    faceDetection = await import('@tensorflow-models/face-detection')
  }
}

/* ── helpers ─────────────────────────────────────────────── */

/**
 * Draw a video frame onto an off-screen canvas and return its ImageData.
 */
function grabFrame(video, canvas, ctx) {
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Fast pixel-difference metric between two ImageData objects.
 * Returns a value in 0‥1 (fraction of max possible diff).
 */
function frameDiff(a, b) {
  const d1 = a.data
  const d2 = b.data
  const len = d1.length
  let sum = 0
  // sample every 16th pixel (R channel) for speed
  for (let i = 0; i < len; i += 64) {
    sum += Math.abs(d1[i] - d2[i])
  }
  const samples = Math.floor(len / 64)
  return sum / (samples * 255)
}

/**
 * Cluster faces by horizontal position using simple grid partitioning.
 * Returns array of { id, name, bbox, cropRect } objects.
 */
function clusterFaces(allFaces, videoWidth, videoHeight) {
  if (allFaces.length === 0) {
    // fallback: create 2 default speakers (left / right halves)
    return buildDefaultSpeakers(videoWidth, videoHeight, 2)
  }

  // bucket face centres into horizontal bins (~20 % of frame width each)
  const binWidth = videoWidth * 0.20
  const bins = {}

  for (const f of allFaces) {
    const cx = (f.box.xMin + f.box.xMax) / 2
    const binIdx = Math.floor(cx / binWidth)
    if (!bins[binIdx]) bins[binIdx] = []
    bins[binIdx].push(f)
  }

  // merge adjacent bins that are too close
  const sortedKeys = Object.keys(bins).map(Number).sort((a, b) => a - b)
  const mergedGroups = []
  let currentGroup = null
  for (const key of sortedKeys) {
    if (currentGroup && key - currentGroup.lastKey <= 1) {
      currentGroup.faces.push(...bins[key])
      currentGroup.lastKey = key
    } else {
      if (currentGroup) mergedGroups.push(currentGroup.faces)
      currentGroup = { faces: [...bins[key]], lastKey: key }
    }
  }
  if (currentGroup) mergedGroups.push(currentGroup.faces)

  // build speaker data from each cluster
  const speakers = mergedGroups.map((faces, idx) => {
    const xs = faces.map(f => f.box.xMin)
    const ys = faces.map(f => f.box.yMin)
    const xMaxes = faces.map(f => f.box.xMax)
    const yMaxes = faces.map(f => f.box.yMax)

    const xMin = Math.min(...xs)
    const yMin = Math.min(...ys)
    const xMax = Math.max(...xMaxes)
    const yMax = Math.max(...yMaxes)

    const bbox = [
      Math.round(xMin),
      Math.round(yMin),
      Math.round(xMax - xMin),
      Math.round(yMax - yMin)
    ]

    const cx = (xMin + xMax) / 2
    const cy = (yMin + yMax) / 2

    return {
      id: `speaker_${idx + 1}`,
      name: `Speaker ${idx + 1}`,
      bbox,
      cropRect: buildCropRect(cx, cy, videoWidth, videoHeight)
    }
  })

  // sort left-to-right
  speakers.sort((a, b) => a.bbox[0] - b.bbox[0])
  // re-number
  speakers.forEach((s, i) => {
    s.id = `speaker_${i + 1}`
    s.name = `Speaker ${i + 1}`
  })

  return speakers
}

function buildCropRect(cx, cy, vw, vh) {
  let cropW = Math.round(vw * 0.5)
  let cropH = Math.round(cropW * 9 / 16)
  cropW = Math.min(cropW, vw)
  cropH = Math.min(cropH, vh)

  let x = Math.round(cx - cropW / 2)
  let y = Math.round(cy - cropH / 2)
  x = Math.max(0, Math.min(x, vw - cropW))
  y = Math.max(0, Math.min(y, vh - cropH))

  return [x, y, cropW, cropH]
}

function buildDefaultSpeakers(vw, vh, count) {
  const speakers = []
  for (let i = 0; i < count; i++) {
    const cx = (vw / (count + 1)) * (i + 1)
    const cy = vh / 2
    speakers.push({
      id: `speaker_${i + 1}`,
      name: `Speaker ${i + 1}`,
      bbox: [
        Math.round(cx - vw * 0.15),
        Math.round(cy - vh * 0.25),
        Math.round(vw * 0.30),
        Math.round(vh * 0.50)
      ],
      cropRect: buildCropRect(cx, cy, vw, vh)
    })
  }
  return speakers
}

/* ── main API ────────────────────────────────────────────── */

let detectorPromise = null

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await loadTf()
      await tf.setBackend('webgl')
      await tf.ready()
      return faceDetection.createDetector(
        faceDetection.SupportedModels.MediaPipeFaceDetector,
        {
          runtime: 'tfjs',
          maxFaces: 10,
          modelType: 'short'
        }
      )
    })()
  }
  return detectorPromise
}

/**
 * Analyse a loaded <video> element.
 *
 * @param {HTMLVideoElement} video – must have loadedmetadata already fired
 * @param {(msg: string, pct: number) => void} onProgress – progress callback
 * @returns {Promise<{ speakers: object[], sceneChanges: number[] }>}
 */
export async function detectScenes(video, onProgress = () => {}) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const duration = video.duration

  onProgress('Loading face detection model…', 0)
  const detector = await getDetector()
  onProgress('Model loaded, sampling frames…', 5)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  // decide sampling: ~1 frame per second, capped at 60 frames
  const sampleInterval = Math.max(1, duration / 60)
  const sampleTimes = []
  for (let t = 0.5; t < duration; t += sampleInterval) {
    sampleTimes.push(t)
  }

  const allFaces = []
  const sceneChanges = []
  let prevImageData = null

  for (let i = 0; i < sampleTimes.length; i++) {
    const t = sampleTimes[i]
    const pct = 5 + Math.round((i / sampleTimes.length) * 90)
    onProgress(`Analysing frame ${i + 1}/${sampleTimes.length}…`, pct)

    // seek to time
    await seekTo(video, t)
    const imageData = grabFrame(video, canvas, ctx)

    // scene change detection via pixel diff
    if (prevImageData) {
      const diff = frameDiff(prevImageData, imageData)
      if (diff > 0.12) {
        sceneChanges.push(t)
      }
    }
    prevImageData = imageData

    // face detection
    try {
      const faces = await detector.estimateFaces(canvas)
      for (const face of faces) {
        allFaces.push({
          time: t,
          box: face.box
        })
      }
    } catch {
      // skip frame on error
    }
  }

  onProgress('Clustering speakers…', 96)
  const speakers = clusterFaces(allFaces, vw, vh)

  onProgress('Done', 100)

  return {
    width: vw,
    height: vh,
    duration,
    speakers,
    sceneChanges,
    totalFacesDetected: allFaces.length
  }
}

/* ── seek helper ─────────────────────────────────────────── */

function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.1) {
      resolve()
      return
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      // give the renderer a tick to paint the new frame
      requestAnimationFrame(() => resolve())
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}
