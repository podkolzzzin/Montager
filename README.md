# Montager

Browser-based automatic video montage editor for multi-speaker videos (podcasts, interviews, panel talks). Analyzes video to detect speakers via face detection, identifies who's speaking via voice activity detection and speaker diarization, then auto-generates a director's cut timeline — all entirely client-side with no server.

## Features

- **Face Detection** — TensorFlow.js MediaPipe BlazeFace samples video frames and clusters detected faces into speakers
- **Voice Activity Detection** — Silero VAD v5 ONNX model detects speech segments at 32ms granularity
- **Speaker Diarization** — Wespeaker ResNet-34 produces 256-dim embeddings per segment, clustered via agglomerative hierarchical clustering
- **Director's Cut** — post-processing pipeline mimics professional editing: follows active speaker, absorbs backchannels, applies reaction delays, inserts wide shots during silence
- **Adjustable Crop Overlays** — per-speaker 9:16 crop rectangles, draggable and resizable with aspect-ratio lock
- **Two-level Timeline** — minimap overview + zoomable detail view with draggable cut edges
- **Preview Mode** — CSS-transform zoom into the active speaker's crop in real-time
- **Video Rendering** — FFmpeg WASM renders final montage as cropped/stitched H.264 MP4 with AAC audio
- **Offline-capable PWA** — full state persistence via IndexedDB, ML models cached in OPFS

## Quick Start

```bash
cd MontagerPWA
npm install
npm run dev
```

Open http://localhost:5173, drag & drop a video file.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Vue 3 (Composition API) |
| Build | Vite 6 |
| PWA | vite-plugin-pwa (Workbox) |
| Face Detection | TensorFlow.js + MediaPipe BlazeFace |
| VAD | Silero VAD v5 via onnxruntime-web |
| Speaker Embedding | Wespeaker ResNet-34 ONNX |
| Audio/Video | FFmpeg WASM |
| Clustering | Custom AHC (cosine distance, average linkage) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with COOP/COEP headers |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |

## Deployment

Deployed to Cloudflare Pages. Pushes to `main` trigger automatic deployment via GitHub Actions.

## License

MIT
