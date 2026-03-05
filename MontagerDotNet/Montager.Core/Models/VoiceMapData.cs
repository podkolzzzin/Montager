using System.Text.Json.Serialization;

namespace Montager.Core.Models;

/// <summary>
/// Voice mapping results with speech segments.
/// </summary>
public record VoiceMapData
{
    /// <summary>Path to the source video file.</summary>
    [JsonPropertyName("video_path")]
    public required string VideoPath { get; init; }
    
    /// <summary>Detected speech segments.</summary>
    [JsonPropertyName("segments")]
    public required List<Segment> Segments { get; init; }
}

/// <summary>
/// A speech segment with speaker assignment.
/// </summary>
public record Segment
{
    /// <summary>Start time in seconds.</summary>
    [JsonPropertyName("start")]
    public required double Start { get; init; }
    
    /// <summary>End time in seconds.</summary>
    [JsonPropertyName("end")]
    public required double End { get; init; }
    
    /// <summary>Speaker ID or "wide" for wide shot.</summary>
    [JsonPropertyName("speaker_id")]
    public required string SpeakerId { get; init; }
    
    /// <summary>Duration of the segment in seconds.</summary>
    [JsonIgnore]
    public double Duration => End - Start;
}
