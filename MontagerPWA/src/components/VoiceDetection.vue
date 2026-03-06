<template>
  <div class="voice-panel">
    <!-- Header -->
    <div class="voice-panel-header">
      <span class="voice-panel-title">Voice Detection</span>
      <button
        v-if="!detecting && !hasSegments"
        class="btn btn-primary btn-sm"
        :disabled="!speakers.length"
        :title="!speakers.length ? 'Run scene detection first' : 'Detect voices'"
        @click="runDetection"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
        Detect Voices
      </button>
      <button
        v-if="hasSegments && !detecting"
        class="btn btn-secondary btn-sm"
        @click="runDetection"
      >
        Re-detect
      </button>
    </div>

    <!-- Progress -->
    <div v-if="detecting" class="voice-progress">
      <div class="voice-progress-bar">
        <div class="voice-progress-fill" :style="{ width: pct + '%' }"></div>
      </div>
      <span class="voice-progress-label">{{ progressMsg }}</span>
    </div>

    <!-- Results -->
    <div v-if="hasSegments && !detecting" class="voice-results">
      <!-- Stats -->
      <div class="voice-stats">
        <div class="stat-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2"/>
          </svg>
          {{ segments.length }} segment{{ segments.length !== 1 ? 's' : '' }}
        </div>
        <div class="stat-chip" v-for="uid in uniqueSpeakers" :key="uid">
          <span class="speaker-dot" :style="{ background: speakerColor(uid) }"></span>
          {{ speakerLabel(uid) }}
        </div>
      </div>

      <!-- Voice-to-speaker mapping editor -->
      <div class="mapping-section">
        <span class="mapping-title">Voice → Speaker mapping</span>
        <div class="mapping-grid">
          <div
            v-for="voice in uniqueSpeakers"
            :key="voice"
            class="mapping-row"
          >
            <span class="mapping-voice">
              <span class="speaker-dot" :style="{ background: speakerColor(voice) }"></span>
              Voice {{ voiceIndex(voice) }}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mapping-arrow">
              <path d="M5 12h14m-4-4l4 4-4 4"/>
            </svg>
            <select
              class="mapping-select"
              :value="voiceMap[voice] || voice"
              @change="updateMapping(voice, $event.target.value)"
            >
              <option v-for="sp in speakers" :key="sp.id" :value="sp.id">
                {{ sp.name }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- Post-processing settings -->
      <details class="pp-settings">
        <summary>Director's Cut Settings</summary>
        <div class="pp-settings-grid">
          <label class="pp-label">
            Min speaker duration
            <div class="pp-input-row">
              <input type="range" min="1" max="10" step="0.5" v-model.number="ppOptions.minSpeakerDuration" class="pp-range" />
              <span class="pp-value">{{ ppOptions.minSpeakerDuration }}s</span>
            </div>
          </label>
          <label class="pp-label">
            Rapid switch threshold
            <div class="pp-input-row">
              <input type="range" min="2" max="8" step="1" v-model.number="ppOptions.clusterSwitchCount" class="pp-range" />
              <span class="pp-value">{{ ppOptions.clusterSwitchCount }} switches</span>
            </div>
          </label>
          <label class="pp-label">
            Cluster detection window
            <div class="pp-input-row">
              <input type="range" min="3" max="15" step="1" v-model.number="ppOptions.clusterWindow" class="pp-range" />
              <span class="pp-value">{{ ppOptions.clusterWindow }}s</span>
            </div>
          </label>
          <label class="pp-label">
            Long segment → wide at
            <div class="pp-input-row">
              <input type="range" min="5" max="30" step="1" v-model.number="ppOptions.longSegmentWideSwitch" class="pp-range" />
              <span class="pp-value">{{ ppOptions.longSegmentWideSwitch }}s</span>
            </div>
          </label>
        </div>
      </details>

      <!-- ═══ Two-level minimap timeline (VS Code scrollbar style) ═══ -->
      <div class="timeline-container">
        <!-- ── Minimap (full video overview) ── -->
        <div class="timeline-header-row">
          <span class="voice-timeline-label">Overview</span>
          <div class="cuts-stats">
            <span class="stat-mini">{{ directorCuts.length }} cuts</span>
            <span class="stat-mini">{{ directorCuts.filter(c => c.mode === 'wide').length }} wide</span>
            <span class="stat-mini">{{ directorCuts.filter(c => c.mode === 'speaker').length }} speaker</span>
          </div>
          <span class="viewport-range">{{ fmt(viewStart) }} – {{ fmt(viewEnd) }}</span>
        </div>

        <div
          class="minimap"
          ref="minimapEl"
          @pointerdown="onMinimapPointerDown"
        >
          <!-- playhead on minimap -->
          <div class="mm-playhead" :style="{ left: (currentTime / duration * 100) + '%' }" />

          <!-- Director's cut blocks -->
          <div
            v-for="(cut, i) in directorCuts"
            :key="'mm-cut-' + i"
            class="mm-block"
            :style="{
              left: (cut.start / duration * 100) + '%',
              width: ((cut.end - cut.start) / duration * 100) + '%',
              background: cut.mode === 'wide' ? '#555' : speakerColor(cut.speakerId),
              top: '1px',
              height: '10px',
            }"
          />

          <!-- Raw segment blocks (second row) -->
          <div
            v-for="(seg, i) in mappedSegments"
            :key="'mm-seg-' + i"
            class="mm-block"
            :style="{
              left: (seg.start / duration * 100) + '%',
              width: ((seg.end - seg.start) / duration * 100) + '%',
              background: speakerColor(seg.speakerId),
              top: '13px',
              height: '8px',
              opacity: 0.6,
            }"
          />

          <!-- Viewport window (draggable + resizable) -->
          <div
            class="mm-viewport"
            :style="{
              left: (viewStart / duration * 100) + '%',
              width: ((viewEnd - viewStart) / duration * 100) + '%',
            }"
            @pointerdown.stop="onViewportDragStart"
          >
            <!-- left resize edge -->
            <div class="mm-vp-edge mm-vp-edge-left" @pointerdown.stop="onViewportResizeStart($event, 'left')" />
            <!-- right resize edge -->
            <div class="mm-vp-edge mm-vp-edge-right" @pointerdown.stop="onViewportResizeStart($event, 'right')" />
          </div>
        </div>

        <!-- ── Detail view (zoomed into viewport window) ── -->
        <div class="timeline-header-row">
          <span class="voice-timeline-label">Detail — Director's Cut</span>
        </div>
        <div class="detail-timeline" @click="onDetailClick">
          <!-- playhead in detail view -->
          <div
            v-if="currentTime >= viewStart && currentTime <= viewEnd"
            class="dt-playhead"
            :style="{ left: ((currentTime - viewStart) / viewSpan * 100) + '%' }"
          />
          <!-- cut blocks zoomed -->
          <div
            v-for="(cut, i) in visibleDirectorCuts"
            :key="'dt-cut-' + i"
            class="dt-block"
            :class="{ 'cut-wide': cut.mode === 'wide', 'cut-active': isActiveCut(cut) }"
            :style="{
              left: ((cut.visStart - viewStart) / viewSpan * 100) + '%',
              width: ((cut.visEnd - cut.visStart) / viewSpan * 100) + '%',
              background: cut.mode === 'wide' ? '#555' : speakerColor(cut.speakerId),
              top: '2px',
            }"
            :title="cut.mode === 'wide'
              ? `Wide: ${fmt(cut.start)} – ${fmt(cut.end)}`
              : `${speakerLabel(cut.speakerId)}: ${fmt(cut.start)} – ${fmt(cut.end)}`"
            @click.stop="$emit('seek', Math.max(cut.start, viewStart))"
          >
            <span v-if="((cut.visEnd - cut.visStart) / viewSpan * 100) > 8" class="dt-block-label">
              {{ cut.mode === 'wide' ? 'Wide' : speakerLabel(cut.speakerId) }}
            </span>
          </div>
        </div>

        <!-- ── Detail view — Raw Segments ── -->
        <div class="timeline-header-row">
          <span class="voice-timeline-label">Detail — Raw Segments</span>
        </div>
        <div class="detail-timeline detail-timeline-raw" @click="onDetailClick">
          <!-- playhead -->
          <div
            v-if="currentTime >= viewStart && currentTime <= viewEnd"
            class="dt-playhead"
            :style="{ left: ((currentTime - viewStart) / viewSpan * 100) + '%' }"
          />
          <!-- segment blocks zoomed -->
          <div
            v-for="(seg, i) in visibleRawSegments"
            :key="'dt-seg-' + i"
            class="dt-block"
            :style="{
              left: ((seg.visStart - viewStart) / viewSpan * 100) + '%',
              width: ((seg.visEnd - seg.visStart) / viewSpan * 100) + '%',
              background: speakerColor(seg.speakerId),
              top: detailSpeakerRow(seg.speakerId),
            }"
            :title="`${speakerLabel(seg.speakerId)}: ${fmt(seg.start)} – ${fmt(seg.end)}`"
            @click.stop="$emit('seek', Math.max(seg.start, viewStart))"
          >
            <span v-if="((seg.visEnd - seg.visStart) / viewSpan * 100) > 6" class="dt-block-label">
              {{ speakerLabel(seg.speakerId) }}
            </span>
          </div>
          <!-- lane labels -->
          <div
            v-for="(uid, idx) in allMappedSpeakers"
            :key="'dt-label-' + uid"
            class="voice-lane-label"
            :style="{ top: (idx * 24 + 2) + 'px' }"
          >
            <span class="speaker-dot-sm" :style="{ background: speakerColor(uid) }"></span>
            {{ speakerLabel(uid) }}
          </div>
        </div>
      </div>

      <!-- Segment list (editable) -->
      <details class="segment-details">
        <summary>Segments ({{ segments.length }})</summary>
        <div class="segment-list">
          <div
            v-for="(seg, i) in mappedSegments"
            :key="i"
            class="segment-row"
            @click="$emit('seek', seg.start)"
          >
            <span class="segment-time">{{ fmt(seg.start) }}–{{ fmt(seg.end) }}</span>
            <select
              class="segment-speaker-select"
              :value="seg.speakerId"
              @click.stop
              @change="reassignSegment(i, $event.target.value)"
            >
              <option v-for="sp in speakers" :key="sp.id" :value="sp.id">
                {{ sp.name }}
              </option>
            </select>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive } from 'vue'
