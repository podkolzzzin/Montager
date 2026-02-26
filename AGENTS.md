# AGENTS.md - Multi-Agent Instructions

## Overview

Montager is a modular Python package for automatic 3-camera montage generation. Provides CLI, GUI, and library interfaces.

## Quick Start

### GUI (Easiest)
```bash
cd /path/to/Montager
source venv/bin/activate
python montager_gui.py
```
- Drag & drop video or click Browse
- Click Preview or Render
- Logs: `~/.montager/gui.log`

### CLI
```bash
source venv/bin/activate
python montager.py /detect-scene video.mp4
python montager.py /detect-voicemap video.mp4
python montager.py /preview video.mp4
python montager.py /render video.mp4
```

## Agent Roles

### Scene Detection Agent
**Task**: Detect faces and compute crop rectangles

```bash
python montager.py /detect-scene [video_path]
```

**Outputs**: `/tmp/montager/{stem}_{hash}/{video}.scene.json`
```json
{
  "video_path": "video.mp4",
  "width": 3840, "height": 2160,
  "fps": 29.97, "duration": 120.5,
  "speakers": [
    {"id": "speaker_1", "name": "Speaker 1", "bbox": [x,y,w,h], "crop_rect": [x,y,1920,1080]}
  ]
}
```

### Voice Detection Agent
**Task**: Detect speech segments and map to speakers

```bash
python montager.py /detect-voicemap [video_path]
```

**Requires**: Scene data (auto-runs /detect-scene if missing)

**Outputs**: `/tmp/montager/{stem}_{hash}/{video}.voicemap.json`
```json
{
  "video_path": "video.mp4",
  "segments": [
    {"start": 0.5, "end": 3.2, "speaker_id": "speaker_1"},
    {"start": 5.0, "end": 8.5, "speaker_id": "speaker_2"}
  ]
}
```

### Preview Agent
**Task**: Generate interactive HTML preview

```bash
python montager.py /preview [video_path]
```

**Outputs**: `/tmp/montager/{stem}_{hash}/{video}.preview.html`
- Opens automatically in default browser
- Shows crop overlay and timeline
- Applies transforms (gap filling, wide breaks)

### Render Agent
**Task**: Produce final montage video

```bash
python montager.py /render [video_path]
```

**Outputs**: `{video}_montage.mp4` (in source directory)
- 1920x1080, H.264, CRF 18
- Auto-switches between speaker crops and wide shot

## Library Usage

```python
from montager import (
    detect_scene, detect_voicemap,
    generate_preview, render_montage,
    fill_gaps_with_wide, insert_wide_breaks
)
from pathlib import Path

video = Path("video.mp4")
scene_path = detect_scene(video)
voicemap_path = detect_voicemap(video)
preview_path = generate_preview(video)
output_path = render_montage(video)
```

## Module Structure

```
montager/
├── constants.py     # OUTPUT_WIDTH, thresholds, etc.
├── models.py        # Speaker, SceneData, VoiceMapData
├── video.py         # find_video_file(), get_cache_dir()
├── detection.py     # detect_scene(), face detection
├── diarization.py   # detect_voicemap(), speaker clustering
├── transforms.py    # fill_gaps, insert_wide_breaks, merge
├── preview.py       # generate_preview()
└── render.py        # render_montage()

montager_gui.py      # PyQt5 desktop GUI
test_gui_e2e.py      # E2E tests (pytest-qt)
```

## File Dependencies

```
video.mp4
    ├─→ /detect-scene → /tmp/montager/.../video.scene.json
    │                           ↓
    ├─→ /detect-voicemap → /tmp/montager/.../video.voicemap.json
    │                           ↓
    ├─→ /preview → /tmp/montager/.../video.preview.html
    │
    └─→ /render → video_montage.mp4
```

## Transforms (applied at preview/render time)

Voicemap stays "pure" (raw detection). Transforms are applied dynamically:

1. **fill_gaps_with_wide()** - Short gaps (<3s) extend previous speaker; longer gaps use wide shot
2. **merge_adjacent_segments()** - Merge consecutive same-speaker segments
3. **insert_wide_breaks()** - Add 2s wide breaks every 8s in segments >15s

## Environment Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Testing

```bash
# E2E GUI test (uses C0023.MP4)
pytest test_gui_e2e.py -v -s

# Quick import test
python -c "from montager import detect_scene; print('OK')"
```

## Error Handling

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | Error (check stderr) |

**Troubleshooting:**
- GUI logs: `~/.montager/gui.log`
- torchcodec errors: Uses soundfile backend for audio loading
- "No video file found": No .mp4/.mov/.avi/.mkv in directory
- "FFmpeg error": Check ffmpeg installation
- Missing model: `blaze_face_short_range.tflite` should be in project root

## Modifying Behavior

Edit `montager/constants.py`:
```python
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080
MIN_SPEECH_DURATION = 2.0       # Seconds before speaker switch
LONG_SPEAKER_THRESHOLD = 15.0   # Triggers wide breaks
WIDE_BREAK_INTERVAL = 8.0       # Break frequency
WIDE_BREAK_DURATION = 2.0       # Break length
```
