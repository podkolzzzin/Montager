namespace Montager.Core.Interfaces;

/// <summary>
/// Face detection and scene analysis service.
/// </summary>
public interface IDetectionService : IDisposable
{
    /// <summary>
    /// Run scene detection and save results.
    /// </summary>
    Task<string> DetectSceneAsync(string videoPath, IProgress<string>? progress = null);
}
