# CLAUDE.md

## Project Overview

Montager is a browser-based PWA that automatically generates multi-camera montage edits from single-camera video. Everything runs client-side — no server.

## Repository Structure

```
MontagerPWA/          # Vue 3 + Vite PWA application
  src/
    App.vue           # Main application shell (VS Code-inspired layout)
    components/       # UI components (CropOverlay, SceneDetection, SidePanel, VoiceDetection, VoiceTimeline)
    services/         # Core logic (scene detection, VAD, speaker embedding, clustering, post-processing)
    workers/          # Web Worker for off-main-thread voice processing
models/               # ONNX models (uploaded to R2 at deploy time)
```

## Development

```bash
cd MontagerPWA
npm install
npm run dev       # Dev server at localhost:5173
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

Dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers required for SharedArrayBuffer (FFmpeg WASM, ONNX Runtime).

## Architecture

1. **Scene Detection** (`services/sceneDetection.js`) — samples video frames at ~1fps, runs TF.js BlazeFace face detection, clusters faces by horizontal position into speakers, computes 9:16 crop rectangles
2. **Voice Detection** (runs in `workers/voiceWorker.js`) — extracts 16kHz mono WAV via FFmpeg WASM → Silero VAD v5 for speech segments → Wespeaker ResNet-34 for 256-dim speaker embeddings → AHC clustering
3. **Post-Processing** (`services/segmentPostProcess.js`) — professional editing rules: merge gaps, absorb backchannels, reaction delays, wide shots during silence, min hold times
4. **Preview** — CSS-transform zoom on `<video>` element to simulate crop switching in real-time
5. **Rendering** — FFmpeg WASM with filter_complex (trim/crop/scale/concat) → H.264 + AAC MP4

## Key Technical Notes

- ONNX models (Silero VAD, Wespeaker ResNet-34) stored in Cloudflare R2 bucket `montager`, served via `data.montager.podkolzin.consulting`. Cached in OPFS by `services/modelManager.js`
- Video and state persisted in IndexedDB
- Voice processing runs entirely in a Web Worker to keep UI responsive
- Workbox cache limit set to 30MB for WASM binaries

## Deployment

Cloudflare Pages via GitHub Actions. Pushes to `main` trigger build and deploy.

Live at **https://montager.podkolzin.consulting**

ONNX models live at repo root `/models/` and are uploaded to Cloudflare R2 bucket `montager` during CI. Served at runtime via **https://data.montager.podkolzin.consulting/models/**. The modelManager caches them in OPFS after first download.
