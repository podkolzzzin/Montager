# Montager 🎬

Automatic 3-camera montage generator for 4K video. Detects speakers via face detection and creates auto-switching montage based on voice activity.

## Features

- **Face Detection** - Uses OpenCV + ONNX BlazeFace to detect and track speakers
- **Voice Activity Detection** - Energy-based VAD with MFCC speaker clustering
- **Auto-switching** - Intelligently switches between speaker crops and wide shot
- **HTML Preview** - Preview montage without rendering
- **FFmpeg Rendering** - High-quality 1080p output

## Requirements

- .NET 10 SDK
- FFmpeg and FFprobe

## Quick Start

```bash
cd MontagerDotNet
dotnet build
```

### CLI Usage

```bash
dotnet run --project Montager.Cli -- /detect-scene video.mp4
dotnet run --project Montager.Cli -- /detect-voicemap video.mp4
dotnet run --project Montager.Cli -- /preview video.mp4
dotnet run --project Montager.Cli -- /render video.mp4
```

### Interactive Mode

```bash
dotnet run --project Montager.Maui
```

## Commands

| Command | Description | Output |
|---------|-------------|--------|
| `/detect-scene` | Detect faces, identify speakers, calculate crop regions | `.scene.json` |
| `/detect-voicemap` | Detect speech segments using VAD | `.voicemap.json` |
| `/preview` | Generate HTML preview player (no rendering) | `.preview.html` |
| `/render` | Render final 1080p montage with auto-switching | `_montage.mp4` |

## Output Specs

- Resolution: 1920x1080 (Full HD)
- Codec: H.264 (libx264)
- Audio: AAC 192kbps
- Quality: CRF 18 (high quality)

## License

MIT
