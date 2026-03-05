using Montager.Core.Models;

namespace Montager.Core.Services;

/// <summary>
/// Segment transformations for visual editing.
/// </summary>
public static class TransformService
{
    /// <summary>
    /// Fill gaps between segments - short gaps extend previous speaker, long gaps use wide.
    /// </summary>
    public static List<Segment> FillGapsWithWide(List<Segment> segments, double duration)
    {
        const double MinGapForWide = 3.0;
        const double MinGapThreshold = 0.05;
        
        if (segments.Count == 0)
        {
            return [new Segment { Start = 0, End = duration, SpeakerId = "wide" }];
        }
        
        var sorted = segments.OrderBy(s => s.Start).ToList();
        var filled = new List<Segment>();
        double lastEnd = 0;
        
        foreach (var seg in sorted)
        {
            var gap = seg.Start - lastEnd;
            
            if (gap > MinGapThreshold)
            {
                if (gap < MinGapForWide && filled.Count > 0)
                {
                    // Extend previous segment
                    var last = filled[^1];
                    filled[^1] = last with { End = seg.Start };
                }
                else
                {
                    // Insert wide shot
                    filled.Add(new Segment
                    {
                        Start = Math.Round(lastEnd, 3),
                        End = Math.Round(seg.Start, 3),
                        SpeakerId = "wide"
                    });
                }
            }
            
            filled.Add(seg);
            lastEnd = seg.End;
        }
        
        // Handle end of video
        if (lastEnd < duration - MinGapThreshold)
        {
            filled.Add(new Segment
            {
                Start = Math.Round(lastEnd, 3),
                End = Math.Round(duration, 3),
                SpeakerId = "wide"
            });
        }
        
        return filled;
    }
    
    /// <summary>
    /// Merge adjacent segments with the same speaker.
    /// </summary>
    public static List<Segment> MergeAdjacentSegments(List<Segment> segments)
    {
        if (segments.Count == 0)
            return segments;
        
        var merged = new List<Segment> { segments[0] };
        
        foreach (var seg in segments.Skip(1))
        {
            var last = merged[^1];
            if (last.SpeakerId == seg.SpeakerId && Math.Abs(last.End - seg.Start) < 0.1)
            {
                merged[^1] = last with { End = seg.End };
            }
            else
            {
                merged.Add(seg);
            }
        }
        
        return merged;
    }
    
    /// <summary>
    /// Insert wide shot breaks into long single-speaker segments.
    /// </summary>
    public static List<Segment> InsertWideBreaks(List<Segment> segments)
    {
        var result = new List<Segment>();
        
        foreach (var seg in segments)
        {
            var segDuration = seg.End - seg.Start;
            var speaker = seg.SpeakerId;
            
            if (speaker != "wide" && segDuration >= Constants.LongSpeakerThreshold)
            {
                var pos = seg.Start;
                
                while (pos < seg.End)
                {
                    var chunkEnd = Math.Min(pos + Constants.WideBreakInterval, seg.End);
                    result.Add(new Segment
                    {
                        Start = Math.Round(pos, 3),
                        End = Math.Round(chunkEnd, 3),
                        SpeakerId = speaker
                    });
                    pos = chunkEnd;
                    
                    var remaining = seg.End - pos;
                    if (remaining > Constants.WideBreakDuration + 3.0)
                    {
                        result.Add(new Segment
                        {
                            Start = Math.Round(pos, 3),
                            End = Math.Round(pos + Constants.WideBreakDuration, 3),
                            SpeakerId = "wide"
                        });
                        pos += Constants.WideBreakDuration;
                    }
                }
            }
            else
            {
                result.Add(seg);
            }
        }
        
        return result;
    }
    
    /// <summary>
    /// Apply all transforms to segments.
    /// </summary>
    public static List<Segment> ApplyAllTransforms(List<Segment> segments, double duration)
    {
        var result = FillGapsWithWide(segments, duration);
        result = MergeAdjacentSegments(result);
        result = InsertWideBreaks(result);
        return result;
    }
}
