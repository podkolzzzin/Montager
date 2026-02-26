"""
Face detection and scene analysis.
"""

import json
from dataclasses import asdict
from pathlib import Path
from typing import List, Tuple

from .constants import OUTPUT_WIDTH, OUTPUT_HEIGHT
from .models import Speaker, SceneData
from .video import get_video_info, get_cache_dir


def calculate_crop_rect(center_x: int, center_y: int, video_width: int, video_height: int) -> Tuple[int, int, int, int]:
    """Calculate crop rectangle centered on a point for speaker close-up."""
    if video_width > OUTPUT_WIDTH and video_height > OUTPUT_HEIGHT:
        crop_w = OUTPUT_WIDTH
        crop_h = OUTPUT_HEIGHT
    else:
        crop_w = int(video_width * 0.6)
        crop_h = int(video_height * 0.6)
        if crop_w / crop_h > 16/9:
            crop_w = int(crop_h * 16 / 9)
        else:
            crop_h = int(crop_w * 9 / 16)
    
    x = center_x - crop_w // 2
    y = center_y - crop_h // 2
    
    x = max(0, min(x, video_width - crop_w))
    y = max(0, min(y, video_height - crop_h))
    
    return (x, y, crop_w, crop_h)


def detect_faces_mediapipe(video_path: Path) -> SceneData:
    """Detect faces using MediaPipe Tasks API and create speaker profiles."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    import urllib.request
    
    print("Initializing face detection...")
    
    # Download model if not present
    model_path = Path(__file__).parent.parent / "blaze_face_short_range.tflite"
    if not model_path.exists():
        print("Downloading face detection model...")
        url = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
        urllib.request.urlretrieve(url, model_path)
    
    base_options = python.BaseOptions(model_asset_path=str(model_path))
    options = vision.FaceDetectorOptions(
        base_options=base_options,
        min_detection_confidence=0.5
    )
    detector = vision.FaceDetector.create_from_options(options)
    
    info = get_video_info(video_path)
    cap = cv2.VideoCapture(str(video_path))
    
    sample_duration = min(30, info['duration'])
    num_samples = 20
    timestamps = [i * sample_duration / num_samples for i in range(num_samples)]
    
    all_faces = []
    
    for ts in timestamps:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ret, frame = cap.read()
        if not ret:
            continue
        
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        
        results = detector.detect(mp_image)
        
        for detection in results.detections:
            bbox = detection.bounding_box
            x = bbox.origin_x
            y = bbox.origin_y
            fw = bbox.width
            fh = bbox.height
            
            center_x = x + fw // 2
            
            all_faces.append({
                'timestamp': ts,
                'bbox': (x, y, fw, fh),
                'center_x': center_x,
                'center_y': y + fh // 2
            })
    
    cap.release()
    print(f"Found {len(all_faces)} face detections")
    
    speakers = cluster_faces_by_position(all_faces, info['width'], info['height'])
    print(f"Identified {len(speakers)} unique speakers")
    
    return SceneData(
        video_path=str(video_path),
        width=info['width'],
        height=info['height'],
        fps=info['fps'],
        duration=info['duration'],
        speakers=[asdict(s) for s in speakers]
    )


def cluster_faces_by_position(faces: List[dict], video_width: int, video_height: int) -> List[Speaker]:
    """Cluster face detections by horizontal position."""
    if not faces:
        return []
    
    regions = {}
    region_width = video_width // 3
    
    for face in faces:
        region = face['center_x'] // region_width
        region = min(region, 2)
        if region not in regions:
            regions[region] = []
        regions[region].append(face)
    
    valid_regions = {k: v for k, v in regions.items() if len(v) >= 3}
    
    speakers = []
    for region_id in sorted(valid_regions.keys()):
        faces_in_region = valid_regions[region_id]
        
        avg_x = sum(f['center_x'] for f in faces_in_region) // len(faces_in_region)
        avg_y = sum(f['center_y'] for f in faces_in_region) // len(faces_in_region)
        avg_w = sum(f['bbox'][2] for f in faces_in_region) // len(faces_in_region)
        avg_h = sum(f['bbox'][3] for f in faces_in_region) // len(faces_in_region)
        
        crop_rect = calculate_crop_rect(avg_x, avg_y, video_width, video_height)
        
        speakers.append(Speaker(
            id=f"speaker_{len(speakers)+1}",
            name=f"Speaker {len(speakers)+1}",
            bbox=(avg_x - avg_w//2, avg_y - avg_h//2, avg_w, avg_h),
            crop_rect=crop_rect
        ))
    
    return speakers


def detect_scene(video_path: Path) -> Path:
    """Run scene detection and save results."""
    scene_data = detect_faces_mediapipe(video_path)
    
    cache_dir = get_cache_dir(video_path)
    output_path = cache_dir / f"{video_path.stem}.scene.json"
    with open(output_path, 'w') as f:
        json.dump(asdict(scene_data), f, indent=2)
    
    print(f"✅ Scene data saved to: {output_path}")
    return output_path