import { detectVoices } from '../services/voiceDetection.js'
import { postProcessSegments, DEFAULT_OPTIONS } from '../services/segmentPostProcess.js'

const props = defineProps({
  videoSrc: { type: String, default: null },
  speakers: { type: Array, default: () => [] },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  restoredData: { type: Object, default: null }
})

const emit = defineEmits(['detected', 'seek', 'mapping-changed', 'active-cut'])

const detecting = ref(false)
const progressMsg = ref('')
const pct = ref(0)
const segments = ref([])
const voiceMap = ref({})  // voice_id → speaker_id
const ppOptions = reactive({ ...DEFAULT_OPTIONS })

const hasSegments = computed(() => segments.value.length > 0)

const uniqueSpeakers = computed(() => {
  const set = new Set(segments.value.map(s => s.speakerId))
  return [...set].sort()
})

const mappedSegments = computed(() =>
  segments.value.map(seg => ({
    ...seg,
    speakerId: voiceMap.value[seg.speakerId] || seg.speakerId
  }))
)

const allMappedSpeakers = computed(() => {
  const set = new Set(mappedSegments.value.map(s => s.speakerId))
  return [...set].sort()
})

// Director's cut — post-processed timeline
const directorCuts = computed(() => {
  if (!mappedSegments.value.length || !props.duration) return []
  return postProcessSegments(mappedSegments.value, props.duration, ppOptions)
})

