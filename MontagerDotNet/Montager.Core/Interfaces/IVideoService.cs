using Montager.Core.Models;

namespace Montager.Core.Interfaces;

/// <summary>
/// Video file utilities service.
/// </summary>
public interface IVideoService
{
    /// <summary>
    /// Find video file from path or first video in specified directory.
    /// </summary>
    string FindVideoFile(string? path = null, string? searchDirectory = null);
    
    /// <summary>
    /// Get cache directory for video intermediate files.
    /// </summary>
    string GetCacheDir(string videoPath);
    
    /// <summary>
    /// Get video metadata using ffprobe.
    /// </summary>
    Task<VideoInfo> GetVideoInfoAsync(string videoPath);
    
    /// <summary>
    /// Get the scene data file path for a video.
    /// </summary>
    string GetScenePath(string videoPath);
    
    /// <summary>
    /// Get the voicemap file path for a video.
    /// </summary>
    string GetVoiceMapPath(string videoPath);
    
    /// <summary>
    /// Get the preview HTML file path for a video.
    /// </summary>
    string GetPreviewPath(string videoPath);
    
    /// <summary>
    /// Get the output montage file path for a video.
    /// </summary>
    string GetOutputPath(string videoPath);
    
    /// <summary>
    /// Extract audio to WAV file using ffmpeg.
    /// </summary>
    Task<string> ExtractAudioAsync(string videoPath);
}
