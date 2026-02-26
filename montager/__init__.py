"""
Montager - Automatic 3-camera montage from 4K video.

Detects speakers and voice activity to create professional-looking
multi-camera edits from a single wide-shot video.
"""

from .constants import (
    OUTPUT_WIDTH, OUTPUT_HEIGHT,
    MIN_SPEECH_DURATION,
    LONG_SPEAKER_THRESHOLD,
    WIDE_BREAK_INTERVAL,
    WIDE_BREAK_DURATION,
)
from .models import Speaker, SceneData, VoiceMapData
from .video import find_video_file, get_cache_dir, get_video_info
from .detection import detect_scene, detect_faces_mediapipe, cluster_faces_by_position
from .diarization import detect_voicemap
from .transforms import fill_gaps_with_wide, merge_adjacent_segments, insert_wide_breaks
from .preview import generate_preview
from .render import render_montage, generate_edit_decision_list

__version__ = "1.0.0"

__all__ = [
    # Constants
    "OUTPUT_WIDTH", "OUTPUT_HEIGHT",
    "MIN_SPEECH_DURATION", "LONG_SPEAKER_THRESHOLD",
    "WIDE_BREAK_INTERVAL", "WIDE_BREAK_DURATION",
    # Models
    "Speaker", "SceneData", "VoiceMapData",
    # Video utilities
    "find_video_file", "get_cache_dir", "get_video_info",
    # Detection
    "detect_scene", "detect_faces_mediapipe", "cluster_faces_by_position",
    # Diarization
    "detect_voicemap",
    # Transforms
    "fill_gaps_with_wide", "merge_adjacent_segments", "insert_wide_breaks",
    # Preview & Render
    "generate_preview", "render_montage", "generate_edit_decision_list",
]