// Emit active cut whenever currentTime or cuts change
const activeCut = computed(() => {
  const t = props.currentTime
  return directorCuts.value.find(c => t >= c.start && t < c.end) || null
})

function isActiveCut(cut) {
  return activeCut.value === cut
}

watch(activeCut, (cut) => {
  emit('active-cut', cut)
}, { immediate: true })

// ── Minimap viewport state ──
const minimapEl = ref(null)
const viewStart = ref(0)
const viewEnd = ref(0)
const viewSpan = computed(() => Math.max(viewEnd.value - viewStart.value, 0.1))
const MIN_VIEW_SPAN = 5 // minimum 5 seconds

// Initialize viewport to full duration, then narrow to 30% when data arrives
watch(() => props.duration, (d) => {
  if (d > 0 && viewEnd.value === 0) {
    const span = Math.min(d * 0.3, d)
    viewStart.value = 0
    viewEnd.value = span
  }
}, { immediate: true })

// Clamp viewport when segments change
function clampViewport() {
  const d = props.duration || 1
  if (viewStart.value < 0) viewStart.value = 0
  if (viewEnd.value > d) viewEnd.value = d
  if (viewEnd.value - viewStart.value < MIN_VIEW_SPAN) {
    viewEnd.value = Math.min(viewStart.value + MIN_VIEW_SPAN, d)
    if (viewEnd.value - viewStart.value < MIN_VIEW_SPAN) {
      viewStart.value = Math.max(viewEnd.value - MIN_VIEW_SPAN, 0)
    }
  }
}

