<template>
  <div class="scene-panel">
    <!-- Header -->
    <div class="scene-panel-header">
      <span class="scene-panel-title">Scene Detection</span>
      <button
        v-if="!detecting && !result"
        class="btn btn-primary btn-sm"
        @click="runDetection"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Detect Scenes
      </button>
      <button
        v-if="result"
        class="btn btn-secondary btn-sm"
        @click="runDetection"
      >
        Re-detect
      </button>
    </div>

    <!-- Progress -->
    <div v-if="detecting" class="scene-progress">
      <div class="scene-progress-bar">
        <div class="scene-progress-fill" :style="{ width: pct + '%' }"></div>
      </div>
      <span class="scene-progress-label">{{ progressMsg }}</span>
    </div>

    <!-- Results -->
    <div v-if="result && !detecting" class="scene-results">
      <!-- Stats row -->
      <div class="scene-stats">
        <div class="stat-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          {{ result.speakers.length }} speaker{{ result.speakers.length !== 1 ? 's' : '' }}
        </div>
        <div class="stat-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="20" rx="2"/>
            <line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
          {{ result.sceneChanges.length }} scene change{{ result.sceneChanges.length !== 1 ? 's' : '' }}
        </div>
        <div class="stat-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9-11h2m18 0h2m-3.3-6.7l-1.4 1.4M6.7 17.3l-1.4 1.4m0-13.4l1.4 1.4m10.6 10.6l1.4 1.4"/>
          </svg>
          {{ result.totalFacesDetected }} face detection{{ result.totalFacesDetected !== 1 ? 's' : '' }}
        </div>
      </div>

      <!-- Speakers list with crop previews -->
      <div class="speaker-list">
        <div
          v-for="speaker in result.speakers"
          :key="speaker.id"
          class="speaker-card"
          :class="{ selected: selectedSpeaker === speaker.id }"
          @click="selectSpeaker(speaker)"
        >
          <canvas
            :ref="el => { if (el) speakerCanvases[speaker.id] = el }"
            class="speaker-thumb"
          />
          <div class="speaker-info">
            <span class="speaker-name">{{ speaker.name }}</span>
            <span class="speaker-dims">
              {{ speaker.cropRect[2] }}×{{ speaker.cropRect[3] }}
            </span>
          </div>
        </div>
      </div>

      <!-- Scene changes timeline -->
      <div v-if="result.sceneChanges.length" class="scene-timeline">
        <span class="scene-timeline-label">Scene changes</span>
        <div class="scene-timeline-bar">
          <div
            v-for="(t, i) in result.sceneChanges"
            :key="i"
            class="scene-marker"
            :style="{ left: (t / result.duration * 100) + '%' }"
            :title="'Scene change at ' + formatTime(t)"
            @click="$emit('seek', t)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, nextTick } from 'vue'
import { detectScenes } from '../services/sceneDetection.js'

const props = defineProps({
  video: { type: HTMLVideoElement, default: null },
  restoredData: { type: Object, default: null }
})

const emit = defineEmits(['detected', 'seek', 'speaker-selected'])

const detecting = ref(false)
const progressMsg = ref('')
const pct = ref(0)
const result = ref(null)
const selectedSpeaker = ref(null)
const speakerCanvases = reactive({})

async function runDetection() {
  if (!props.video) return
  detecting.value = true
  result.value = null
  selectedSpeaker.value = null
  pct.value = 0
  progressMsg.value = 'Starting…'

  try {
    const data = await detectScenes(props.video, (msg, p) => {
      progressMsg.value = msg
      pct.value = p
    })
    result.value = data
    emit('detected', data)

    // render crop thumbnails (seek to a good frame first)
    await nextTick()
    await seekAndRenderThumbnails()
  } catch (err) {
    progressMsg.value = `Error: ${err.message}`
    console.error('Scene detection error:', err)
  } finally {
    detecting.value = false
  }
}

function renderThumbnails() {
  if (!result.value || !props.video) return
  const video = props.video
  // If the video hasn't decoded a frame yet, skip — we'll retry via watchers
  if (video.readyState < 2) return
  for (const speaker of result.value.speakers) {
    const canvas = speakerCanvases[speaker.id]
    if (!canvas) continue
    const [sx, sy, sw, sh] = speaker.cropRect
    // draw at a fixed preview size
    canvas.width = 160
    canvas.height = 90
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 160, 90)
  }
}

/**
 * Seek video to a good frame and then render thumbnails.
 * Used after detection finishes and on restore.
 */
async function seekAndRenderThumbnails() {
  if (!result.value || !props.video) return
  const video = props.video

  // Wait until the video has metadata
  if (video.readyState < 1) {
    await new Promise(resolve => {
      video.addEventListener('loadeddata', resolve, { once: true })
    })
  }

  // Seek to ~1s (or 10% for short videos) to get a representative frame
  const targetTime = Math.min(1, video.duration * 0.1)
  if (Math.abs(video.currentTime - targetTime) > 0.2) {
    video.currentTime = targetTime
    await new Promise(resolve => {
      video.addEventListener('seeked', resolve, { once: true })
    })
  }

  // Wait one animation frame so the browser paints the new frame
  await new Promise(resolve => requestAnimationFrame(resolve))

  await nextTick()
  renderThumbnails()
}

function selectSpeaker(speaker) {
  selectedSpeaker.value = speaker.id
  emit('speaker-selected', speaker)
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// re-render thumbnails if video seeks
watch(() => props.video?.currentTime, () => {
  if (result.value) renderThumbnails()
})

// Restore from persisted data
watch(() => props.restoredData, async (data) => {
  if (data && !result.value) {
    result.value = data
    await nextTick()
    await seekAndRenderThumbnails()
  }
}, { immediate: true })
</script>

<style scoped>
.scene-panel {
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 320px;
}

.scene-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.scene-panel-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-dim);
  font-weight: 600;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
}

/* ── Progress ── */
.scene-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scene-progress-bar {
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}
.scene-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.scene-progress-label {
  font-size: 11px;
  color: var(--fg-dim);
}

/* ── Stats ── */
.scene-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--fg);
  background: var(--bg-input);
  padding: 3px 10px;
  border-radius: 12px;
}

/* ── Speaker cards ── */
.speaker-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.speaker-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.speaker-card:hover {
  background: var(--bg-input);
}
.speaker-card.selected {
  border-color: var(--accent);
  background: rgba(0,120,212,0.1);
}
.speaker-thumb {
  width: 160px;
  height: 90px;
  border-radius: 2px;
  background: #000;
}
.speaker-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px;
}
.speaker-name {
  font-size: 12px;
  color: var(--fg);
  font-weight: 500;
}
.speaker-dims {
  font-size: 10px;
  color: var(--fg-dim);
  font-family: var(--font-mono);
}

/* ── Scene timeline ── */
.scene-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scene-timeline-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-dim);
}
.scene-timeline-bar {
  position: relative;
  height: 16px;
  background: var(--bg-input);
  border-radius: 2px;
}
.scene-marker {
  position: absolute;
  top: 0;
  width: 3px;
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
  cursor: pointer;
  transition: background 0.15s;
}
.scene-marker:hover {
  background: var(--bg-button-hover);
}
</style>
