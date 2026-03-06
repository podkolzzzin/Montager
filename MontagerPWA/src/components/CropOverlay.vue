<template>
  <div class="crop-overlay" ref="overlayEl">
    <svg
      v-if="speakers.length && videoWidth && videoHeight"
      ref="svgEl"
      class="crop-svg"
      :viewBox="`0 0 ${videoWidth} ${videoHeight}`"
      preserveAspectRatio="xMidYMid meet"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <!-- dim the outside of all crop rects -->
      <defs>
        <mask id="crop-mask">
          <rect x="0" y="0" :width="videoWidth" :height="videoHeight" fill="white"/>
          <rect
            v-for="(s, i) in speakers"
            :key="'mask-' + i"
            :x="s.cropRect[0]"
            :y="s.cropRect[1]"
            :width="s.cropRect[2]"
            :height="s.cropRect[3]"
            fill="black"
          />
        </mask>
      </defs>

      <!-- dimmed background -->
      <rect
        x="0" y="0"
        :width="videoWidth" :height="videoHeight"
        fill="rgba(0,0,0,0.45)"
        mask="url(#crop-mask)"
      />

      <!-- crop rectangles -->
      <g v-for="(s, i) in speakers" :key="'rect-' + i">
        <!-- move handle (the main rect) -->
        <rect
          :x="s.cropRect[0]"
          :y="s.cropRect[1]"
          :width="s.cropRect[2]"
          :height="s.cropRect[3]"
          fill="transparent"
          :stroke="selectedId === s.id ? '#0078d4' : '#ffffff'"
          :stroke-width="selectedId === s.id ? 4 : 2"
          stroke-dasharray="8 4"
          rx="2"
          class="crop-rect"
          @pointerdown.stop="startMove($event, s)"
        />

        <!-- label -->
        <rect
          :x="s.cropRect[0]"
          :y="s.cropRect[1] - 26"
          :width="Math.max(s.name.length * 10 + 16, 80)"
          height="24"
          :fill="selectedId === s.id ? '#0078d4' : 'rgba(0,0,0,0.7)'"
          rx="2"
        />
        <text
          :x="s.cropRect[0] + 8"
          :y="s.cropRect[1] - 8"
          fill="#fff"
          font-size="14"
          font-family="var(--font-family)"
        >
          {{ s.name }}
        </text>

        <!-- face bbox (dotted, lighter) -->
        <rect
          :x="s.bbox[0]"
          :y="s.bbox[1]"
          :width="s.bbox[2]"
          :height="s.bbox[3]"
          fill="none"
          stroke="#ffc107"
          stroke-width="1.5"
          stroke-dasharray="4 3"
          rx="2"
        />

        <!-- resize handles (corners) -->
        <rect
          v-for="corner in corners(s)"
          :key="corner.pos"
          :x="corner.x"
          :y="corner.y"
          :width="handleSize"
          :height="handleSize"
          :fill="selectedId === s.id ? '#0078d4' : '#ffffff'"
          stroke="#000"
          stroke-width="1"
          rx="1"
          :class="['resize-handle', 'handle-' + corner.pos]"
          @pointerdown.stop="startResize($event, s, corner.pos)"
        />
      </g>
    </svg>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  speakers: { type: Array, default: () => [] },
  videoWidth: { type: Number, default: 0 },
  videoHeight: { type: Number, default: 0 },
  selectedId: { type: String, default: null },
  activeCut: { type: Object, default: null }
})

const emit = defineEmits(['select', 'update'])

const svgEl = ref(null)

// handle size in video-space pixels (scales with viewBox)
const handleSize = computed(() => Math.max(12, Math.min(props.videoWidth, props.videoHeight) * 0.015))

// ── Interaction state ──
let dragType = null    // 'move' | 'resize'
let dragSpeaker = null
let dragCorner = null  // 'tl' | 'tr' | 'bl' | 'br'
let dragStart = null   // { svgX, svgY }
let origRect = null    // [x, y, w, h] snapshot

function corners(speaker) {
  const [x, y, w, h] = speaker.cropRect
  const hs = handleSize.value
  const off = hs / 2
  return [
    { pos: 'tl', x: x - off, y: y - off },
    { pos: 'tr', x: x + w - off, y: y - off },
    { pos: 'bl', x: x - off, y: y + h - off },
    { pos: 'br', x: x + w - off, y: y + h - off }
  ]
}

