"""
Speaker diarization - voice activity detection and speaker identification.
"""

import json
import os
import subprocess
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional

from .models import SceneData, VoiceMapData
from .video import get_cache_dir


def detect_voice(video_path: Path, scene_data: SceneData) -> VoiceMapData:
    """Detect voice activity and speaker identity using speaker diarization."""
    import torch
    
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        audio_path = Path(tmp.name)
    
    try:
        print("Extracting audio...")
        subprocess.run([
            'ffmpeg', '-y', '-i', str(video_path),
            '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
            str(audio_path)
        ], capture_output=True, check=True)
        
        segments = None
        hf_token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_TOKEN')
        
        if hf_token:
            try:
                segments = _diarize_pyannote(audio_path, hf_token)
            except Exception as e:
                print(f"⚠️  pyannote failed: {e}")
                print("Falling back to local diarization...")
        else:
            print("ℹ️  No HF_TOKEN found - using local speaker diarization")
            print("   For best results, set HF_TOKEN and accept pyannote terms at:")
            print("   https://huggingface.co/pyannote/speaker-diarization-3.1")
        
        if segments is None:
            segments = _diarize_local(audio_path, scene_data)
        
        segments = _map_speakers_to_scene(segments, scene_data)
        print(f"Final: {len(segments)} segments")
        
    finally:
        if audio_path.exists():
            audio_path.unlink()
    
    return VoiceMapData(
        video_path=str(video_path),
        segments=segments
    )


def _diarize_pyannote(audio_path: Path, hf_token: str) -> List[dict]:
    """Full pyannote speaker diarization (requires HF token)."""
    from pyannote.audio import Pipeline
    import torch
    
    print("Loading pyannote speaker diarization model...")
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token
    )
    
    if torch.cuda.is_available():
        pipeline.to(torch.device("cuda"))
    
    print("Running speaker diarization (this may take a while)...")
    result = pipeline(str(audio_path))
    
    if hasattr(result, 'speaker_diarization'):
        diarization = result.speaker_diarization
    else:
        diarization = result
    
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            'start': round(turn.start, 3),
            'end': round(turn.end, 3),
            'speaker_label': speaker
        })
    
    print(f"Detected {len(segments)} speech segments with {len(set(s['speaker_label'] for s in segments))} speakers")
    return segments


def _diarize_local(audio_path: Path, scene_data: SceneData) -> List[dict]:
    """Local diarization using Silero VAD + MFCC embeddings."""
    import torch
    import soundfile as sf
    import numpy as np
    
    print("Running local speaker diarization...")
    
    # Use soundfile directly to avoid torchcodec issues
    waveform_np, sample_rate = sf.read(str(audio_path))
    waveform = torch.from_numpy(waveform_np).float()
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    else:
        waveform = waveform.T  # (samples, channels) -> (channels, samples)
    
    if sample_rate != 16000:
        import torchaudio
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        sample_rate = 16000
    
    # Ensure mono and squeeze for Silero VAD
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    wav = waveform.squeeze(0)  # Silero expects 1D tensor
    
    print("  Loading Silero VAD...")
    model, utils = torch.hub.load(
        repo_or_dir='snakers4/silero-vad',
        model='silero_vad',
        trust_repo=True
    )
    get_speech_timestamps = utils[0]
    
    print("  Detecting speech segments...")
    speech_timestamps = get_speech_timestamps(
        wav, model,
        sampling_rate=16000,
        threshold=0.35,
        min_speech_duration_ms=300,
        min_silence_duration_ms=200,
        speech_pad_ms=100
    )
    
    if not speech_timestamps:
        print("  No speech detected")
        return []
    
    raw_segments = []
    for ts in speech_timestamps:
        start_sec = ts['start'] / 16000
        end_sec = ts['end'] / 16000
        raw_segments.append({
            'start': round(start_sec, 3),
            'end': round(end_sec, 3),
            'start_sample': ts['start'],
            'end_sample': ts['end']
        })
    
    print(f"  Found {len(raw_segments)} speech segments")
    
    num_speakers = len(scene_data.speakers) if scene_data.speakers else 2
    
    if num_speakers >= 2 and len(raw_segments) >= 2:
        print(f"  Clustering into {num_speakers} speakers using embeddings...")
        raw_segments = _cluster_by_embeddings(raw_segments, waveform[0].numpy(), num_speakers)
    else:
        for seg in raw_segments:
            seg['speaker_label'] = 'SPEAKER_00'
    
    segments = []
    for seg in raw_segments:
        segments.append({
            'start': seg['start'],
            'end': seg['end'],
            'speaker_label': seg.get('speaker_label', 'SPEAKER_00')
        })
    
    return segments


def _cluster_by_embeddings(segments: List[dict], audio, num_speakers: int) -> List[dict]:
    """Cluster speech segments by speaker using audio embeddings."""
    import numpy as np
    from sklearn.cluster import KMeans
    
    embeddings = []
    
    for seg in segments:
        start = seg['start_sample']
        end = seg['end_sample']
        segment_audio = audio[start:end]
        
        if len(segment_audio) < 1600:
            embeddings.append(np.zeros(13))
            continue
        
        embedding = _compute_mfcc_embedding(segment_audio, 16000)
        embeddings.append(embedding)
    
    embeddings = np.array(embeddings)
    
    if len(embeddings) < num_speakers or np.all(embeddings == 0):
        for i, seg in enumerate(segments):
            seg['speaker_label'] = f'SPEAKER_{i % num_speakers:02d}'
        return segments
    
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings_norm = embeddings / norms
    
    kmeans = KMeans(n_clusters=num_speakers, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings_norm)
    
    for seg, label in zip(segments, labels):
        seg['speaker_label'] = f'SPEAKER_{label:02d}'
    
    return segments


