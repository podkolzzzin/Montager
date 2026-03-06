<template>
  <div
    v-show="visible"
    class="side-panel"
    :style="{ width: panelWidth + 'px' }"
  >
    <!-- Resize handle -->
    <div class="sp-resize-handle" @pointerdown="onResizeStart" />

    <div class="sp-content">
      <!-- Panel header -->
      <div class="sp-header">
        <span class="sp-title">Explorer</span>
        <button class="sp-close-btn" title="Close panel" @click="$emit('hide')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Scene detection controls -->
      <details class="sp-section" open>
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          Scene Detection
        </summary>
        <div class="sp-section-body">
          <div class="sp-row" v-if="!sceneDetecting && !sceneResult">
            <button class="btn btn-primary btn-sm btn-block" @click="$emit('detect-scenes')">
              Detect Scenes
            </button>
          </div>
          <div class="sp-row" v-if="sceneResult && !sceneDetecting">
            <button class="btn btn-secondary btn-sm" @click="$emit('detect-scenes')">
              Re-detect
            </button>
          </div>
          <!-- Progress -->
          <div v-if="sceneDetecting" class="sp-progress">
            <div class="sp-progress-bar">
              <div class="sp-progress-fill" :style="{ width: sceneProgress + '%' }"></div>
            </div>
            <span class="sp-progress-label">{{ sceneProgressMsg }}</span>
          </div>
          <!-- Stats -->
          <div v-if="sceneResult" class="sp-stats">
            <span class="stat-mini">{{ sceneResult.speakers.length }} speakers</span>
            <span class="stat-mini">{{ sceneResult.sceneChanges.length }} scene changes</span>
            <span class="stat-mini">{{ sceneResult.totalFacesDetected }} faces</span>
          </div>
        </div>
      </details>

      <!-- Speakers list -->
      <details v-if="speakers.length" class="sp-section" open>
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Speakers ({{ speakers.length }})
        </summary>
        <div class="sp-section-body">
          <div class="sp-speaker-list">
            <div
              v-for="speaker in speakers"
              :key="speaker.id"
              class="sp-speaker-card"
              :class="{ selected: selectedSpeakerId === speaker.id }"
              @click="$emit('select-speaker', speaker)"
            >
              <canvas
                :ref="el => { if (el) speakerCanvases[speaker.id] = el }"
                class="sp-speaker-thumb"
              />
              <div class="sp-speaker-info">
                <span class="sp-speaker-name">{{ speaker.name }}</span>
                <span class="sp-speaker-dims">{{ speaker.cropRect[2] }}×{{ speaker.cropRect[3] }}</span>
              </div>
            </div>
          </div>
        </div>
      </details>

      <!-- Voice detection controls -->
      <details v-if="speakers.length" class="sp-section" open>
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2"/>
          </svg>
          Voice Detection
        </summary>
        <div class="sp-section-body">
          <div class="sp-row" v-if="!voiceDetecting && !hasVoiceSegments">
            <button class="btn btn-primary btn-sm btn-block" @click="$emit('detect-voices')">
              Detect Voices
            </button>
          </div>
          <div class="sp-row" v-if="hasVoiceSegments && !voiceDetecting">
            <button class="btn btn-secondary btn-sm" @click="$emit('detect-voices')">
              Re-detect
            </button>
          </div>
          <!-- Progress -->
          <div v-if="voiceDetecting" class="sp-progress">
            <div class="sp-progress-bar">
              <div class="sp-progress-fill" :style="{ width: voiceProgress + '%' }"></div>
            </div>
            <span class="sp-progress-label">{{ voiceProgressMsg }}</span>
          </div>
          <!-- Stats -->
          <div v-if="hasVoiceSegments" class="sp-stats">
            <span class="stat-mini">{{ voiceSegmentCount }} segments</span>
            <div class="stat-mini" v-for="uid in uniqueVoiceSpeakers" :key="uid">
              <span class="speaker-dot-sm" :style="{ background: speakerColor(uid) }"></span>
              {{ speakerLabel(uid) }}
            </div>
          </div>
        </div>
      </details>

      <!-- Voice → Speaker mapping -->
      <details v-if="hasVoiceSegments" class="sp-section" open>
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M5 12h14m-4-4l4 4-4 4"/>
          </svg>
          Voice → Speaker Mapping
        </summary>
        <div class="sp-section-body">
          <div class="sp-mapping-grid">
            <div
              v-for="voice in uniqueVoiceSpeakers"
              :key="voice"
              class="sp-mapping-row"
            >
              <span class="sp-mapping-voice">
                <span class="speaker-dot-sm" :style="{ background: speakerColor(voice) }"></span>
                Voice {{ voiceIndex(voice) }}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="sp-mapping-arrow">
                <path d="M5 12h14m-4-4l4 4-4 4"/>
              </svg>
              <select
                class="sp-select"
                :value="voiceMap[voice] || voice"
                @change="$emit('update-mapping', voice, $event.target.value)"
              >
                <option v-for="sp in speakers" :key="sp.id" :value="sp.id">
                  {{ sp.name }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </details>

      <!-- Director's Cut Settings -->
      <details v-if="hasVoiceSegments" class="sp-section">
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          Editor Settings
        </summary>
        <div class="sp-section-body">
          <label class="sp-setting">
            <span>Merge gap tolerance</span>
            <div class="sp-setting-row">
              <input type="range" min="0.5" max="4" step="0.25" :value="ppOptions.mergeGap" @input="$emit('update-pp', 'mergeGap', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.mergeGap }}s</span>
            </div>
          </label>
          <label class="sp-setting">
            <span>Backchannel filter</span>
            <div class="sp-setting-row">
              <input type="range" min="0" max="3" step="0.2" :value="ppOptions.backchannelMax" @input="$emit('update-pp', 'backchannelMax', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.backchannelMax }}s</span>
            </div>
          </label>
          <label class="sp-setting">
            <span>Min hold time</span>
            <div class="sp-setting-row">
              <input type="range" min="0.5" max="5" step="0.25" :value="ppOptions.minHoldTime" @input="$emit('update-pp', 'minHoldTime', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.minHoldTime }}s</span>
            </div>
          </label>
          <label class="sp-setting">
            <span>Reaction delay</span>
            <div class="sp-setting-row">
              <input type="range" min="0" max="1.5" step="0.1" :value="ppOptions.reactionDelay" @input="$emit('update-pp', 'reactionDelay', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.reactionDelay }}s</span>
            </div>
          </label>
          <label class="sp-setting">
            <span>Wide shot silence gap</span>
            <div class="sp-setting-row">
              <input type="range" min="1" max="10" step="0.5" :value="ppOptions.wideGapThreshold" @input="$emit('update-pp', 'wideGapThreshold', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.wideGapThreshold }}s</span>
            </div>
          </label>
          <label class="sp-setting">
            <span>Breather interval (0=off)</span>
            <div class="sp-setting-row">
              <input type="range" min="0" max="120" step="5" :value="ppOptions.breatherInterval" @input="$emit('update-pp', 'breatherInterval', +$event.target.value)" class="sp-range" />
              <span class="sp-value">{{ ppOptions.breatherInterval ? ppOptions.breatherInterval + 's' : 'off' }}</span>
            </div>
          </label>
        </div>
      </details>

      <!-- Export section -->
      <details v-if="hasVoiceSegments" class="sp-section" open>
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export
        </summary>
        <div class="sp-section-body">
          <div class="sp-export-btns">
            <button
              class="btn btn-primary btn-sm btn-block"
              :disabled="rendering"
              @click="$emit('render')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
              {{ rendering ? 'Rendering…' : 'Render Video' }}
            </button>
            <button
              class="btn btn-secondary btn-sm btn-block"
              :disabled="rendering"
              @click="$emit('export-premiere')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="3" width="20" height="18" rx="2"/>
                <text x="6" y="16" font-size="10" fill="currentColor" stroke="none" font-weight="bold">Pr</text>
              </svg>
              Export to Premiere
            </button>
          </div>
          <!-- Render progress -->
          <div v-if="rendering" class="sp-progress">
            <div class="sp-progress-bar">
              <div class="sp-progress-fill" :style="{ width: renderProgress + '%' }"></div>
            </div>
            <span class="sp-progress-label">{{ renderProgressMsg }}</span>
          </div>
        </div>
      </details>

      <!-- Segment list -->
      <details v-if="hasVoiceSegments" class="sp-section">
        <summary class="sp-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          Segments ({{ voiceSegmentCount }})
        </summary>
        <div class="sp-section-body">
          <div class="sp-segment-list">
            <div
              v-for="(seg, i) in mappedSegments"
              :key="i"
              class="sp-segment-row"
              @click="$emit('seek', seg.start)"
            >
              <span class="sp-segment-time">{{ fmt(seg.start) }}–{{ fmt(seg.end) }}</span>
              <select
                class="sp-select sp-select-sm"
                :value="seg.speakerId"
                @click.stop
                @change="$emit('reassign-segment', i, $event.target.value)"
              >
                <option v-for="sp in speakers" :key="sp.id" :value="sp.id">
                  {{ sp.name }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, nextTick } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: true },
  speakers: { type: Array, default: () => [] },
  selectedSpeakerId: { type: String, default: null },
  video: { type: Object, default: null },
  // Scene detection state
  sceneDetecting: { type: Boolean, default: false },
  sceneProgress: { type: Number, default: 0 },
  sceneProgressMsg: { type: String, default: '' },
  sceneResult: { type: Object, default: null },
  // Voice detection state
  voiceDetecting: { type: Boolean, default: false },
  voiceProgress: { type: Number, default: 0 },
  voiceProgressMsg: { type: String, default: '' },
  voiceSegmentCount: { type: Number, default: 0 },
  uniqueVoiceSpeakers: { type: Array, default: () => [] },
  voiceMap: { type: Object, default: () => ({}) },
  mappedSegments: { type: Array, default: () => [] },
  hasVoiceSegments: { type: Boolean, default: false },
  ppOptions: { type: Object, default: () => ({}) },
  rendering: { type: Boolean, default: false },
  renderProgress: { type: Number, default: 0 },
  renderProgressMsg: { type: String, default: '' },
})

