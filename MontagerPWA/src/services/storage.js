/**
 * Persistent storage service using IndexedDB.
 *
 * Stores:
 *  - Video file blob  (large — IndexedDB is ideal)
 *  - Scene detection data (JSON)
 *  - Voice detection data (JSON)
 *  - UI state (selected speaker, file name, etc.)
 */

const DB_NAME = 'montager'
const DB_VERSION = 1
const STORE = 'state'

/* ── open DB ──────────────────────────────────────────────── */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/* ── generic get / set / delete ───────────────────────────── */

async function dbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbSet(key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function dbDelete(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function dbClear() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/* ── high-level API ───────────────────────────────────────── */

const KEYS = {
  VIDEO_BLOB: 'videoBlob',
  FILE_NAME: 'fileName',
  FILE_TYPE: 'fileType',
  SCENE_DATA: 'sceneData',
  VOICE_DATA: 'voiceData',
  CURRENT_TIME: 'currentTime'
}

/**
 * Save the video file to IndexedDB.
 */
export async function saveVideoFile(file) {
  // Store as Blob (works even for huge files in IndexedDB)
  await dbSet(KEYS.VIDEO_BLOB, file)
  await dbSet(KEYS.FILE_NAME, file.name)
  await dbSet(KEYS.FILE_TYPE, file.type)
}

/**
 * Load the video file from IndexedDB.
 * Returns { blob, fileName } or null if nothing stored.
 */
export async function loadVideoFile() {
  const blob = await dbGet(KEYS.VIDEO_BLOB)
  if (!blob) return null
  const fileName = await dbGet(KEYS.FILE_NAME) || 'video'
  const fileType = await dbGet(KEYS.FILE_TYPE) || 'video/mp4'
  // Reconstruct a File so it has .name
  const file = new File([blob], fileName, { type: fileType })
  return { file, fileName }
}

/**
 * Save scene detection results.
 */
export async function saveSceneData(data) {
  await dbSet(KEYS.SCENE_DATA, JSON.parse(JSON.stringify(data)))
}

/**
 * Load scene detection results. Returns object or null.
 */
export async function loadSceneData() {
  return await dbGet(KEYS.SCENE_DATA) || null
}

/**
 * Save voice detection results.
 */
export async function saveVoiceData(data) {
  await dbSet(KEYS.VOICE_DATA, JSON.parse(JSON.stringify(data)))
}

/**
 * Load voice detection results. Returns object or null.
 */
export async function loadVoiceData() {
  return await dbGet(KEYS.VOICE_DATA) || null
}

/**
 * Save current playback time.
 */
export async function saveCurrentTime(time) {
  await dbSet(KEYS.CURRENT_TIME, time)
}

/**
 * Load saved playback time. Returns number or 0.
 */
export async function loadCurrentTime() {
  return (await dbGet(KEYS.CURRENT_TIME)) || 0
}

/**
 * Clear all stored state (on close video).
 */
export async function clearAll() {
  await dbClear()
}
