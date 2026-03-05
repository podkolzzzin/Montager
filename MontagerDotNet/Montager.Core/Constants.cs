namespace Montager.Core;

/// <summary>
/// Configuration constants for montage generation.
/// </summary>
public static class Constants
{
    /// <summary>Output video width.</summary>
    public const int OutputWidth = 1920;
    
    /// <summary>Output video height.</summary>
    public const int OutputHeight = 1080;
    
    /// <summary>Minimum seconds before switching to a speaker.</summary>
    public const double MinSpeechDuration = 2.0;
    
    /// <summary>Gap threshold for wide shot insertion.</summary>
    public const double WideShotThreshold = 1.5;
    
    /// <summary>Segment length that triggers wide break insertion.</summary>
    public const double LongSpeakerThreshold = 15.0;
    
    /// <summary>How often to insert wide breaks in long segments.</summary>
    public const double WideBreakInterval = 8.0;
    
    /// <summary>Duration of each wide break cutaway.</summary>
    public const double WideBreakDuration = 2.0;
    
    /// <summary>Supported video file extensions.</summary>
    public static readonly string[] VideoExtensions = { ".mp4", ".mov", ".avi", ".mkv", ".webm" };
}
