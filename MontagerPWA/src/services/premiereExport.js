/**
 * Export project as a Premiere Pro-compatible FCP XML (Final Cut Pro XML).
 *
 * Premiere Pro natively imports FCP XML (File > Import), making this
 * the most universal exchange format. The XML describes:
 *  - A sequence with the video's native resolution & frame rate
 *  - One main video track with clips cropped per speaker
 *  - One audio track with the full audio
 *
 * Each clip references the original media file and applies a crop effect
 * matching the speaker's crop rectangle.
 */

/**
 * @typedef {Object} ExportOptions
 * @property {string} fileName       - Original video file name
 * @property {Array}  directorCuts   - Array of { start, end, speakerId, mode }
 * @property {Array}  speakers       - Array of { id, name, cropRect: [x, y, w, h] }
 * @property {number} videoWidth     - Original video width
 * @property {number} videoHeight    - Original video height
 * @property {number} duration       - Total video duration in seconds
 * @property {number} fps            - Frame rate (default: 30)
 */

/**
 * Generate Premiere-compatible FCP XML.
 * @param {ExportOptions} opts
 * @returns {string} XML string
 */
export function generatePremiereXML(opts) {
  const {
    fileName,
    directorCuts,
    speakers,
    videoWidth,
    videoHeight,
    duration,
    fps = 30,
  } = opts

  if (!directorCuts?.length) {
    throw new Error('No director cuts to export')
  }

  const speakerMap = Object.fromEntries(speakers.map(s => [s.id, s]))
  const timebase = Math.round(fps)
  const ntsc = fps === 29.97 || fps === 23.976 ? 'TRUE' : 'FALSE'

  // Convert seconds to frames
  const toFrames = (sec) => Math.round(sec * timebase)

  const totalFrames = toFrames(duration)
  const fileId = `file-1`
  const clipId = `masterclip-1`

  // Build clip items for the video track
  let videoClipItems = ''
  let audioClipItems = ''

  directorCuts.forEach((cut, i) => {
    const startFrame = toFrames(cut.start)
    const endFrame = toFrames(cut.end)
    const durFrames = endFrame - startFrame
    if (durFrames <= 0) return

    const speaker = cut.mode === 'speaker' ? speakerMap[cut.speakerId] : null

    // Crop filter as Premiere motion effect
    let filterXml = ''
    if (speaker) {
      const [cx, cy, cw, ch] = speaker.cropRect
      // Premiere crop is expressed as percentages from each edge
      const cropLeft = ((cx / videoWidth) * 100).toFixed(2)
      const cropTop = ((cy / videoHeight) * 100).toFixed(2)
      const cropRight = (((videoWidth - cx - cw) / videoWidth) * 100).toFixed(2)
      const cropBottom = (((videoHeight - cy - ch) / videoHeight) * 100).toFixed(2)

      filterXml = `
              <filter>
                <effect>
                  <name>Crop</name>
                  <effectid>crop</effectid>
                  <effectcategory>motion</effectcategory>
                  <effecttype>motion</effecttype>
                  <mediatype>video</mediatype>
                  <parameter authoringApp="PremierePro">
                    <parameterid>left</parameterid>
                    <name>Left</name>
                    <value>${cropLeft}</value>
                  </parameter>
                  <parameter authoringApp="PremierePro">
                    <parameterid>top</parameterid>
                    <name>Top</name>
                    <value>${cropTop}</value>
                  </parameter>
                  <parameter authoringApp="PremierePro">
                    <parameterid>right</parameterid>
                    <name>Right</name>
                    <value>${cropRight}</value>
                  </parameter>
                  <parameter authoringApp="PremierePro">
                    <parameterid>bottom</parameterid>
                    <name>Bottom</name>
                    <value>${cropBottom}</value>
                  </parameter>
                </effect>
              </filter>`
    }

    const speakerName = speaker ? speaker.name : 'Wide'

    videoClipItems += `
            <clipitem id="clipitem-v${i + 1}">
              <name>${escXml(speakerName)} — ${formatTC(cut.start)}–${formatTC(cut.end)}</name>
              <duration>${durFrames}</duration>
              <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
              <start>${startFrame}</start>
              <end>${endFrame}</end>
              <in>${startFrame}</in>
              <out>${endFrame}</out>
              <file id="${fileId}"/>
              ${filterXml}
            </clipitem>`

    audioClipItems += `
            <clipitem id="clipitem-a${i + 1}">
              <name>${escXml(speakerName)} — ${formatTC(cut.start)}–${formatTC(cut.end)}</name>
              <duration>${durFrames}</duration>
              <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
              <start>${startFrame}</start>
              <end>${endFrame}</end>
              <in>${startFrame}</in>
              <out>${endFrame}</out>
              <file id="${fileId}"/>
            </clipitem>`
  })

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>Montager Edit — ${escXml(fileName)}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${timebase}</timebase>
      <ntsc>${ntsc}</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${videoWidth}</width>
            <height>${videoHeight}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${ntsc}</ntsc>
            </rate>
          </samplecharacteristics>
        </format>
        <track>
          ${videoClipItems}
        </track>
      </video>
      <audio>
        <format>
          <samplecharacteristics>
            <samplerate>48000</samplerate>
            <depth>16</depth>
          </samplecharacteristics>
        </format>
        <track>
          ${audioClipItems}
        </track>
      </audio>
    </media>
  </sequence>
  <bin>
    <children>
      <clip id="${clipId}">
        <name>${escXml(fileName)}</name>
        <duration>${totalFrames}</duration>
        <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
        <file id="${fileId}">
          <name>${escXml(fileName)}</name>
          <duration>${totalFrames}</duration>
          <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
          <pathurl>file://localhost/${escXml(fileName)}</pathurl>
          <media>
            <video>
              <samplecharacteristics>
                <width>${videoWidth}</width>
                <height>${videoHeight}</height>
              </samplecharacteristics>
            </video>
            <audio>
              <samplecharacteristics>
                <samplerate>48000</samplerate>
                <depth>16</depth>
              </samplecharacteristics>
            </audio>
          </media>
        </file>
      </clip>
    </children>
  </bin>
</xmeml>`

  return xml
}

/**
 * Download the FCP XML file.
 * @param {ExportOptions} opts
 */
export function exportToPremiereXML(opts) {
  const xml = generatePremiereXML(opts)
  const blob = new Blob([xml], { type: 'application/xml' })
  const baseName = opts.fileName.replace(/\.[^.]+$/, '')
  downloadFile(blob, `${baseName}_montager.xml`)
}

function downloadFile(blob, filename) {
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

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTC(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
