<template>
  <div
    class="app-shell"
    @dragover.prevent="showDrop = true"
    @dragleave.self="showDrop = false"
    @drop.prevent="onDrop"
  >
    <!-- Drop overlay -->
    <div v-if="showDrop" class="drop-overlay">
      <span>Drop video file here</span>
    </div>

    <!-- Title bar -->
    <header class="titlebar">
      <svg class="titlebar-icon" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="4" fill="#0078d4"/>
        <polygon points="12,8 26,16 12,24" fill="#fff"/>
      </svg>
      <span class="titlebar-title">Montager</span>
    </header>

    <!-- Main area -->
    <div class="main-layout">
      <!-- Activity bar (icon strip) -->
      <nav class="activity-bar">
        <button
          class="ab-btn"
          :class="{ active: sidePanelVisible }"
          title="Toggle Explorer"
          @click="sidePanelVisible = !sidePanelVisible"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
        </button>
      </nav>

      <!-- Side panel (resizable, hideable) -->
      <SidePanel
        :visible="sidePanelVisible && !!videoSrc"
        :speakers="sceneData ? sceneData.speakers : []"
        :selectedSpeakerId="selectedSpeakerId"
        :video="videoEl"
        :sceneDetecting="sceneDetecting"
        :sceneProgress="sceneProgress"
        :sceneProgressMsg="sceneProgressMsg"
        :sceneResult="sceneData"
        :voiceDetecting="voiceDetecting"
        :voiceProgress="voiceProgress"
        :voiceProgressMsg="voiceProgressMsg"
        :voiceSegmentCount="voiceSegments.length"
        :uniqueVoiceSpeakers="uniqueVoiceSpeakers"
        :voiceMap="voiceMap"
        :mappedSegments="mappedSegments"
        :hasVoiceSegments="voiceSegments.length > 0"
        :ppOptions="ppOptions"
        :rendering="rendering"
        :renderProgress="renderProgress"
        :renderProgressMsg="renderProgressMsg"
        @hide="sidePanelVisible = false"
        @detect-scenes="runSceneDetection"
        @detect-voices="runVoiceDetection"
        @select-speaker="onSpeakerSelect"
        @update-mapping="onUpdateMapping"
        @update-pp="onUpdatePP"
        @reassign-segment="onReassignSegment"
        @seek="onSeek"
        @render="runRender"
        @export-premiere="runExportPremiere"
      />

      <!-- Editor pane (video + timeline) -->
      <div class="editor-area">
        <!-- Tab bar -->
        <div v-if="videoSrc" class="tab-bar">
          <button class="tab active">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            {{ fileName }}
            <span class="tab-close" @click="closeVideo" title="Close">&times;</span>
          </button>
          <div v-if="directorCuts.length" class="mode-switch">
            <button :class="{ active: !previewMode }" @click="previewMode = false" title="Extended Mode — show crop rectangles">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <rect x="7" y="7" width="4" height="4" rx="0.5" stroke-dasharray="2 1"/>
                <rect x="13" y="13" width="4" height="4" rx="0.5" stroke-dasharray="2 1"/>
              </svg>
              Extended
            </button>
            <button :class="{ active: previewMode }" @click="previewMode = true" title="Preview Mode — show rendered output">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
              Preview
            </button>
          </div>
        </div>

        <!-- Welcome / empty state -->
        <div v-if="!videoSrc" class="welcome">
          <svg class="welcome-logo" viewBox="0 0 80 80">
            <rect width="80" height="80" rx="12" fill="#0078d4" opacity="0.15"/>
            <polygon points="30,20 62,40 30,60" fill="#0078d4"/>
          </svg>
          <h1>Welcome to Montager</h1>
          <p>Open a video file to get started. You can also drag &amp; drop a video anywhere in this window.</p>
          <div style="display:flex;gap:10px">
            <button class="btn btn-primary" @click="openFile">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
              Open Video
            </button>
          </div>
          <div style="margin-top:8px">
            <span style="color:var(--fg-dim);font-size:12px">
              Supports MP4, WebM, MOV, AVI, MKV
            </span>
          </div>
        </div>

        <!-- Video + Timeline layout -->
        <template v-if="videoSrc">
          <!-- Video player -->
          <div class="video-container" ref="videoContainerEl" :class="{ 'preview-mode': previewMode }">
            <video
              ref="videoEl"
              :src="videoSrc"
              :controls="!previewMode"
              :style="previewVideoStyle"
              @loadedmetadata="onMetadata"
              @timeupdate="onTimeUpdate"
              @ended="playing = false"
              @play="playing = true"
              @pause="playing = false"
              @click="onVideoClick"
            />
            <!-- Crop rectangles overlay (hidden in preview mode) -->
            <CropOverlay
              v-if="sceneData && !previewMode"
              :speakers="sceneData.speakers"
              :videoWidth="sceneData.width"
              :videoHeight="sceneData.height"
              :selectedId="selectedSpeakerId"
              :activeCut="activeCut"
              @select="onSpeakerSelect"
              @update="onSpeakerUpdate"
            />
          </div>

          <!-- Timeline panel (below video) -->
          <VoiceTimeline
            v-if="sceneData && voiceSegments.length"
            :speakers="sceneData ? sceneData.speakers : []"
            :mappedSegments="mappedSegments"
            :directorCuts="directorCuts"
            :currentTime="currentTime"
            :duration="duration"
            :activeCut="activeCut"
            @seek="onSeek"
            @update-cut="onUpdateCut"
          />
        </template>
      </div>
    </div>

    <!-- Status bar -->
    <footer class="statusbar">
      <div class="statusbar-section">
        <span v-if="videoSrc">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
        <span v-else>No file open</span>
      </div>
      <div class="statusbar-section">
        <span v-if="videoMeta">{{ videoMeta.width }}×{{ videoMeta.height }}</span>
        <span>Montager PWA</span>
      </div>
    </footer>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="video/*"
      style="display:none"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import SidePanel from './components/SidePanel.vue'
