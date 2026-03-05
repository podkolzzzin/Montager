namespace Montager.Core.Interfaces;

/// <summary>
/// HTML preview generation service.
/// </summary>
public interface IPreviewService
{
    /// <summary>
    /// Generate HTML preview player.
    /// </summary>
    Task<string> GeneratePreviewAsync(string videoPath, IProgress<string>? progress = null);
}
