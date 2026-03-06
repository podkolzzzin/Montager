/**
 * OPFS-backed model manager.
 *
 * Downloads ONNX model files on first use, stores them in the Origin-Private
 * File System (OPFS) for instant subsequent loads.  Models are fetched lazily
 * when requested, and a background prefetch can warm all models in idle time.
 *
 * OPFS advantages over IndexedDB:
 *  - No per-entry blob-size limit
 *  - Faster random-access reads (memory-mapped by the browser)
 *  - Synchronous access in Web Workers via FileSystemSyncAccessHandle
 */

/* ── Model catalogue ─────────────────────────────────────── */

const MODEL_DIR = 'montager-models'

/**
 * Registry of all ONNX models used by the voice pipeline.
 * `url` is a CDN/public path; `size` is the approximate byte count (for
 * progress reporting — 0 means "unknown").
 */
const MODELS = {
  silero_vad: {
    fileName: 'silero_vad.onnx',
    url: '/models/silero_vad.onnx',
    size: 2_330_000,
  },
  speaker_embedding: {
    fileName: 'wespeaker_en_voxceleb_resnet34.onnx',
    // Hosted at repo root /models/ — served via jsDelivr CDN (25 MB exceeds CF Pages per-file limit)
    url: 'https://cdn.jsdelivr.net/gh/podkolzzzin/Montager@main/models/wespeaker_en_voxceleb_resnet34.onnx',
    size: 26_500_000,
  },
}

/* ── OPFS helpers ────────────────────────────────────────── */

/** Get (or create) the models directory inside OPFS. */
async function getModelsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(MODEL_DIR, { create: true })
}

/** Check whether a file already exists in OPFS. */
async function opfsHas(fileName) {
  try {
    const dir = await getModelsDir()
    await dir.getFileHandle(fileName)
    return true
  } catch {
    return false
  }
}

/** Read a complete file from OPFS as an ArrayBuffer. */
async function opfsRead(fileName) {
  const dir = await getModelsDir()
  const handle = await dir.getFileHandle(fileName)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

/** Write an ArrayBuffer to OPFS. */
async function opfsWrite(fileName, buffer) {
  const dir = await getModelsDir()
  const handle = await dir.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(buffer)
  await writable.close()
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Get a model's ArrayBuffer, downloading (with progress) only if not cached.
 *
 * @param {'silero_vad' | 'segmentation' | 'speaker_embedding'} name
 * @param {(loaded: number, total: number) => void}              [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
export async function getModel(name, onProgress) {
  const meta = MODELS[name]
  if (!meta) throw new Error(`Unknown model: ${name}`)

  // 1. Try OPFS cache
  if (await opfsHas(meta.fileName)) {
    return opfsRead(meta.fileName)
  }

  // 2. Download with streaming progress
  const resp = await fetch(meta.url)
  if (!resp.ok) throw new Error(`Failed to fetch model ${name}: ${resp.status}`)

  const total = Number(resp.headers.get('content-length')) || meta.size
  const reader = resp.body.getReader()
  const chunks = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    if (onProgress) onProgress(loaded, total)
  }

  // Combine chunks
  const buf = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }

  // 3. Persist to OPFS for next time
  await opfsWrite(meta.fileName, buf.buffer)

  return buf.buffer
}

/**
 * Check which models are already cached in OPFS.
 * @returns {Promise<Record<string, boolean>>}
 */
export async function getModelStatus() {
  const status = {}
  for (const [name, meta] of Object.entries(MODELS)) {
    status[name] = await opfsHas(meta.fileName)
  }
  return status
}

/**
 * Total bytes of all models (approximate).
 */
export function totalModelBytes() {
  return Object.values(MODELS).reduce((s, m) => s + m.size, 0)
}

/**
 * Background-prefetch all models that aren't cached yet.
 * Uses requestIdleCallback where available, otherwise setTimeout.
 *
 * @param {(loaded: number, total: number) => void} [onProgress]
 */
export async function prefetchModels(onProgress) {
  const names = Object.keys(MODELS)
  const total = totalModelBytes()
  let loaded = 0

  for (const name of names) {
    const meta = MODELS[name]
    if (await opfsHas(meta.fileName)) {
      loaded += meta.size
      if (onProgress) onProgress(loaded, total)
      continue
    }

    // Yield to the main thread between downloads
    await new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(resolve)
      } else {
        setTimeout(resolve, 50)
      }
    })

    await getModel(name, (segLoaded, segTotal) => {
      if (onProgress) onProgress(loaded + segLoaded, total)
    })
    loaded += meta.size
  }

  if (onProgress) onProgress(total, total)
}

/**
 * Delete all cached models from OPFS (useful for dev / reset).
 */
export async function clearModelCache() {
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry(MODEL_DIR, { recursive: true })
  } catch { /* dir may not exist */ }
}

/**
 * Get the catalogue entry for a model.
 */
export function getModelMeta(name) {
  return MODELS[name] || null
}