import CropOverlay from './components/CropOverlay.vue'
import VoiceTimeline from './components/VoiceTimeline.vue'
import { detectScenes } from './services/sceneDetection.js'
import { postProcessSegments, DEFAULT_OPTIONS } from './services/segmentPostProcess.js'
import { renderVideo, downloadBlob } from './services/renderService.js'
import { exportToPremiereXML } from './services/premiereExport.js'
import {
  saveVideoFile, loadVideoFile,
  saveSceneData, loadSceneData,
  saveVoiceData, loadVoiceData,
  saveCurrentTime, loadCurrentTime,
  clearAll
} from './services/storage.js'
import { prefetchModels, getModelStatus } from './services/modelManager.js'
import VoiceWorker from './workers/voiceWorker.js?worker'

const videoSrc = ref(null)
const fileName = ref('')
const fileInput = ref(null)
const videoEl = ref(null)
const showDrop = ref(false)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const videoMeta = ref(null)
const sceneData = ref(null)
const selectedSpeakerId = ref(null)
const videoFile = ref(null)
const sidePanelVisible = ref(true)
const previewMode = ref(false)
const videoContainerEl = ref(null)
const containerSize = reactive({ width: 0, height: 0 })
let resizeObserver = null
let restoring = false

// ── Scene detection state ──
const sceneDetecting = ref(false)
const sceneProgress = ref(0)
const sceneProgressMsg = ref('')

// ── Voice detection state ──
const voiceDetecting = ref(false)
const voiceProgress = ref(0)
const voiceProgressMsg = ref('')
const voiceSegments = ref([])
const voiceMap = ref({})
const ppOptions = reactive({ ...DEFAULT_OPTIONS })
const modelsReady = ref(false)
const modelDownloadPct = ref(0)

// ── Render state ──
const rendering = ref(false)
const renderProgress = ref(0)
const renderProgressMsg = ref('')

// ── Computed ──
const uniqueVoiceSpeakers = computed(() => {
  const set = new Set(voiceSegments.value.map(s => s.speakerId))
  return [...set].sort()
})

const mappedSegments = computed(() =>
  voiceSegments.value.map(seg => ({
    ...seg,
    speakerId: voiceMap.value[seg.speakerId] || seg.speakerId
  }))
)

const directorCuts = ref([])
const directorCutsManual = ref(false) // true if user has manually edited cuts

// Auto-recompute director cuts from post-processing when source data changes
watch(
  [mappedSegments, duration, () => ({ ...ppOptions })],
  () => {
    if (!mappedSegments.value.length || !duration.value) {
      directorCuts.value = []
      return
    }
    directorCuts.value = postProcessSegments(mappedSegments.value, duration.value, ppOptions)
    directorCutsManual.value = false
  },
  { immediate: true, deep: true }
)

const activeCut = computed(() => {
  const t = currentTime.value
  return directorCuts.value.find(c => t >= c.start && t < c.end) || null
})

