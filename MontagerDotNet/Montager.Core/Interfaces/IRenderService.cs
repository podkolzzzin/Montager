namespace Montager.Core.Interfaces;

/// <summary>
/// FFmpeg-based video montage rendering service.
/// </summary>
public interface IRenderService
{
    /// <summary>
    /// Render the final montage video.
    /// </summary>
    Task<string> RenderMontageAsync(string videoPath, IProgress<string>? progress = null);
}
