namespace Montager.Core.Models;

/// <summary>
/// Video metadata from ffprobe.
/// </summary>
public record VideoInfo
{
    /// <summary>Video width in pixels.</summary>
    public required int Width { get; init; }
    
    /// <summary>Video height in pixels.</summary>
    public required int Height { get; init; }
    
    /// <summary>Frames per second.</summary>
    public required double Fps { get; init; }
    
    /// <summary>Duration in seconds.</summary>
    public required double Duration { get; init; }
}

/// <summary>
/// Edit decision list entry for rendering.
/// </summary>
public record EditEntry
{
    /// <summary>Start time in seconds.</summary>
    public required double Start { get; init; }
    
    /// <summary>End time in seconds.</summary>
    public required double End { get; init; }
    
    /// <summary>View to use (speaker_id or "wide").</summary>
    public required string View { get; init; }
}