def _compute_mfcc_embedding(audio, sr: int, n_mfcc: int = 13):
    """Compute MFCC-based embedding for speaker clustering."""
    import numpy as np
    
    audio = np.append(audio[0], audio[1:] - 0.97 * audio[:-1])
    
    frame_size = int(0.025 * sr)
    hop_size = int(0.010 * sr)
    
    num_frames = 1 + (len(audio) - frame_size) // hop_size
    if num_frames < 1:
        return np.zeros(n_mfcc)
    
    frames = np.zeros((num_frames, frame_size))
    for i in range(num_frames):
        start = i * hop_size
        frames[i] = audio[start:start + frame_size] * np.hamming(frame_size)
    
    nfft = 512
    power_spectrum = np.abs(np.fft.rfft(frames, nfft)) ** 2
    
    n_filters = 26
    low_freq = 0
    high_freq = sr // 2
    
    mel_low = 2595 * np.log10(1 + low_freq / 700)
    mel_high = 2595 * np.log10(1 + high_freq / 700)
    mel_points = np.linspace(mel_low, mel_high, n_filters + 2)
    hz_points = 700 * (10 ** (mel_points / 2595) - 1)
    bin_points = np.floor((nfft + 1) * hz_points / sr).astype(int)
    
    filterbank = np.zeros((n_filters, nfft // 2 + 1))
    for i in range(n_filters):
        for j in range(bin_points[i], bin_points[i + 1]):
            filterbank[i, j] = (j - bin_points[i]) / (bin_points[i + 1] - bin_points[i])
        for j in range(bin_points[i + 1], bin_points[i + 2]):
            filterbank[i, j] = (bin_points[i + 2] - j) / (bin_points[i + 2] - bin_points[i + 1])
    
    mel_spec = np.dot(power_spectrum, filterbank.T)
    mel_spec = np.where(mel_spec > 1e-10, mel_spec, 1e-10)
    log_mel = np.log(mel_spec)
    
    mfcc = np.zeros((num_frames, n_mfcc))
    for i in range(n_mfcc):
        mfcc[:, i] = np.sum(log_mel * np.cos(np.pi * i * (np.arange(n_filters) + 0.5) / n_filters), axis=1)
    
    return np.mean(mfcc, axis=0)


def _map_speakers_to_scene(segments: List[dict], scene_data: SceneData) -> List[dict]:
    """Map diarization speaker labels to scene.json speaker IDs."""
    if not segments:
        return segments
    
    speakers = scene_data.speakers
    
    if not speakers:
        for seg in segments:
            seg['speaker_id'] = 'wide'
            if 'speaker_label' in seg:
                del seg['speaker_label']
        return segments
    
    seen_labels = []
    for seg in segments:
        label = seg['speaker_label']
        if label not in seen_labels:
            seen_labels.append(label)
    
    if len(seen_labels) <= 1 or len(speakers) <= 1:
        speaker_id = speakers[0]['id'] if speakers else 'wide'
        for seg in segments:
            seg['speaker_id'] = speaker_id
            if 'speaker_label' in seg:
                del seg['speaker_label']
        return segments
    
    sorted_speakers = sorted(speakers, key=lambda s: s['bbox'][0])
    
    label_to_id = {}
    for i, label in enumerate(seen_labels):
        if i < len(sorted_speakers):
            label_to_id[label] = sorted_speakers[i]['id']
        else:
            label_to_id[label] = sorted_speakers[i % len(sorted_speakers)]['id']
    
    print(f"  Speaker mapping (by appearance order):")
    for label, vid in label_to_id.items():
        print(f"    {label} -> {vid}")
    
    for seg in segments:
        seg['speaker_id'] = label_to_id.get(seg.get('speaker_label', ''), 'wide')
        if 'speaker_label' in seg:
            del seg['speaker_label']
    
    return segments


def detect_voicemap(video_path: Path, scene_path: Optional[Path] = None) -> Path:
    """Run voice activity detection and save results to cache."""
    from .detection import detect_scene
    
    cache_dir = get_cache_dir(video_path)
    
    if scene_path is None:
        scene_path = cache_dir / f"{video_path.stem}.scene.json"
    
    if not scene_path.exists():
        print("Scene data not found, running scene detection first...")
        scene_path = detect_scene(video_path)
    
    with open(scene_path) as f:
        scene_dict = json.load(f)
    
    scene_data = SceneData(**scene_dict)
    voicemap_data = detect_voice(video_path, scene_data)
    
    output_path = cache_dir / f"{video_path.stem}.voicemap.json"
    with open(output_path, 'w') as f:
        json.dump(asdict(voicemap_data), f, indent=2)
    
    print(f"✅ Voice map saved to: {output_path}")
    return output_path
