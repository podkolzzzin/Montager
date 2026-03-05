using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Montager.Core.Models;

namespace Montager.Core.Services;

/// <summary>
/// Video file utilities - finding, caching, and metadata extraction.
/// </summary>
public static class VideoService
{
    /// <summary>
    /// Find video file from path or first video in specified directory.
    /// </summary>
    public static string FindVideoFile(string? path = null, string? searchDirectory = null)
    {
        if (!string.IsNullOrEmpty(path))
        {
            if (File.Exists(path))
                return Path.GetFullPath(path);
            throw new FileNotFoundException($"Video file not found: {path}");
        }
        
        var dir = searchDirectory ?? Directory.GetCurrentDirectory();
        
        foreach (var file in Directory.GetFiles(dir).OrderBy(f => f))
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (Constants.VideoExtensions.Contains(ext))
                return Path.GetFullPath(file);
        }
        
        throw new FileNotFoundException("No video file found in directory");
    }
    
    /// <summary>
    /// Get cache directory for video intermediate files.
    /// Creates a unique folder based on hash(name + mtime + size) in system temp.
    /// </summary>
    public static string GetCacheDir(string videoPath)
    {
        var fileInfo = new FileInfo(videoPath);
        var hashInput = $"{fileInfo.Name}:{fileInfo.LastWriteTimeUtc.Ticks}:{fileInfo.Length}";
        
        using var md5 = MD5.Create();
        var hashBytes = md5.ComputeHash(Encoding.UTF8.GetBytes(hashInput));
        var videoHash = Convert.ToHexString(hashBytes)[..12].ToLowerInvariant();
        
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        var cacheDir = Path.Combine(Path.GetTempPath(), "montager", $"{stem}_{videoHash}");
        
        Directory.CreateDirectory(cacheDir);
        return cacheDir;
    }
    
    /// <summary>
    /// Get video metadata using ffprobe.
    /// </summary>
    public static async Task<VideoInfo> GetVideoInfoAsync(string videoPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "ffprobe",
            Arguments = $"-v quiet -print_format json -show_streams -show_format \"{videoPath}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start ffprobe");
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        
        if (process.ExitCode != 0)
            throw new InvalidOperationException("ffprobe failed");
        
        using var doc = JsonDocument.Parse(output);
        var root = doc.RootElement;
        
        var videoStream = root.GetProperty("streams")
            .EnumerateArray()
            .First(s => s.GetProperty("codec_type").GetString() == "video");
        
        var width = videoStream.GetProperty("width").GetInt32();
        var height = videoStream.GetProperty("height").GetInt32();
        
        // Parse frame rate (e.g., "30000/1001" or "30")
        var fpsStr = videoStream.GetProperty("r_frame_rate").GetString()!;
        double fps;
        if (fpsStr.Contains('/'))
        {
            var parts = fpsStr.Split('/');
            fps = double.Parse(parts[0]) / double.Parse(parts[1]);
        }
        else
        {
            fps = double.Parse(fpsStr);
        }
        
        var duration = double.Parse(root.GetProperty("format").GetProperty("duration").GetString()!);
        
        return new VideoInfo
        {
            Width = width,
            Height = height,
            Fps = fps,
            Duration = duration
        };
    }
    
    /// <summary>
    /// Get the scene data file path for a video.
    /// </summary>
    public static string GetScenePath(string videoPath)
    {
        var cacheDir = GetCacheDir(videoPath);
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        return Path.Combine(cacheDir, $"{stem}.scene.json");
    }
    
    /// <summary>
    /// Get the voicemap file path for a video.
    /// </summary>
    public static string GetVoiceMapPath(string videoPath)
    {
        var cacheDir = GetCacheDir(videoPath);
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        return Path.Combine(cacheDir, $"{stem}.voicemap.json");
    }
    
    /// <summary>
    /// Get the preview HTML file path for a video.
    /// </summary>
    public static string GetPreviewPath(string videoPath)
    {
        var cacheDir = GetCacheDir(videoPath);
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        return Path.Combine(cacheDir, $"{stem}.preview.html");
    }
    
    /// <summary>
    /// Get the output montage file path for a video.
    /// </summary>
    public static string GetOutputPath(string videoPath)
    {
        var dir = Path.GetDirectoryName(videoPath) ?? ".";
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        return Path.Combine(dir, $"{stem}_montage.mp4");
    }
    
    /// <summary>
    /// Extract audio to WAV file using ffmpeg.
    /// </summary>
    public static async Task<string> ExtractAudioAsync(string videoPath)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}.wav");
        
        var psi = new ProcessStartInfo
        {
            FileName = "ffmpeg",
            Arguments = $"-y -i \"{videoPath}\" -vn -acodec pcm_s16le -ar 16000 -ac 1 \"{tempPath}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start ffmpeg");
        await process.WaitForExitAsync();
        
        if (process.ExitCode != 0 || !File.Exists(tempPath))
            throw new InvalidOperationException("Failed to extract audio");
        
        return tempPath;
    }
}