// Preview mode: compute CSS transform to zoom into active cut's crop region
const previewVideoStyle = computed(() => {
  if (!previewMode.value || !sceneData.value) return {}

  const cut = activeCut.value
  if (!cut || cut.mode === 'wide') return {}

  const speaker = sceneData.value.speakers.find(s => s.id === cut.speakerId)
  if (!speaker) return {}

  const [cx, cy, cw, ch] = speaker.cropRect
  const vw = sceneData.value.width
  const vh = sceneData.value.height
  const ctnW = containerSize.width
  const ctnH = containerSize.height
  if (!ctnW || !ctnH || !vw || !vh) return {}

  // Video element displayed size (max-width: 100%, max-height: 100%, won't scale up)
  const displayScale = Math.min(ctnW / vw, ctnH / vh, 1)
  const videoElemW = vw * displayScale
  const videoElemH = vh * displayScale

  // Crop rect in video element CSS pixel space
  const cropElemW = cw * displayScale
  const cropElemH = ch * displayScale
  const cropCenterX = (cx + cw / 2) * displayScale
  const cropCenterY = (cy + ch / 2) * displayScale

  // Zoom to fill the container
  const zoom = Math.min(ctnW / cropElemW, ctnH / cropElemH)

  return {
    transformOrigin: '0 0',
    transform: `translate(${videoElemW / 2}px, ${videoElemH / 2}px) scale(${zoom}) translate(${-cropCenterX}px, ${-cropCenterY}px)`
  }
})

// Auto-select speaker based on active cut
watch(activeCut, (cut) => {
  if (cut && cut.mode === 'speaker' && cut.speakerId) {
    selectedSpeakerId.value = cut.speakerId
  } else if (cut && cut.mode === 'wide') {
    selectedSpeakerId.value = null
  }
})

// Observe video container for resize (needed for preview transform)
watch(videoContainerEl, (el, oldEl) => {
  if (oldEl && resizeObserver) resizeObserver.unobserve(oldEl)
  if (el && resizeObserver) resizeObserver.observe(el)
})

// ── File handling ──
function openFile() { fileInput.value.click() }

function onFileSelected(e) {
  const file = e.target.files[0]
  if (file) loadVideo(file)
  e.target.value = ''
}

function onDrop(e) {
  showDrop.value = false
  const file = e.dataTransfer.files[0]
  if (file && file.type.startsWith('video/')) loadVideo(file)
}

function loadVideo(file) {
  if (videoSrc.value) URL.revokeObjectURL(videoSrc.value)
  videoSrc.value = URL.createObjectURL(file)
  videoFile.value = file
  fileName.value = file.name
  videoMeta.value = null
  currentTime.value = 0
  duration.value = 0
  sceneData.value = null
  selectedSpeakerId.value = null
  voiceSegments.value = []
  voiceMap.value = {}
  saveVideoFile(file).catch(console.error)
}

function closeVideo() {
  if (videoSrc.value) URL.revokeObjectURL(videoSrc.value)
  videoSrc.value = null
  videoFile.value = null
  fileName.value = ''
  videoMeta.value = null
  currentTime.value = 0
  duration.value = 0
  playing.value = false
  sceneData.value = null
  selectedSpeakerId.value = null
  voiceSegments.value = []
  voiceMap.value = {}
  clearAll().catch(console.error)
}

function onMetadata() {
  const v = videoEl.value
  if (!v) return
  duration.value = v.duration
  videoMeta.value = { width: v.videoWidth, height: v.videoHeight }
}

function onTimeUpdate() {
  const v = videoEl.value
  if (!v) return
  currentTime.value = v.currentTime
}

// ── Scene detection ──
async function runSceneDetection() {
  if (!videoEl.value) return
  sceneDetecting.value = true
  sceneProgress.value = 0
  sceneProgressMsg.value = 'Starting…'
  try {
    const data = await detectScenes(videoEl.value, (msg, p) => {
      sceneProgressMsg.value = msg
      sceneProgress.value = p
    })
    sceneData.value = data
    saveSceneData(data).catch(console.error)
  } catch (err) {
    sceneProgressMsg.value = `Error: ${err.message}`
    console.error('Scene detection error:', err)
  } finally {
    sceneDetecting.value = false
  }
}

// ── Voice detection (runs in Web Worker) ──
let voiceWorker = null

