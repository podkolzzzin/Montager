using System.Diagnostics;
using System.Text.Json;
using Montager.Core.Interfaces;
using Montager.Core.Models;

namespace Montager.Core.Services;

/// <summary>
/// HTML preview generation with video player and crop overlay.
/// </summary>
public class PreviewService : IPreviewService
{
    private readonly IVideoService _videoService;
    
    public PreviewService(IVideoService videoService)
    {
        _videoService = videoService;
    }
    
    /// <summary>
    /// Generate HTML preview player.
    /// </summary>
    public async Task<string> GeneratePreviewAsync(
        string videoPath,
        IProgress<string>? progress = null)
    {
        var scenePath = _videoService.GetScenePath(videoPath);
        var voiceMapPath = _videoService.GetVoiceMapPath(videoPath);
        
        SceneData? sceneData = null;
        VoiceMapData? voiceMapData = null;
        
        if (File.Exists(scenePath))
        {
            var json = await File.ReadAllTextAsync(scenePath);
            sceneData = JsonSerializer.Deserialize<SceneData>(json);
        }
        
        if (File.Exists(voiceMapPath))
        {
            var json = await File.ReadAllTextAsync(voiceMapPath);
            voiceMapData = JsonSerializer.Deserialize<VoiceMapData>(json);
        }
        
        // Apply visual editing transformations
        List<Segment> segments = [];
        if (voiceMapData != null && sceneData != null)
        {
            segments = TransformService.ApplyAllTransforms(
                voiceMapData.Segments,
                sceneData.Duration);
        }
        
        var html = GeneratePreviewHtml(videoPath, sceneData, segments);
        
        var outputPath = _videoService.GetPreviewPath(videoPath);
        await File.WriteAllTextAsync(outputPath, html);
        
        progress?.Report($"✅ Preview saved to: {outputPath}");
        
        // Try to open in browser
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = outputPath,
                UseShellExecute = true
            };
            Process.Start(psi);
            progress?.Report("🌐 Opening in browser...");
        }
        catch (Exception ex)
        {
            progress?.Report($"ℹ️ Could not open browser: {ex.Message}");
        }
        
        return outputPath;
    }

    private static string GeneratePreviewHtml(
        string videoPath,
        SceneData? sceneData,
        List<Segment> segments)
    {
        var speakersJson = JsonSerializer.Serialize(
            sceneData?.Speakers ?? [],
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });
        
        var segmentsJson = JsonSerializer.Serialize(
            segments.Select(s => new { start = s.Start, end = s.End, speaker_id = s.SpeakerId }),
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });
        
        var videoWidth = sceneData?.Width ?? 1920;
        var videoHeight = sceneData?.Height ?? 1080;
        var videoName = Path.GetFileName(videoPath);
        var videoAbsolutePath = Path.GetFullPath(videoPath);
        var speakerCount = sceneData?.Speakers.Count ?? 0;

        return $$"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Montager Preview - {{videoName}}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .video-wrapper { position: relative; background: #000; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
        .video-wrapper video { width: 100%; display: block; }
        .crop-indicator { position: absolute; pointer-events: none; border: 3px solid #00ff88; transition: all 0.2s ease; box-shadow: 0 0 20px rgba(0,255,136,0.3); }
        .speaker-label { position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.8); padding: 8px 16px; border-radius: 4px; font-size: 14px; font-weight: bold; color: #00ff88; }
        .timeline { background: #16213e; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .timeline h3 { margin-bottom: 15px; color: #00ff88; }
        .timeline-track { height: 50px; background: #0f0f23; border-radius: 4px; position: relative; overflow: hidden; cursor: pointer; }
        .timeline-segment { position: absolute; height: 100%; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #fff; font-weight: bold; }
        .timeline-segment.speaker_1 { background: #e74c3c; }
        .timeline-segment.speaker_2 { background: #3498db; }
        .timeline-segment.wide { background: #9b59b6; }
        .playhead { position: absolute; width: 3px; height: 100%; background: #00ff88; top: 0; z-index: 10; pointer-events: none; }
        .controls { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; }
        .controls button { background: #00ff88; color: #000; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .controls button:hover { background: #00cc6a; }
        .time-display { color: #00ff88; font-size: 18px; font-family: monospace; }
        .info { background: #16213e; border-radius: 8px; padding: 15px; }
        .info p { margin: 5px 0; color: #aaa; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 Montager Preview</h1>
        <div class="controls">
            <button onclick="togglePlay()" id="playBtn">▶️ Play</button>
            <button onclick="seek(-5)">⏪ -5s</button>
            <button onclick="seek(5)">⏩ +5s</button>
            <span class="time-display" id="timeDisplay">00:00 / 00:00</span>
        </div>
        <div class="video-wrapper">
            <video id="video" src="file://{{videoAbsolutePath}}" preload="auto"></video>
            <div class="crop-indicator" id="cropIndicator"></div>
            <div class="speaker-label" id="speakerLabel">Wide Shot</div>
        </div>
        <div class="timeline">
            <h3>Timeline (click to seek)</h3>
            <div class="timeline-track" id="timeline" onclick="seekTo(event)">
                <div class="playhead" id="playhead"></div>
            </div>
        </div>
        <div class="info">
            <p><strong>Source:</strong> {{videoName}} ({{videoWidth}}x{{videoHeight}})</p>
            <p><strong>Speakers:</strong> {{speakerCount}} detected</p>
        </div>
    </div>
    <script>
        const speakers = {{speakersJson}};
        const segments = {{segmentsJson}};
        const video = document.getElementById('video');
        const cropIndicator = document.getElementById('cropIndicator');
        const speakerLabel = document.getElementById('speakerLabel');
        const playhead = document.getElementById('playhead');
        const timeDisplay = document.getElementById('timeDisplay');
        const playBtn = document.getElementById('playBtn');
        const videoWidth = {{videoWidth}};
        const videoHeight = {{videoHeight}};
        const colors = {'speaker_1': '#e74c3c', 'speaker_2': '#3498db', 'wide': '#9b59b6'};
        let currentView = null;

        function setupTimeline() {
            const timeline = document.getElementById('timeline');
            const dur = video.duration || 1;
            segments.forEach(seg => {
                const div = document.createElement('div');
                div.className = 'timeline-segment ' + (seg.speaker_id || 'wide');
                div.style.left = (seg.start / dur * 100) + '%';
                div.style.width = ((seg.end - seg.start) / dur * 100) + '%';
                div.textContent = seg.speaker_id === 'wide' ? 'W' : seg.speaker_id.replace('speaker_', 'S');
                timeline.appendChild(div);
            });
        }

        function getCurrentSpeaker() {
            const t = video.currentTime;
            for (const seg of segments) if (t >= seg.start && t < seg.end) return seg.speaker_id || 'wide';
            return 'wide';
        }

        function updateCropIndicator() {
            const view = getCurrentSpeaker();
            if (view === currentView) return;
            currentView = view;
            const rect = video.getBoundingClientRect();
            const scaleX = rect.width / videoWidth;
            const scaleY = rect.height / videoHeight;
            const speaker = speakers.find(s => s.id === view);
            const color = colors[view] || '#00ff88';
            if (speaker) {
                const cr = speaker.crop_rect;
                cropIndicator.style.left = (cr[0] * scaleX) + 'px';
                cropIndicator.style.top = (cr[1] * scaleY) + 'px';
                cropIndicator.style.width = (cr[2] * scaleX) + 'px';
                cropIndicator.style.height = (cr[3] * scaleY) + 'px';
                speakerLabel.textContent = speaker.name;
            } else {
                cropIndicator.style.left = '0'; cropIndicator.style.top = '0';
                cropIndicator.style.width = '100%'; cropIndicator.style.height = '100%';
                speakerLabel.textContent = 'Wide Shot';
            }
            cropIndicator.style.borderColor = color;
            speakerLabel.style.background = color;
        }

        function updateUI() {
            updateCropIndicator();
            playhead.style.left = (video.currentTime / video.duration * 100) + '%';
            const fmt = s => Math.floor(s/60).toString().padStart(2,'0') + ':' + Math.floor(s%60).toString().padStart(2,'0');
            timeDisplay.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
        }

        function togglePlay() { video.paused ? video.play() : video.pause(); }
        function seek(d) { video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + d)); }
        function seekTo(e) { const r = e.currentTarget.getBoundingClientRect(); video.currentTime = (e.clientX - r.left) / r.width * video.duration; }

        video.addEventListener('loadedmetadata', () => { setupTimeline(); updateUI(); });
        video.addEventListener('timeupdate', updateUI);
        video.addEventListener('play', () => playBtn.textContent = '⏸️ Pause');
        video.addEventListener('pause', () => playBtn.textContent = '▶️ Play');
        document.addEventListener('keydown', e => {
            if (e.code === 'Space') { togglePlay(); e.preventDefault(); }
            if (e.code === 'ArrowLeft') seek(-5);
            if (e.code === 'ArrowRight') seek(5);
        });
    </script>
</body>
</html>
""";
    }
}