/** Convert a DOM pointer event to SVG viewBox coordinates */
function toSvg(evt) {
  const svg = svgEl.value
  if (!svg) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = evt.clientX
  pt.y = evt.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const svgPt = pt.matrixTransform(ctm.inverse())
  return { x: svgPt.x, y: svgPt.y }
}

function startMove(evt, speaker) {
  emit('select', speaker)
  dragType = 'move'
  dragSpeaker = speaker
  dragStart = toSvg(evt)
  origRect = [...speaker.cropRect]
  evt.target.setPointerCapture(evt.pointerId)
}

function startResize(evt, speaker, corner) {
  emit('select', speaker)
  dragType = 'resize'
  dragSpeaker = speaker
  dragCorner = corner
  dragStart = toSvg(evt)
  origRect = [...speaker.cropRect]
  evt.target.setPointerCapture(evt.pointerId)
}

function onPointerMove(evt) {
  if (!dragType || !dragSpeaker) return
  const cur = toSvg(evt)
  const dx = cur.x - dragStart.x
  const dy = cur.y - dragStart.y

  if (dragType === 'move') {
    applyMove(dx, dy)
  } else if (dragType === 'resize') {
    applyResize(dx, dy)
  }
}

function onPointerUp() {
  dragType = null
  dragSpeaker = null
  dragCorner = null
  dragStart = null
  origRect = null
}

function applyMove(dx, dy) {
  const [ox, oy, w, h] = origRect
  let nx = Math.round(ox + dx)
  let ny = Math.round(oy + dy)
  // clamp inside video
  nx = Math.max(0, Math.min(nx, props.videoWidth - w))
  ny = Math.max(0, Math.min(ny, props.videoHeight - h))
  emitUpdate(dragSpeaker, [nx, ny, w, h])
}

function applyResize(dx, dy) {
  const [ox, oy, ow, oh] = origRect
  const aspect = ow / oh

  // anchor is the opposite corner
  let anchorX, anchorY, rawW, rawH

  switch (dragCorner) {
    case 'br':
      anchorX = ox
      anchorY = oy
      rawW = ow + dx
      rawH = oh + dy
      break
    case 'bl':
      anchorX = ox + ow
      anchorY = oy
      rawW = ow - dx
      rawH = oh + dy
      break
    case 'tr':
      anchorX = ox
      anchorY = oy + oh
      rawW = ow + dx
      rawH = oh - dy
      break
    case 'tl':
      anchorX = ox + ow
      anchorY = oy + oh
      rawW = ow - dx
      rawH = oh - dy
      break
  }

  // enforce minimum size
  const minW = 40
  const minH = minW / aspect
  rawW = Math.max(rawW, minW)
  rawH = Math.max(rawH, minH)

  // preserve aspect ratio — use the dominant axis
  let newW, newH
  if (Math.abs(dx) >= Math.abs(dy)) {
    newW = Math.round(rawW)
    newH = Math.round(newW / aspect)
  } else {
    newH = Math.round(rawH)
    newW = Math.round(newH * aspect)
  }

  // compute new origin based on which corner is anchored
  let nx, ny
  switch (dragCorner) {
    case 'br':
      nx = anchorX
      ny = anchorY
      break
    case 'bl':
      nx = anchorX - newW
      ny = anchorY
      break
    case 'tr':
      nx = anchorX
      ny = anchorY - newH
      break
    case 'tl':
      nx = anchorX - newW
      ny = anchorY - newH
      break
  }

  // clamp inside video bounds
  nx = Math.max(0, Math.min(nx, props.videoWidth - newW))
  ny = Math.max(0, Math.min(ny, props.videoHeight - newH))
  newW = Math.min(newW, props.videoWidth)
  newH = Math.min(newH, props.videoHeight)

  emitUpdate(dragSpeaker, [Math.round(nx), Math.round(ny), Math.round(newW), Math.round(newH)])
}

function emitUpdate(speaker, newRect) {
  emit('update', { id: speaker.id, cropRect: newRect })
}
</script>

<style scoped>
.crop-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crop-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.crop-rect {
  cursor: move;
  pointer-events: all;
}

.resize-handle {
  pointer-events: all;
  opacity: 0.85;
}
.resize-handle:hover {
  opacity: 1;
}
.handle-tl { cursor: nwse-resize; }
.handle-tr { cursor: nesw-resize; }
.handle-bl { cursor: nesw-resize; }
.handle-br { cursor: nwse-resize; }
</style>
