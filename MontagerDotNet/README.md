# Montager .NET

.NET 10 port of Montager - Automatic 3-camera montage from 4K video.

## Projects

| Project | Description |
|---------|-------------|
| **Montager.Core** | Core library with face detection, diarization, transforms, preview, and render |
| **Montager.Cli** | Command-line interface |
| **Montager.Avalonia** | Desktop UI (cross-platform Avalonia) |

## Quick Start

### Build

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

### Desktop App

```bash
dotnet run --project Montager.Avalonia
```

## Requirements

### System Dependencies

- **.NET 10 SDK**
- **FFmpeg** and **FFprobe** - for video processing
- **OpenCV** - provided via OpenCvSharp4 NuGet package

## Architecture

```
Montager.Core/
├── Constants.cs           # Configuration (output size, thresholds)
├── ServiceCollectionExtensions.cs  # DI registration
├── Interfaces/
│   ├── IDetectionService.cs
│   ├── IDiarizationService.cs
│   ├── IPreviewService.cs
│   ├── IRenderService.cs
│   └── IVideoService.cs
├── Models/
│   ├── Speaker.cs         # Speaker with face bbox and crop rect
│   ├── SceneData.cs       # Scene detection output
│   ├── VoiceMapData.cs    # Voice activity segments
│   └── VideoInfo.cs       # Video metadata
└── Services/
    ├── VideoService.cs        # File finding, caching, ffprobe
    ├── DetectionService.cs    # Face detection (OpenCV + ONNX)
    ├── DiarizationService.cs  # VAD + MFCC + K-means clustering
    ├── TransformService.cs    # Segment transforms
    ├── PreviewService.cs      # HTML preview generation
    └── RenderService.cs       # FFmpeg montage rendering

Montager.Avalonia/
├── App.axaml(.cs)         # Application with DI setup
├── Program.cs             # Entry point
├── ViewModels/
│   └── MainWindowViewModel.cs  # MVVM ViewModel
└── Views/
    └── MainWindow.axaml(.cs)   # Main UI
```

## Features

### Face Detection
- OpenCV Haar Cascade fallback (works without ML model)
- ONNX BlazeFace support (optional, place `blaze_face_short_range.onnx` in app directory)
- Samples 20 frames from first 30 seconds
- Clusters faces into horizontal regions (left/center/right speakers)

### Speaker Diarization
- Energy-based VAD (Voice Activity Detection)
- MFCC embedding extraction (13 coefficients)
- K-means clustering for speaker separation
- Maps diarization labels to detected speakers by position

### Segment Transforms
- **FillGapsWithWide**: Gaps < 3s extend previous speaker; longer gaps use wide shot
- **MergeAdjacentSegments**: Combines consecutive same-speaker segments
- **InsertWideBreaks**: Adds 2s wide breaks every 8s in segments > 15s

### Preview Generation
- Interactive HTML5 video player
- Visual crop overlay
- Color-coded timeline
- Keyboard controls (Space, Arrow keys)

### Rendering
- FFmpeg filter complex with crop + scale + concat
- H.264 output at 1920x1080, CRF 18
- AAC audio at 192kbps

## Configuration

Edit `Montager.Core/Constants.cs`:

```csharp
public const int OutputWidth = 1920;
public const int OutputHeight = 1080;
public const double MinSpeechDuration = 2.0;
public const double LongSpeakerThreshold = 15.0;
public const double WideBreakInterval = 8.0;
public const double WideBreakDuration = 2.0;
```

## Cache Files

Intermediate files are stored in `/tmp/montager/{video}_{hash}/`:
- `{video}.scene.json` - Face detection results
- `{video}.voicemap.json` - Voice activity segments
- `{video}.preview.html` - Browser preview

## NuGet Dependencies

### Core
- OpenCvSharp4
- Microsoft.ML.OnnxRuntime
- NAudio
- MathNet.Numerics
- Microsoft.Extensions.DependencyInjection.Abstractions

### Avalonia UI
- Avalonia
- Avalonia.Desktop
- Avalonia.Themes.Fluent
- CommunityToolkit.Mvvm
- Microsoft.Extensions.DependencyInjection

## Migration Notes (from Python)

| Python | .NET |
|--------|------|
| opencv-python | OpenCvSharp4 |
| mediapipe | OpenCV Cascade + ONNX BlazeFace |
| numpy | MathNet.Numerics |
| soundfile | NAudio |
| torch/silero-vad | Energy-based VAD (ONNX optional) |
| scikit-learn | Manual K-means implementation |
| PyQt5 | Avalonia |