const emit = defineEmits([
  'hide', 'detect-scenes', 'detect-voices',
  'select-speaker', 'update-mapping', 'update-pp',
  'reassign-segment', 'seek',
  'render', 'export-premiere',
])

const panelWidth = ref(280)
const speakerCanvases = reactive({})

// ── Resize handle ──
let resizeDrag = null

function onResizeStart(e) {
  e.preventDefault()
  resizeDrag = { startX: e.clientX, startWidth: panelWidth.value }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e) {
  if (!resizeDrag) return
  const dx = e.clientX - resizeDrag.startX
  panelWidth.value = Math.max(200, Math.min(600, resizeDrag.startWidth + dx))
}

function onResizeEnd() {
  resizeDrag = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
}

// ── Speaker thumbnail rendering ──
function renderThumbnails() {
  if (!props.sceneResult || !props.video) return
  const video = props.video
  if (video.readyState < 2) return
  for (const speaker of props.sceneResult.speakers) {
    const canvas = speakerCanvases[speaker.id]
    if (!canvas) continue
    const [sx, sy, sw, sh] = speaker.cropRect
    canvas.width = 120
    canvas.height = 68
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 120, 68)
  }
}

async function seekAndRenderThumbnails() {
  if (!props.sceneResult || !props.video) return
  const video = props.video
  if (video.readyState < 1) {
    await new Promise(resolve => {
      video.addEventListener('loadeddata', resolve, { once: true })
    })
  }
  const targetTime = Math.min(1, video.duration * 0.1)
  if (Math.abs(video.currentTime - targetTime) > 0.2) {
    video.currentTime = targetTime
    await new Promise(resolve => {
      video.addEventListener('seeked', resolve, { once: true })
    })
  }
  await new Promise(resolve => requestAnimationFrame(resolve))
  await nextTick()
  renderThumbnails()
}

