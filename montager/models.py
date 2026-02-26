"""
Montager data models.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple


@dataclass
class Speaker:
    """Detected speaker with face location."""
    id: str
    name: str
    bbox: Tuple[int, int, int, int]  # x, y, width, height in original coords
    crop_rect: Tuple[int, int, int, int]  # x, y, width, height for 1080p crop


@dataclass 
class SceneData:
    """Scene detection results."""
    video_path: str
    width: int
    height: int
    fps: float
    duration: float
    speakers: List[Dict] = field(default_factory=list)


@dataclass
class VoiceMapData:
    """Voice mapping results."""
    video_path: str
    segments: List[Dict] = field(default_factory=list)