function runVoiceDetection() {
  if (!videoSrc.value) return
  voiceDetecting.value = true
  voiceProgress.value = 0
  voiceProgressMsg.value = 'Starting…'
  voiceSegments.value = []
  voiceMap.value = {}

  // Terminate any previous worker
  if (voiceWorker) { voiceWorker.terminate(); voiceWorker = null }

  voiceWorker = new VoiceWorker()
  const speakerCount = sceneData.value ? Math.max(sceneData.value.speakers.length, 2) : 2

  voiceWorker.onmessage = (e) => {
    const { type, msg, pct, segments, message } = e.data
    if (type === 'progress') {
      voiceProgressMsg.value = msg
      voiceProgress.value = pct
    } else if (type === 'result') {
      voiceSegments.value = segments
      initVoiceMapping()
      saveVoiceData({ segments: mappedSegments.value, voiceMap: voiceMap.value }).catch(console.error)
      voiceDetecting.value = false
      voiceWorker.terminate()
      voiceWorker = null
    } else if (type === 'error') {
      voiceProgressMsg.value = `Error: ${message}`
      console.error('Voice detection error:', message)
      voiceDetecting.value = false
      voiceWorker.terminate()
      voiceWorker = null
    }
  }

  voiceWorker.postMessage({ type: 'start', videoSrc: videoSrc.value, speakerCount })
}

function initVoiceMapping() {
  const voices = uniqueVoiceSpeakers.value
  const speakers = sceneData.value ? sceneData.value.speakers : []
  const map = {}
  voices.forEach((v, i) => {
    map[v] = i < speakers.length ? speakers[i].id : v
  })
  voiceMap.value = map
}

// ── Speaker / mapping handlers ──
function onSpeakerSelect(speaker) {
  selectedSpeakerId.value = speaker.id
}

function onSpeakerUpdate({ id, cropRect }) {
  if (!sceneData.value) return
  const speaker = sceneData.value.speakers.find(s => s.id === id)
  if (speaker) {
    speaker.cropRect = cropRect
    sceneData.value = { ...sceneData.value, speakers: [...sceneData.value.speakers] }
    saveSceneData(sceneData.value).catch(console.error)
  }
}

function onUpdateMapping(voiceId, speakerId) {
  voiceMap.value = { ...voiceMap.value, [voiceId]: speakerId }
  saveVoiceData({ segments: mappedSegments.value, voiceMap: voiceMap.value }).catch(console.error)
}

function onUpdatePP(key, value) {
  ppOptions[key] = value
}

function onReassignSegment(index, newSpeakerId) {
  const seg = voiceSegments.value[index]
  if (!seg) return
  voiceSegments.value[index] = { ...seg, speakerId: newSpeakerId }
  voiceSegments.value = [...voiceSegments.value]
  saveVoiceData({ segments: mappedSegments.value, voiceMap: voiceMap.value }).catch(console.error)
}

function onSeek(time) {
  if (videoEl.value) videoEl.value.currentTime = time
}

function onUpdateCut(index, field, value) {
  const cuts = [...directorCuts.value]
  const cut = { ...cuts[index] }
  const minDur = 0.1

  if (field === 'start') {
    // Clamp: can't go before previous cut start + minDur, can't go past own end - minDur
    const minVal = index > 0 ? cuts[index - 1].start + minDur : 0
    const maxVal = cut.end - minDur
    const clamped = Math.max(minVal, Math.min(maxVal, value))
    cut.start = Math.round(clamped * 1000) / 1000
    cuts[index] = cut
    // Adjust previous cut's end to match
    if (index > 0) {
      cuts[index - 1] = { ...cuts[index - 1], end: cut.start }
    }
  } else if (field === 'end') {
    // Clamp: can't go past next cut end - minDur, can't go before own start + minDur
    const minVal = cut.start + minDur
    const maxVal = index < cuts.length - 1 ? cuts[index + 1].end - minDur : (duration.value || Infinity)
    const clamped = Math.max(minVal, Math.min(maxVal, value))
    cut.end = Math.round(clamped * 1000) / 1000
    cuts[index] = cut
    // Adjust next cut's start to match
    if (index < cuts.length - 1) {
      cuts[index + 1] = { ...cuts[index + 1], start: cut.end }
    }
  }

  directorCuts.value = cuts
  directorCutsManual.value = true
}

function onVideoClick() {
  if (!previewMode.value) return
  const v = videoEl.value
  if (!v) return
  if (v.paused) v.play()
  else v.pause()
}

