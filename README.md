# Montager 🎬

Automatic 3-camera montage generator for 4K video. Detects speakers via face detection and creates auto-switching montage based on voice activity.

## Features

- **Face Detection** - Uses MediaPipe to detect and track speakers
- **Voice Activity Detection** - Uses Silero VAD for speech detection
- **Auto-switching** - Intelligently switches between speaker crops and wide shot
- **HTML Preview** - Preview montage without rendering
- **FFmpeg Rendering** - High-quality 1080p output

## Installation

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Verify ffmpeg is installed
ffmpeg -version
```

## Usage

Place your 4K video in the folder and run commands:

```bash
# Activate venv
source venv/bin/activate

# Step 1: Detect speakers (creates .scene.json)
python montager.py /detect-scene

# Step 2: Detect voice activity (creates .voicemap.json)
python montager.py /detect-voicemap

# Step 3: Preview in browser (creates .preview.html)
python montager.py /preview

# Step 4: Render final video (creates _montage.mp4)
python montager.py /render
```

### Specifying Video Path

```bash
# Auto-detect first video in current directory
python montager.py /detect-scene

# Or specify path explicitly
python montager.py /detect-scene path/to/video.mp4
```

## Commands

| Command | Description | Output |
|---------|-------------|--------|
| `/detect-scene` | Detect faces, identify speakers, calculate crop regions | `.scene.json` |
| `/detect-voicemap` | Detect speech segments using Silero VAD | `.voicemap.json` |
| `/preview` | Generate HTML preview player (no rendering) | `.preview.html` |
| `/render` | Render final 1080p montage with auto-switching | `_montage.mp4` |

## How It Works

1. **Scene Detection** - Samples frames from video, detects faces using MediaPipe, clusters them by horizontal position to identify unique speakers, calculates 1920x1080 crop rectangles centered on each face.

2. **Voice Mapping** - Extracts audio, runs Silero VAD to find speech segments, assigns speakers based on segment duration (long speech → speaker crop, short speech → wide shot).

3. **Montage Logic**:
   - Speech > 2 seconds → Switch to speaker's crop
   - Short phrases or rapid exchanges → Use wide shot
   - No speech → Maintain current view

4. **Rendering** - Generates FFmpeg filter complex with crop filters per speaker, trims and concatenates segments according to edit decision list.

## Output Specs

- Resolution: 1920x1080 (Full HD)
- Codec: H.264 (libx264)
- Audio: AAC 192kbps
- Quality: CRF 18 (high quality)

## Preview Controls

The HTML preview supports:
- **Space** - Play/Pause
- **← / →** - Seek ±5 seconds
- **Click timeline** - Jump to segment
- **Live crop overlays** - See what will be cropped

## Requirements

- Python 3.10+
- FFmpeg with libx264
- ~500MB disk space for dependencies

## Dependencies

- `opencv-python` - Video frame extraction
- `mediapipe` - Face detection
- `torch` + `torchaudio` - Silero VAD runtime
- `numpy` - Array operations

## Troubleshooting

**"No video file found"**
- Ensure video has extension: .mp4, .mov, .avi, .mkv

**"FFmpeg error"**
- Check ffmpeg is installed: `ffmpeg -version`
- Ensure video codec is supported

**No speakers detected**
- Try video with clearer face visibility
- Check first 30 seconds contains faces

## License

MIT