// Render when sceneResult or video changes
watch(() => props.sceneResult, async (data) => {
  if (data) {
    await nextTick()
    await seekAndRenderThumbnails()
  }
}, { immediate: true })

// ── Colors / labels ──
const COLORS = ['#0078d4', '#d83b01', '#107c10', '#5c2d91', '#008272', '#b4009e', '#ca5010']
function speakerColor(id) {
  const idx = parseInt(id.replace(/\D/g, ''), 10) || 1
  return COLORS[(idx - 1) % COLORS.length]
}
function speakerLabel(id) {
  const sp = props.speakers.find(s => s.id === id)
  return sp ? sp.name : id
}
function voiceIndex(id) {
  return parseInt(id.replace(/\D/g, ''), 10) || 0
}
function fmt(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: row;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  min-width: 200px;
  max-width: 600px;
}

/* ── Resize handle ── */
.sp-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
  z-index: 10;
}
.sp-resize-handle:hover,
.sp-resize-handle:active {
  background: var(--accent);
  opacity: 0.5;
}

.sp-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ── Header ── */
.sp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sp-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-dim);
  font-weight: 600;
}
.sp-close-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  border-radius: 3px;
  cursor: pointer;
}
.sp-close-btn:hover {
  background: var(--bg-input);
  color: var(--fg-bright);
}

