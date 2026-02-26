# CLAUDE.md - AI Agent Instructions

## Project Overview

Montager is a Python tool that creates automatic 3-camera montage from 4K video by detecting speakers and voice activity. It provides both CLI and GUI interfaces.

## Architecture

```
montager/                  # Main package
├── __init__.py            # Public API exports
├── constants.py           # Configuration constants
├── models.py              # Data classes (Speaker, SceneData, VoiceMapData)
├── video.py               # Video utilities (find_video_file, get_cache_dir)
├── detection.py           # Face detection (detect_scene, detect_faces_mediapipe)
├── diarization.py         # Voice detection (detect_voicemap, speaker clustering)
├── transforms.py          # Segment transforms (fill_gaps, insert_wide_breaks)
├── preview.py             # HTML preview generation
└── render.py              # FFmpeg montage rendering

montager.py                # Backward-compatible entry point
montager_cli.py            # CLI implementation
montager_gui.py            # PyQt5 desktop GUI
test_gui_e2e.py            # E2E tests for GUI
requirements.txt           # Python dependencies
blaze_face_short_range.tflite  # Face detection model
```

Cache files are stored in `/tmp/montager/{video_stem}_{hash}/`:
- `{video}.scene.json` - Face detection output
- `{video}.voicemap.json` - Voice activity output
- `{video}.preview.html` - Browser preview

GUI logs are written to `~/.montager/gui.log`

## Module Reference

| Module | Key Functions |
|--------|---------------|
| `detection` | `detect_scene()`, `detect_faces_mediapipe()`, `cluster_faces_by_position()` |
| `diarization` | `detect_voicemap()`, `detect_voice()`, `_diarize_pyannote()`, `_diarize_local()` |
| `transforms` | `fill_gaps_with_wide()`, `insert_wide_breaks()`, `merge_adjacent_segments()` |
| `preview` | `generate_preview()`, `generate_preview_html()` |
| `render` | `render_montage()`, `generate_edit_decision_list()` |
| `video` | `find_video_file()`, `get_cache_dir()`, `get_video_info()` |

## Usage

### GUI (Recommended)
```bash
source venv/bin/activate
python montager_gui.py
```
- Drag & drop or browse for video file
- Click "Preview" or "Render"
- Progress shown in status bar

### CLI
```bash
source venv/bin/activate
python montager.py /detect-scene [video]      # Face detection → .scene.json
python montager.py /detect-voicemap [video]   # Speaker diarization → .voicemap.json
python montager.py /preview [video]           # HTML preview (opens browser)
python montager.py /render [video]            # FFmpeg render → _montage.mp4
```

## Data Flow

```
Video → /detect-scene → .scene.json (speakers + crop rects)
                              ↓
Video → /detect-voicemap → .voicemap.json (raw speech segments)
                              ↓
/preview or /render → apply transforms → final output
```

**Transforms (applied at preview/render time):**
1. `fill_gaps_with_wide()` - Fill gaps with wide shot or extend previous speaker
2. `merge_adjacent_segments()` - Merge consecutive same-speaker segments
3. `insert_wide_breaks()` - Add wide shot cutaways in long segments (15s+)

## Speaker Diarization

Two-tier approach:

1. **With HF_TOKEN** (best quality):
   ```bash
   export HF_TOKEN=your_token
   ```
   Uses pyannote/speaker-diarization-3.1

2. **Without HF_TOKEN** (local fallback):
   - Silero VAD for speech/silence detection (uses soundfile for audio loading)
   - MFCC-based speaker embeddings
   - K-means clustering to identify speakers

## Constants (in `montager/constants.py`)

```python
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080
MIN_SPEECH_DURATION = 2.0      # Seconds before switching to speaker
LONG_SPEAKER_THRESHOLD = 15.0  # Triggers wide breaks
WIDE_BREAK_INTERVAL = 8.0      # How often to insert breaks
WIDE_BREAK_DURATION = 2.0      # Length of each break
```

## Library Usage

```python
from montager import (
    detect_scene, detect_voicemap,
    generate_preview, render_montage,
    fill_gaps_with_wide, insert_wide_breaks
)

video = Path("video.mp4")
detect_scene(video)
detect_voicemap(video)
generate_preview(video)
```

## Testing

```bash
# E2E GUI test
pytest test_gui_e2e.py -v -s

# CLI tests (all should exit 0)
python montager.py --help
python montager.py /detect-scene
python montager.py /preview
```

## Troubleshooting

1. **GUI logs**: Check `~/.montager/gui.log` for errors
2. **torchcodec JSON error**: Fixed by using soundfile for audio loading
3. **mediapipe.solutions not found**: Uses Tasks API, not legacy API
4. **FFmpeg filter error**: Check crop coordinates within video bounds
5. **Poor speaker separation**: Set HF_TOKEN for pyannote diarization

## Extending

To add new functionality:
1. Add functions to appropriate module (detection, transforms, etc.)
2. Export from `montager/__init__.py`
3. If CLI command needed, add to `montager_cli.py`
4. If GUI feature needed, add to `montager_gui.py`
