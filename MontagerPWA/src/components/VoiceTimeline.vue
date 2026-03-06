<template>
  <div class="timeline-panel">
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
          <div class="mm-vp-edge mm-vp-edge-left" @pointerdown.stop="onViewportResizeStart($event, 'left')" />
          <div class="mm-vp-edge mm-vp-edge-right" @pointerdown.stop="onViewportResizeStart($event, 'right')" />
        </div>
      </div>

      <!-- ── Detail view (zoomed into viewport window) ── -->
      <div class="timeline-header-row">
        <span class="voice-timeline-label">Detail — Director's Cut</span>
      </div>
      <div class="detail-timeline" @click="onDetailClick">
        <div
          v-if="currentTime >= viewStart && currentTime <= viewEnd"
          class="dt-playhead"
          :style="{ left: ((currentTime - viewStart) / viewSpan * 100) + '%' }"
        />
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
          <!-- left drag edge -->
          <div
            class="cut-edge cut-edge-left"
            @pointerdown.stop="onCutEdgeDragStart($event, cut, 'start')"
          />
          <span v-if="((cut.visEnd - cut.visStart) / viewSpan * 100) > 8" class="dt-block-label">
            {{ cut.mode === 'wide' ? 'Wide' : speakerLabel(cut.speakerId) }}
          </span>
          <!-- right drag edge -->
          <div
            class="cut-edge cut-edge-right"
            @pointerdown.stop="onCutEdgeDragStart($event, cut, 'end')"
          />
        </div>
      </div>

      <!-- ── Detail view — Raw Segments ── -->
      <div class="timeline-header-row">
        <span class="voice-timeline-label">Detail — Raw Segments</span>
      </div>
      <div class="detail-timeline detail-timeline-raw" @click="onDetailClick">
        <div
          v-if="currentTime >= viewStart && currentTime <= viewEnd"
          class="dt-playhead"
          :style="{ left: ((currentTime - viewStart) / viewSpan * 100) + '%' }"
        />
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
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  speakers: { type: Array, default: () => [] },
  mappedSegments: { type: Array, default: () => [] },
  directorCuts: { type: Array, default: () => [] },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  activeCut: { type: Object, default: null },
})

const emit = defineEmits(['seek', 'update-cut'])

const minimapEl = ref(null)
const viewStart = ref(0)
const viewEnd = ref(0)
const viewSpan = computed(() => Math.max(viewEnd.value - viewStart.value, 0.1))
const MIN_VIEW_SPAN = 5

const allMappedSpeakers = computed(() => {
  const set = new Set(props.mappedSegments.map(s => s.speakerId))
  return [...set].sort()
})

// Initialize viewport when duration is known
watch(() => props.duration, (d) => {
  if (d > 0 && viewEnd.value === 0) {
    const span = Math.min(d * 0.3, d)
    viewStart.value = 0
    viewEnd.value = span
  }
}, { immediate: true })

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

const visibleDirectorCuts = computed(() => {
  const vs = viewStart.value, ve = viewEnd.value
  return props.directorCuts
    .filter(c => c.end > vs && c.start < ve)
    .map(c => ({ ...c, visStart: Math.max(c.start, vs), visEnd: Math.min(c.end, ve) }))
})

const visibleRawSegments = computed(() => {
  const vs = viewStart.value, ve = viewEnd.value
  return props.mappedSegments
    .filter(s => s.end > vs && s.start < ve)
    .map(s => ({ ...s, visStart: Math.max(s.start, vs), visEnd: Math.min(s.end, ve) }))
})

function isActiveCut(cut) {
  return props.activeCut === cut
}

function detailSpeakerRow(id) {
  const list = allMappedSpeakers.value
  const idx = list.indexOf(id)
  return (idx >= 0 ? idx * 24 + 2 : 2) + 'px'
}

// ── Minimap click → seek ──
function onMinimapPointerDown(e) {
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

// ── Helpers ──
const COLORS = ['#0078d4', '#d83b01', '#107c10', '#5c2d91', '#008272', '#b4009e', '#ca5010']
function speakerColor(id) {
  const idx = parseInt(id.replace(/\D/g, ''), 10) || 1
  return COLORS[(idx - 1) % COLORS.length]
}

function speakerLabel(id) {
  const sp = props.speakers.find(s => s.id === id)
  return sp ? sp.name : id
}

function fmt(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Cut edge dragging ──
let cutEdgeDrag = null

function onCutEdgeDragStart(e, cut, field) {
  e.preventDefault()
  // Find the real index in the full directorCuts array (not just visible)
  const realIdx = props.directorCuts.findIndex(c => c.start === cut.start && c.end === cut.end)
  if (realIdx < 0) return

  const detailEl = e.target.closest('.detail-timeline')
  if (!detailEl) return
  const rect = detailEl.getBoundingClientRect()

  cutEdgeDrag = {
    field,
    cutIndex: realIdx,
    origValue: field === 'start' ? cut.start : cut.end,
    startX: e.clientX,
    pxPerSec: rect.width / viewSpan.value,
  }

  window.addEventListener('pointermove', onCutEdgeMove)
  window.addEventListener('pointerup', onCutEdgeUp)
}

function onCutEdgeMove(e) {
  if (!cutEdgeDrag) return
  const dx = e.clientX - cutEdgeDrag.startX
  const dt = dx / cutEdgeDrag.pxPerSec
  const newVal = cutEdgeDrag.origValue + dt
  emit('update-cut', cutEdgeDrag.cutIndex, cutEdgeDrag.field, newVal)
}

function onCutEdgeUp() {
  cutEdgeDrag = null
  window.removeEventListener('pointermove', onCutEdgeMove)
  window.removeEventListener('pointerup', onCutEdgeUp)
}
</script>

<style scoped>
.timeline-panel {
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  padding: 8px 14px;
}

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
.voice-timeline-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  background: rgba(0, 120, 212, 0.15);
  border: 2px solid rgba(0, 120, 212, 0.8);
  border-radius: 2px;
  cursor: grab;
  z-index: 4;
  box-sizing: border-box;
  min-width: 8px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), inset 0 0 6px rgba(0, 120, 212, 0.1);
}
.mm-viewport:hover {
  background: rgba(0, 120, 212, 0.22);
  border-color: rgba(0, 120, 212, 1);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 6px rgba(0, 120, 212, 0.4);
}
.mm-viewport:active {
  cursor: grabbing;
  border-color: #3aa0f7;
}
.mm-vp-edge {
  position: absolute;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  z-index: 5;
}
.mm-vp-edge-left { left: -4px; }
.mm-vp-edge-right { right: -4px; }
.mm-vp-edge::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 3px;
  height: 14px;
  background: rgba(0, 120, 212, 0.8);
  border-radius: 2px;
}
.mm-vp-edge:hover::after {
  background: #3aa0f7;
  box-shadow: 0 0 4px rgba(0, 120, 212, 0.6);
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

/* ── Cut edge drag handles ── */
.cut-edge {
  position: absolute;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
  z-index: 5;
  transition: background 0.1s;
}
.cut-edge:hover,
.cut-edge:active {
  background: rgba(255, 255, 255, 0.35);
}
.cut-edge-left {
  left: 0;
  border-radius: 3px 0 0 3px;
}
.cut-edge-right {
  right: 0;
  border-radius: 0 3px 3px 0;
}
.speaker-dot-sm {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
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
</style>