// Filter cuts/segments visible in viewport window
const visibleDirectorCuts = computed(() => {
  const vs = viewStart.value, ve = viewEnd.value
  return directorCuts.value
    .filter(c => c.end > vs && c.start < ve)
    .map(c => ({
      ...c,
      visStart: Math.max(c.start, vs),
      visEnd: Math.min(c.end, ve),
    }))
})

const visibleRawSegments = computed(() => {
  const vs = viewStart.value, ve = viewEnd.value
  return mappedSegments.value
    .filter(s => s.end > vs && s.start < ve)
    .map(s => ({
      ...s,
      visStart: Math.max(s.start, vs),
      visEnd: Math.min(s.end, ve),
    }))
})

function detailSpeakerRow(id) {
  const list = allMappedSpeakers.value
  const idx = list.indexOf(id)
  return (idx >= 0 ? idx * 24 + 2 : 2) + 'px'
}

// ── Minimap click → seek ──
function onMinimapPointerDown(e) {
  // If click is outside the viewport handle, seek to that position
  const rect = minimapEl.value.getBoundingClientRect()
  const pctX = (e.clientX - rect.left) / rect.width
  const time = pctX * props.duration
  emit('seek', time)
}

// ── Detail click → seek ──
function onDetailClick(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const pctX = (e.clientX - rect.left) / rect.width
  const time = viewStart.value + pctX * viewSpan.value
  emit('seek', time)
}

// ── Viewport drag (move) ──
let vpDrag = null

function onViewportDragStart(e) {
  e.preventDefault()
  const rect = minimapEl.value.getBoundingClientRect()
  vpDrag = {
    type: 'move',
    startX: e.clientX,
    origStart: viewStart.value,
    origEnd: viewEnd.value,
    pxPerSec: rect.width / props.duration,
  }
  window.addEventListener('pointermove', onVpPointerMove)
  window.addEventListener('pointerup', onVpPointerUp)
}

