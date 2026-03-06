/**
 * Render the final montage video using ffmpeg.wasm.
 *
 * Uses the same approach as the .NET RenderService:
 * for each director cut, crop to the speaker's rect (or keep wide),
 * then concatenate all segments into a single output.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg = null

/**
 * Ensure ffmpeg is loaded (singleton).
 * @param {(msg: string, pct: number) => void} onProgress
 */
async function ensureFFmpeg(onProgress) {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg

  ffmpeg = new FFmpeg()

  ffmpeg.on('log', ({ message }) => {
    // Optionally forward logs
    // console.log('[ffmpeg]', message)
  })

  ffmpeg.on('progress', ({ progress, time }) => {
    const pct = Math.min(100, Math.round(progress * 100))
    onProgress?.(`Encoding… ${pct}%`, pct)
  })

  onProgress?.('Loading ffmpeg…', 0)

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  return ffmpeg
}

/**
 * @typedef {Object} RenderOptions
 * @property {File}   videoFile      - Original video file
 * @property {Array}  directorCuts   - Array of { start, end, speakerId, mode }
 * @property {Array}  speakers       - Array of { id, cropRect: [x, y, w, h] }
 * @property {number} videoWidth     - Original video width
 * @property {number} videoHeight    - Original video height
 * @property {number} outputWidth    - Output width (default: 1080)
 * @property {number} outputHeight   - Output height (default: 1920)
 * @property {(msg: string, pct: number) => void} onProgress
 */

/**
 * Render the montage video.
 * @param {RenderOptions} opts
 * @returns {Promise<Blob>} The rendered video as a Blob
 */
export async function renderVideo(opts) {
  const {
    videoFile,
    directorCuts,
    speakers,
    videoWidth,
    videoHeight,
    outputWidth = 1080,
    outputHeight = 1920,
    onProgress,
  } = opts

  if (!directorCuts?.length) {
    throw new Error('No director cuts to render')
  }

  const ff = await ensureFFmpeg(onProgress)

  // Write input video to ffmpeg virtual FS
  onProgress?.('Loading video into memory…', 5)
  const inputName = 'input' + getExtension(videoFile.name)
  await ff.writeFile(inputName, await fetchFile(videoFile))

  // Build the filter complex
  const speakerMap = Object.fromEntries(speakers.map(s => [s.id, s]))
  const filterParts = []
  const segLabels = []

  for (let i = 0; i < directorCuts.length; i++) {
    const cut = directorCuts[i]
    const dur = cut.end - cut.start
    if (dur <= 0) continue

    const speaker = cut.mode === 'speaker' ? speakerMap[cut.speakerId] : null
    const label = `seg${i}`

    if (speaker) {
      const [cx, cy, cw, ch] = speaker.cropRect
      // Crop then scale to output size
      filterParts.push(
        `[0:v]trim=${cut.start}:${cut.end},setpts=PTS-STARTPTS,` +
        `crop=${cw}:${ch}:${cx}:${cy},` +
        `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:-1:-1,setsar=1[${label}]`
      )
    } else {
      // Wide shot — scale to fit output
      filterParts.push(
        `[0:v]trim=${cut.start}:${cut.end},setpts=PTS-STARTPTS,` +
        `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:-1:-1,setsar=1[${label}]`
      )
    }
    segLabels.push(`[${label}]`)
  }

  // Audio segments
  const audioLabels = []
  for (let i = 0; i < directorCuts.length; i++) {
    const cut = directorCuts[i]
    const dur = cut.end - cut.start
    if (dur <= 0) continue
    const label = `aseg${i}`
    filterParts.push(
      `[0:a]atrim=${cut.start}:${cut.end},asetpts=PTS-STARTPTS[${label}]`
    )
    audioLabels.push(`[${label}]`)
  }

  // Concatenate all segments
  const n = segLabels.length
  const concatInput = segLabels.map((v, i) => v + audioLabels[i]).join('')
  filterParts.push(`${concatInput}concat=n=${n}:v=1:a=1[outv][outa]`)

  const filterComplex = filterParts.join(';')

  onProgress?.('Rendering…', 10)

  const outputName = 'output.mp4'
  await ff.exec([
    '-i', inputName,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputName,
  ])

  onProgress?.('Reading output…', 95)
  const data = await ff.readFile(outputName)

  // Clean up
  await ff.deleteFile(inputName).catch(() => {})
  await ff.deleteFile(outputName).catch(() => {})

  onProgress?.('Done!', 100)
  return new Blob([data.buffer], { type: 'video/mp4' })
}

function getExtension(filename) {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i) : '.mp4'
}

/**
 * Trigger browser download of a Blob.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }, 100)
}