// ── Render (ffmpeg.wasm) ──
async function runRender() {
  if (!videoFile.value || !sceneData.value || !directorCuts.value.length) return
  rendering.value = true
  renderProgress.value = 0
  renderProgressMsg.value = 'Starting…'
  try {
    const blob = await renderVideo({
      videoFile: videoFile.value,
      directorCuts: directorCuts.value,
      speakers: sceneData.value.speakers,
      videoWidth: sceneData.value.width,
      videoHeight: sceneData.value.height,
      onProgress(msg, pct) {
        renderProgressMsg.value = msg
        renderProgress.value = pct
      },
    })
    const baseName = fileName.value.replace(/\.[^.]+$/, '')
    downloadBlob(blob, `${baseName}_montager.mp4`)
    renderProgressMsg.value = 'Done!'
  } catch (err) {
    renderProgressMsg.value = `Error: ${err.message}`
    console.error('Render error:', err)
  } finally {
    rendering.value = false
  }
}

// ── Export to Premiere ──
function runExportPremiere() {
  if (!sceneData.value || !directorCuts.value.length) return
  const fps = videoMeta.value
    ? (videoEl.value?.getVideoPlaybackQuality?.()?.totalVideoFrames > 0
        ? videoEl.value.getVideoPlaybackQuality().totalVideoFrames / duration.value
        : 30)
    : 30
  exportToPremiereXML({
    fileName: fileName.value,
    directorCuts: directorCuts.value,
    speakers: sceneData.value.speakers,
    videoWidth: sceneData.value.width,
    videoHeight: sceneData.value.height,
    duration: duration.value,
    fps: Math.round(fps),
  })
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

onBeforeUnmount(() => {
  if (videoSrc.value) URL.revokeObjectURL(videoSrc.value)
  if (resizeObserver) resizeObserver.disconnect()
  if (voiceWorker) { voiceWorker.terminate(); voiceWorker = null }
})

// ── Save playback position periodically ──
let saveTimeTimer = null
watch(currentTime, (t) => {
  if (restoring) return
  clearTimeout(saveTimeTimer)
  saveTimeTimer = setTimeout(() => {
    saveCurrentTime(t).catch(console.error)
  }, 1000)
})

// ── Restore state on mount ──
onMounted(async () => {
  // Track container size for preview mode transforms
  resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      containerSize.width = entry.contentRect.width
      containerSize.height = entry.contentRect.height
    }
  })
  if (videoContainerEl.value) resizeObserver.observe(videoContainerEl.value)

  // Background-prefetch ML models into OPFS
  prefetchModels((loaded, total) => {
    modelDownloadPct.value = Math.round(loaded / total * 100)
  }).then(() => {
    modelsReady.value = true
  }).catch(err => {
    console.warn('Model prefetch failed (will retry on demand):', err)
  })

  try {
    restoring = true
    const stored = await loadVideoFile()
    if (!stored) { restoring = false; return }

    videoFile.value = stored.file
    fileName.value = stored.fileName
    videoSrc.value = URL.createObjectURL(stored.file)

    const scene = await loadSceneData()
    if (scene) sceneData.value = scene

    const voice = await loadVoiceData()
    if (voice) {
      if (voice.segments && voice.segments.length) {
        voiceSegments.value = voice.segments
      }
      if (voice.voiceMap && Object.keys(voice.voiceMap).length) {
        voiceMap.value = voice.voiceMap
      } else if (voice.segments && voice.segments.length) {
        initVoiceMapping()
      }
    }

    const savedTime = await loadCurrentTime()
    if (savedTime && videoEl.value) {
      videoEl.value.currentTime = savedTime
    } else if (savedTime) {
      const unwatch = watch(videoMeta, () => {
        if (videoEl.value) {
          videoEl.value.currentTime = savedTime
          videoEl.value.pause()
        }
        unwatch()
      })
    }
  } catch (err) {
    console.warn('Failed to restore state:', err)
  } finally {
    restoring = false
  }
})
</script>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ── Mode switch ── */
.mode-switch {
  display: flex;
  align-items: center;
  margin-left: auto;
  gap: 1px;
  padding: 0 8px;
  height: 100%;
}
.mode-switch button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  font-size: 11px;
  font-family: var(--font-family);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mode-switch button:first-child {
  border-radius: 3px 0 0 3px;
}
.mode-switch button:last-child {
  border-radius: 0 3px 3px 0;
  border-left: none;
}
.mode-switch button.active {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.mode-switch button:not(.active):hover {
  background: var(--bg-input);
  color: var(--fg-bright);
}

/* ── Preview mode ── */
.video-container.preview-mode video {
  cursor: pointer;
}
</style>
