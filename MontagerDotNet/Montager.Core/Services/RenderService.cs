using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Montager.Core.Interfaces;
using Montager.Core.Models;

namespace Montager.Core.Services;

/// <summary>
/// FFmpeg-based video montage rendering.
/// </summary>
public class RenderService : IRenderService
{
    private readonly IVideoService _videoService;
    private readonly IDetectionService _detectionService;
    private readonly IDiarizationService _diarizationService;
    
    public RenderService(
        IVideoService videoService,
        IDetectionService detectionService,
        IDiarizationService diarizationService)
    {
        _videoService = videoService;
        _detectionService = detectionService;
        _diarizationService = diarizationService;
    }
    
    /// <summary>
    /// Render the final montage video.
    /// </summary>
    public async Task<string> RenderMontageAsync(
        string videoPath,
        IProgress<string>? progress = null)
    {
        var scenePath = _videoService.GetScenePath(videoPath);
        var voiceMapPath = _videoService.GetVoiceMapPath(videoPath);
        
        // Auto-run detection if needed
        if (!File.Exists(scenePath))
        {
            progress?.Report("Scene data not found, running scene detection...");
            await _detectionService.DetectSceneAsync(videoPath, progress);
        }
        
        if (!File.Exists(voiceMapPath))
        {
            progress?.Report("Voice map not found, running voice detection...");
            await _diarizationService.DetectVoiceMapAsync(videoPath, null, progress);
        }
        
        var sceneJson = await File.ReadAllTextAsync(scenePath);
        var voiceMapJson = await File.ReadAllTextAsync(voiceMapPath);
        
        var sceneData = JsonSerializer.Deserialize<SceneData>(sceneJson)
            ?? throw new InvalidOperationException("Failed to parse scene data");
        var voiceMapData = JsonSerializer.Deserialize<VoiceMapData>(voiceMapJson)
            ?? throw new InvalidOperationException("Failed to parse voice map");
        
        progress?.Report("Generating edit decision list...");
        var edl = GenerateEditDecisionList(sceneData, voiceMapData);
        progress?.Report($"Created {edl.Count} edit segments");
        
        var speakers = sceneData.Speakers.ToDictionary(s => s.Id);
        
        // Find which speakers are actually used
        var usedSpeakers = edl.Select(e => e.View)
            .Where(v => speakers.ContainsKey(v))
            .Distinct()
            .ToHashSet();
        
        // Build ffmpeg filter
        var filters = new List<string>();
        
        // Wide shot stream
        filters.Add($"[0:v]scale={Constants.OutputWidth}:{Constants.OutputHeight}:" +
            $"force_original_aspect_ratio=decrease,pad={Constants.OutputWidth}:{Constants.OutputHeight}:-1:-1,setsar=1[wide]");
        
        // Speaker crop streams (only for speakers that are used)
        foreach (var speaker in sceneData.Speakers.Where(s => usedSpeakers.Contains(s.Id)))
        {
            var cr = speaker.CropRect;
            filters.Add($"[0:v]crop={cr[2]}:{cr[3]}:{cr[0]}:{cr[1]}," +
                $"scale={Constants.OutputWidth}:{Constants.OutputHeight},setsar=1[{speaker.Id}]");
        }
        
        // Create segments
        var segNames = new List<string>();
        for (int i = 0; i < edl.Count; i++)
        {
            var seg = edl[i];
            var src = speakers.ContainsKey(seg.View) ? seg.View : "wide";
            var name = $"seg{i}";
            filters.Add($"[{src}]trim={seg.Start}:{seg.End},setpts=PTS-STARTPTS[{name}]");
            segNames.Add($"[{name}]");
        }
        
        // Concatenate
        filters.Add($"{string.Join("", segNames)}concat=n={edl.Count}:v=1:a=0[outv]");
        
        var filterComplex = string.Join(";", filters);
        var outputPath = _videoService.GetOutputPath(videoPath);
        
        var args = new StringBuilder();
        args.Append($"-y -i \"{videoPath}\" ");
        args.Append($"-filter_complex \"{filterComplex}\" ");
        args.Append("-map \"[outv]\" -map 0:a ");
        args.Append("-c:v libx264 -preset medium -crf 18 ");
        args.Append("-c:a aac -b:a 192k ");
        args.Append($"\"{outputPath}\"");
        
        progress?.Report($"Rendering to: {outputPath}");
        
        var psi = new ProcessStartInfo
        {
            FileName = "ffmpeg",
            Arguments = args.ToString(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start ffmpeg");
        
        // Read stderr for progress (ffmpeg outputs to stderr)
        var stderr = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        
        if (process.ExitCode != 0)
        {
            var errorMsg = stderr.Length > 2000 ? stderr[^2000..] : stderr;
            throw new InvalidOperationException($"FFmpeg render failed:\n{errorMsg}");
        }
        
        progress?.Report($"✅ Montage rendered: {outputPath}");
        return outputPath;
    }
    
    /// <summary>
    /// Generate edit decision list from scene and voicemap data.
    /// </summary>
    public static List<EditEntry> GenerateEditDecisionList(SceneData sceneData, VoiceMapData voiceMapData)
    {
        var segments = TransformService.ApplyAllTransforms(
            voiceMapData.Segments,
            sceneData.Duration);
        
        return segments.Select(seg => new EditEntry
        {
            Start = seg.Start,
            End = seg.End,
            View = string.IsNullOrEmpty(seg.SpeakerId) ? "wide" : seg.SpeakerId
        }).ToList();
    }
}