// ── Viewport resize (edges) ──
function onViewportResizeStart(e, edge) {
  e.preventDefault()
  const rect = minimapEl.value.getBoundingClientRect()
  vpDrag = {
    type: 'resize',
    edge,
    startX: e.clientX,
    origStart: viewStart.value,
    origEnd: viewEnd.value,
    pxPerSec: rect.width / props.duration,
  }
  window.addEventListener('pointermove', onVpPointerMove)
  window.addEventListener('pointerup', onVpPointerUp)
}

function onVpPointerMove(e) {
  if (!vpDrag) return
  const dx = e.clientX - vpDrag.startX
  const dt = dx / vpDrag.pxPerSec
  const d = props.duration

  if (vpDrag.type === 'move') {
    let newStart = vpDrag.origStart + dt
    let newEnd = vpDrag.origEnd + dt
    const span = vpDrag.origEnd - vpDrag.origStart
    if (newStart < 0) { newStart = 0; newEnd = span }
    if (newEnd > d) { newEnd = d; newStart = d - span }
    viewStart.value = newStart
    viewEnd.value = newEnd
  } else if (vpDrag.type === 'resize') {
    if (vpDrag.edge === 'left') {
      viewStart.value = Math.max(0, Math.min(vpDrag.origStart + dt, viewEnd.value - MIN_VIEW_SPAN))
    } else {
      viewEnd.value = Math.min(d, Math.max(vpDrag.origEnd + dt, viewStart.value + MIN_VIEW_SPAN))
    }
  }
  clampViewport()
}

function onVpPointerUp() {
  vpDrag = null
  window.removeEventListener('pointermove', onVpPointerMove)
  window.removeEventListener('pointerup', onVpPointerUp)
}

// colors for voice IDs
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
  const idx = parseInt(id.replace(/\D/g, ''), 10) || 0
  return idx
}

function fmt(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function runDetection() {
  if (!props.videoSrc) return
  detecting.value = true
  segments.value = []
  voiceMap.value = {}
  pct.value = 0

  try {
    const result = await detectVoices(
      props.videoSrc,
      Math.max(props.speakers.length, 2),
      (msg, p) => { progressMsg.value = msg; pct.value = p }
    )
    segments.value = result.segments

    // build initial voice→speaker mapping (voice_1→speaker_1, etc.)
    initMapping()

    emit('detected', { segments: mappedSegments.value, voiceMap: voiceMap.value })
  } catch (err) {
    progressMsg.value = `Error: ${err.message}`
    console.error('Voice detection error:', err)
  } finally {
    detecting.value = false
  }
}

function initMapping() {
  const voices = uniqueSpeakers.value
  const map = {}
  voices.forEach((v, i) => {
    if (i < props.speakers.length) {
      map[v] = props.speakers[i].id
    } else {
      map[v] = v
    }
  })
  voiceMap.value = map
}

function updateMapping(voiceId, speakerId) {
  voiceMap.value = { ...voiceMap.value, [voiceId]: speakerId }
  emit('mapping-changed', { segments: mappedSegments.value, voiceMap: voiceMap.value })
}

function reassignSegment(index, newSpeakerId) {
  // find the original segment's voiceId, change the mapping for that specific segment
  const seg = segments.value[index]
  if (!seg) return
  // update the segment's speaker directly
  segments.value[index] = { ...seg, speakerId: newSpeakerId }
  segments.value = [...segments.value]  // trigger reactivity
  // also update mapping if it was a bulk voice → the reassigned speaker
  emit('mapping-changed', { segments: mappedSegments.value, voiceMap: voiceMap.value })
}

// re-emit when speakers change (names etc.)
watch(() => props.speakers, () => {
  if (hasSegments.value && Object.keys(voiceMap.value).length === 0) {
    initMapping()
  }
}, { deep: true })

// Restore from persisted data
watch(() => props.restoredData, (data) => {
  if (data && !hasSegments.value) {
    if (data.segments && data.segments.length) {
      segments.value = data.segments
    }
    if (data.voiceMap && Object.keys(data.voiceMap).length) {
      voiceMap.value = data.voiceMap
    } else if (data.segments && data.segments.length) {
      initMapping()
    }
  }
}, { immediate: true })
</script>

<style scoped>
.voice-panel {
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 550px;
}

.voice-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.voice-panel-title {
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
.voice-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.voice-progress-bar {
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}
.voice-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.voice-progress-label {
  font-size: 11px;
  color: var(--fg-dim);
}

/* stats */
.voice-stats {
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

.speaker-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.speaker-dot-sm {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

/* ── Mapping editor ── */
.mapping-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mapping-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-dim);
}
.mapping-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mapping-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mapping-voice {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--fg);
  min-width: 80px;
}
.mapping-arrow {
  color: var(--fg-dim);
  flex-shrink: 0;
}
.mapping-select {
  background: var(--bg-input);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px 8px;
  font-size: 12px;
  font-family: var(--font-family);
  cursor: pointer;
}
.mapping-select:hover {
  border-color: var(--accent);
}

/* ── Timeline (minimap + detail) ── */
.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.timeline-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cuts-stats {
  display: flex;
  gap: 6px;
}
.stat-mini {
  font-size: 10px;
  color: var(--fg-dim);
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 8px;
}
.viewport-range {
  margin-left: auto;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--fg-dim);
}

