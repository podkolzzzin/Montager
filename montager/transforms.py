"""
Segment transformations for visual editing.
"""

from typing import List

from .constants import LONG_SPEAKER_THRESHOLD, WIDE_BREAK_INTERVAL, WIDE_BREAK_DURATION


def fill_gaps_with_wide(segments: List[dict], duration: float) -> List[dict]:
    """Fill gaps between segments - short gaps extend previous speaker, long gaps use wide."""
    if not segments:
        return [{'start': 0, 'end': duration, 'speaker_id': 'wide'}]
    
    segments = sorted(segments, key=lambda s: s['start'])
    
    MIN_GAP_FOR_WIDE = 3.0
    
    filled = []
    last_end = 0
    
    for seg in segments:
        gap = seg['start'] - last_end
        
        if gap > 0.05:
            if gap < MIN_GAP_FOR_WIDE:
                if filled:
                    filled[-1]['end'] = seg['start']
                else:
                    filled.append({
                        'start': round(last_end, 3),
                        'end': round(seg['start'], 3),
                        'speaker_id': 'wide'
                    })
            else:
                filled.append({
                    'start': round(last_end, 3),
                    'end': round(seg['start'], 3),
                    'speaker_id': 'wide'
                })
        
        filled.append(seg)
        last_end = seg['end']
    
    if last_end < duration - 0.05:
        filled.append({
            'start': round(last_end, 3),
            'end': round(duration, 3),
            'speaker_id': 'wide'
        })
    
    return filled


def insert_wide_breaks(segments: List[dict]) -> List[dict]:
    """Insert wide shot breaks into long single-speaker segments."""
    result = []
    
    for seg in segments:
        duration = seg['end'] - seg['start']
        speaker = seg.get('speaker_id', 'wide')
        
        if speaker != 'wide' and duration >= LONG_SPEAKER_THRESHOLD:
            pos = seg['start']
            while pos < seg['end']:
                chunk_end = min(pos + WIDE_BREAK_INTERVAL, seg['end'])
                result.append({
                    'start': round(pos, 3),
                    'end': round(chunk_end, 3),
                    'speaker_id': speaker
                })
                pos = chunk_end
                
                remaining = seg['end'] - pos
                if remaining > WIDE_BREAK_DURATION + 3.0:
                    result.append({
                        'start': round(pos, 3),
                        'end': round(pos + WIDE_BREAK_DURATION, 3),
                        'speaker_id': 'wide'
                    })
                    pos += WIDE_BREAK_DURATION
        else:
            result.append(seg)
    
    return result


def merge_adjacent_segments(segments: List[dict]) -> List[dict]:
    """Merge adjacent segments with the same speaker."""
    if not segments:
        return segments
    
    merged = [segments[0].copy()]
    for seg in segments[1:]:
        last = merged[-1]
        if last['speaker_id'] == seg['speaker_id'] and abs(last['end'] - seg['start']) < 0.1:
            last['end'] = seg['end']
        else:
            merged.append(seg.copy())
    
    return merged


def merge_speaker_segments(segments: List[dict]) -> List[dict]:
    """Merge adjacent segments with the same speaker if gap is very small."""
    if not segments:
        return segments
    
    merged = [segments[0].copy()]
    for seg in segments[1:]:
        last = merged[-1]
        if (last.get('speaker_id') == seg.get('speaker_id') and 
            seg['start'] - last['end'] < 0.5):
            last['end'] = seg['end']
        else:
            merged.append(seg.copy())
    
    return merged
