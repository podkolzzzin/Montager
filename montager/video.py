"""
Video file utilities - finding, caching, and metadata extraction.
"""

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


def find_video_file(path: Optional[str] = None) -> Path:
    """Find video file from path or first video in current directory."""
    if path:
        p = Path(path)
        if p.exists():
            return p
        raise FileNotFoundError(f"Video file not found: {path}")
    
    video_extensions = {'.mp4', '.MP4', '.mov', '.MOV', '.avi', '.AVI', '.mkv', '.MKV'}
    for f in sorted(Path('.').iterdir()):
        if f.suffix in video_extensions:
            return f
    raise FileNotFoundError("No video file found in current directory")


def get_cache_dir(video_path: Path) -> Path:
    """Get cache directory for video intermediate files.
    
    Creates a unique folder based on hash(name + mtime + size) in system temp.
    """
    stat = video_path.stat()
    hash_input = f"{video_path.name}:{stat.st_mtime}:{stat.st_size}"
    video_hash = hashlib.md5(hash_input.encode()).hexdigest()[:12]
    
    cache_dir = Path(tempfile.gettempdir()) / "montager" / f"{video_path.stem}_{video_hash}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    return cache_dir


def get_video_info(video_path: Path) -> dict:
    """Get video metadata using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_streams', '-show_format', str(video_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)
    
    video_stream = next(s for s in data['streams'] if s['codec_type'] == 'video')
    return {
        'width': int(video_stream['width']),
        'height': int(video_stream['height']),
        'fps': eval(video_stream['r_frame_rate']),
        'duration': float(data['format']['duration'])
    }