/* ── Minimap ── */
.minimap {
  position: relative;
  height: 26px;
  background: var(--bg-input);
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  border: 1px solid var(--border);
}
.mm-playhead {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: #fff;
  z-index: 6;
  pointer-events: none;
}
.mm-block {
  position: absolute;
  border-radius: 1px;
  pointer-events: none;
}
.mm-viewport {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 2px;
  cursor: grab;
  z-index: 4;
  box-sizing: border-box;
  min-width: 8px;
}
.mm-viewport:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.5);
}
.mm-viewport:active {
  cursor: grabbing;
}
.mm-vp-edge {
  position: absolute;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
  z-index: 5;
}
.mm-vp-edge-left {
  left: -3px;
}
.mm-vp-edge-right {
  right: -3px;
}
.mm-vp-edge::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 12px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 1px;
}
.mm-vp-edge:hover::after {
  background: rgba(255, 255, 255, 0.8);
}

/* ── Detail timeline ── */
.detail-timeline {
  position: relative;
  height: 28px;
  background: var(--bg-input);
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  border: 1px solid var(--border);
}
.detail-timeline-raw {
  height: 56px;
}
.dt-playhead {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: #fff;
  z-index: 6;
  pointer-events: none;
  transition: left 0.1s linear;
}
.dt-block {
  position: absolute;
  height: 22px;
  border-radius: 3px;
  opacity: 0.9;
  cursor: pointer;
  transition: opacity 0.1s;
  min-width: 3px;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.dt-block:hover {
  opacity: 1;
  z-index: 3;
}
.dt-block-label {
  font-size: 9px;
  color: #fff;
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
.cut-active {
  outline: 2px solid #fff;
  outline-offset: -1px;
  z-index: 2;
}
.voice-timeline-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.voice-timeline-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-dim);
}
.voice-lane-label {
  position: absolute;
  left: 4px;
  font-size: 9px;
  color: var(--fg-dim);
  display: flex;
  align-items: center;
  gap: 3px;
  pointer-events: none;
  z-index: 4;
}

/* ── Segment list ── */
.segment-details {
  font-size: 12px;
  color: var(--fg-dim);
}
.segment-details summary {
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}
.segment-details summary:hover {
  color: var(--fg);
}
.segment-list {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}
.segment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s;
}
.segment-row:hover {
  background: var(--bg-input);
}
.segment-time {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg);
  min-width: 90px;
}
.segment-speaker-select {
  background: var(--bg-input);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px 6px;
  font-size: 11px;
  font-family: var(--font-family);
  cursor: pointer;
}
.segment-speaker-select:hover {
  border-color: var(--accent);
}
</style>