/* ── Collapsible sections ── */
.sp-section {
  border-bottom: 1px solid var(--border);
}
.sp-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-dim);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.sp-section-title:hover {
  color: var(--fg);
  background: rgba(255,255,255,0.03);
}
.sp-section-body {
  padding: 6px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Shared ── */
.sp-row {
  display: flex;
  gap: 6px;
}
.btn-block {
  width: 100%;
  justify-content: center;
}
.sp-progress {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sp-progress-bar {
  height: 3px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}
.sp-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.sp-progress-label {
  font-size: 10px;
  color: var(--fg-dim);
}
.sp-stats {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.stat-mini {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--fg-dim);
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 8px;
}
.speaker-dot-sm {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

/* ── Speaker cards ── */
.sp-speaker-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sp-speaker-card {
  display: flex;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  align-items: center;
}
.sp-speaker-card:hover {
  background: var(--bg-input);
}
.sp-speaker-card.selected {
  border-color: var(--accent);
  background: rgba(0,120,212,0.1);
}
.sp-speaker-thumb {
  width: 120px;
  height: 68px;
  border-radius: 2px;
  background: #000;
  flex-shrink: 0;
}
.sp-speaker-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sp-speaker-name {
  font-size: 12px;
  color: var(--fg);
  font-weight: 500;
}
.sp-speaker-dims {
  font-size: 10px;
  color: var(--fg-dim);
  font-family: var(--font-mono);
}

/* ── Mapping ── */
.sp-mapping-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sp-mapping-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp-mapping-voice {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--fg);
  min-width: 65px;
}
.sp-mapping-arrow {
  color: var(--fg-dim);
  flex-shrink: 0;
}
.sp-select {
  flex: 1;
  min-width: 0;
  background: var(--bg-input);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px 6px;
  font-size: 11px;
  font-family: var(--font-family);
  cursor: pointer;
}
.sp-select:hover { border-color: var(--accent); }
.sp-select-sm { padding: 1px 4px; font-size: 10px; }

/* ── Settings sliders ── */
.sp-setting {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--fg-dim);
}
.sp-setting-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp-range {
  flex: 1;
  accent-color: var(--accent);
  height: 4px;
}
.sp-value {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--fg);
  min-width: 30px;
  text-align: right;
}

/* ── Segment list ── */
.sp-segment-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sp-segment-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s;
}
.sp-segment-row:hover {
  background: var(--bg-input);
}
.sp-segment-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg);
  min-width: 75px;
}

/* ── Export buttons ── */
.sp-export-btns {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sp-export-btns .btn {
  justify-content: center;
}
.sp-export-btns .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
