using Montager.Core.Models;

namespace Montager.Core.Interfaces;

/// <summary>
/// Speaker diarization service using VAD and clustering.
/// </summary>
public interface IDiarizationService : IDisposable
{
    /// <summary>
    /// Run voice activity detection and speaker clustering, save results.
    /// </summary>
    Task<string> DetectVoiceMapAsync(string videoPath, SceneData? sceneData = null, IProgress<string>? progress = null);
}
