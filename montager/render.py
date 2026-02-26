"""
Render - FFmpeg-based video montage rendering.
"""

import json
import subprocess
from pathlib import Path
from typing import Dict, List

from .constants import (
    OUTPUT_WIDTH, OUTPUT_HEIGHT,
    MIN_SPEECH_DURATION, LONG_SPEAKER_THRESHOLD,
    WIDE_BREAK_INTERVAL, WIDE_BREAK_DURATION
)
from .video import get_cache_dir
from .detection import detect_scene
from .diarization import detect_voicemap
from .transforms import fill_gaps_with_wide, merge_adjacent_segments, insert_wide_breaks


def generate_edit_decision_list(scene_data: dict, voicemap_data: dict) -> List[dict]:
    """Generate edit decision list for final render using same transforms as preview."""
    segments = voicemap_data.get('segments', [])
    duration = scene_data.get('duration', 0)
    
    # Apply same transforms as preview
    segments = fill_gaps_with_wide(segments, duration)
    segments = merge_adjacent_segments(segments)
    segments = insert_wide_breaks(segments)
    
    # Convert segments to EDL format
    edl = []
    for seg in segments:
        speaker_id = seg.get('speaker_id', 'wide')
        edl.append({
            'start': seg['start'],
            'end': seg['end'],
            'view': speaker_id if speaker_id else 'wide'
        })
    
    return edl


def render_montage(video_path: Path) -> Path:
    """Render the final montage video."""
    cache_dir = get_cache_dir(video_path)
    scene_path = cache_dir / f"{video_path.stem}.scene.json"
    voicemap_path = cache_dir / f"{video_path.stem}.voicemap.json"
    
    if not scene_path.exists():
        print("Scene data not found, running scene detection...")
        scene_path = detect_scene(video_path)
    
    if not voicemap_path.exists():
        print("Voice map not found, running voice detection...")
        voicemap_path = detect_voicemap(video_path, scene_path)
    
    with open(scene_path) as f:
        scene_data = json.load(f)
    with open(voicemap_path) as f:
        voicemap_data = json.load(f)
    
    print("Generating edit decision list...")
    edl = generate_edit_decision_list(scene_data, voicemap_data)
    print(f"Created {len(edl)} edit segments")
    
    speakers = {s['id']: s for s in scene_data.get('speakers', [])}
    
    # Build ffmpeg filter
    filters = []
    filters.append(f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:-1:-1,setsar=1[wide]")
    
    for sid, speaker in speakers.items():
        x, y, w, h = speaker['crop_rect']
        filters.append(f"[0:v]crop={w}:{h}:{x}:{y},scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},setsar=1[{sid}]")
    
    # Create segments
    seg_names = []
    for i, seg in enumerate(edl):
        view = seg['view']
        src = view if view in speakers else 'wide'
        name = f"seg{i}"
        filters.append(f"[{src}]trim={seg['start']}:{seg['end']},setpts=PTS-STARTPTS[{name}]")
        seg_names.append(f"[{name}]")
    
    filters.append(f"{''.join(seg_names)}concat=n={len(edl)}:v=1:a=0[outv]")
    
    filter_complex = ';'.join(filters)
    output_path = video_path.with_stem(video_path.stem + '_montage').with_suffix('.mp4')
    
    cmd = [
        'ffmpeg', '-y', '-i', str(video_path),
        '-filter_complex', filter_complex,
        '-map', '[outv]', '-map', '0:a',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        str(output_path)
    ]
    
    print(f"Rendering to: {output_path}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"FFmpeg error:\n{result.stderr[-2000:]}")
        raise RuntimeError("FFmpeg render failed")
    
    print(f"✅ Montage rendered: {output_path}")
    return output_path
