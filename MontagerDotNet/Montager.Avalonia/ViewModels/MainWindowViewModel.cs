using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LibVLCSharp.Shared;
using Montager.Core.Interfaces;
using Montager.Core.Models;

namespace Montager.Avalonia.ViewModels;

public partial class MainWindowViewModel : ObservableObject, IDisposable
{
    private readonly IVideoService _videoService;
    private readonly IDetectionService _detectionService;
    private readonly IDiarizationService _diarizationService;
    private readonly IPreviewService _previewService;
    private readonly IRenderService _renderService;
    
    private LibVLC? _libVLC;
    private Media? _media;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DetectSceneCommand))]
    [NotifyCanExecuteChangedFor(nameof(DetectVoicemapCommand))]
    [NotifyCanExecuteChangedFor(nameof(PreviewCommand))]
    [NotifyCanExecuteChangedFor(nameof(RenderCommand))]
    [NotifyPropertyChangedFor(nameof(HasVideo))]
    [NotifyPropertyChangedFor(nameof(VideoFileName))]
    private string? _videoPath;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DetectSceneCommand))]
    [NotifyCanExecuteChangedFor(nameof(DetectVoicemapCommand))]
    [NotifyCanExecuteChangedFor(nameof(PreviewCommand))]
    [NotifyCanExecuteChangedFor(nameof(RenderCommand))]
    [NotifyCanExecuteChangedFor(nameof(BrowseCommand))]
    private bool _isProcessing;

    [ObservableProperty]
    private string _logOutput = "";

    [ObservableProperty]
    private double _progress;

    [ObservableProperty]
    private string _statusText = "Ready";

    [ObservableProperty]
    private int _speakerCount;
    
    [ObservableProperty]
    private MediaPlayer? _mediaPlayer;
    
    [ObservableProperty]
    private string _playPauseIcon = "▶";
    
    [ObservableProperty]
    private string _currentTimeDisplay = "00:00:00 / 00:00:00";
    
    [ObservableProperty]
    private string _videoResolution = "";
    
    [ObservableProperty]
    private string _videoDuration = "";
    
    [ObservableProperty]
    private double _trimStart;
    
    [ObservableProperty]
    private double _trimEnd;
    
    [ObservableProperty] 
    private double _currentPosition;
    
    [ObservableProperty]
    private double _videoDurationSeconds;

    public bool HasVideo => !string.IsNullOrEmpty(VideoPath);
    public string VideoFileName => string.IsNullOrEmpty(VideoPath) ? "" : Path.GetFileName(VideoPath);

    public ObservableCollection<SpeakerInfo> Speakers { get; } = [];

    public MainWindowViewModel(
        IVideoService videoService,
        IDetectionService detectionService,
        IDiarizationService diarizationService,
        IPreviewService previewService,
        IRenderService renderService)
    {
        _videoService = videoService;
        _detectionService = detectionService;
        _diarizationService = diarizationService;
        _previewService = previewService;
        _renderService = renderService;
    }

    private bool CanExecuteCommand => !string.IsNullOrEmpty(VideoPath) && !IsProcessing;
    private bool CanBrowse => !IsProcessing;

    [RelayCommand(CanExecute = nameof(CanBrowse))]
    private async Task BrowseAsync()
    {
        // This will be wired up in the view using file dialog
    }

    [RelayCommand(CanExecute = nameof(CanExecuteCommand))]
    private async Task DetectSceneAsync()
    {
        if (string.IsNullOrEmpty(VideoPath)) return;
        
        await RunOperationAsync("Detecting scene...", async progress =>
        {
            await _detectionService.DetectSceneAsync(VideoPath, progress);
            await LoadSceneDataAsync();
        });
    }

    [RelayCommand(CanExecute = nameof(CanExecuteCommand))]
    private async Task DetectVoicemapAsync()
    {
        if (string.IsNullOrEmpty(VideoPath)) return;
        
        await RunOperationAsync("Detecting voicemap...", async progress =>
        {
            await _diarizationService.DetectVoiceMapAsync(VideoPath, null, progress);
        });
    }

    [RelayCommand(CanExecute = nameof(CanExecuteCommand))]
    private async Task PreviewAsync()
    {
        if (string.IsNullOrEmpty(VideoPath)) return;
        
        await RunOperationAsync("Generating preview...", async progress =>
        {
            await _previewService.GeneratePreviewAsync(VideoPath, progress);
        });
    }

    [RelayCommand(CanExecute = nameof(CanExecuteCommand))]
    private async Task RenderAsync()
    {
        if (string.IsNullOrEmpty(VideoPath)) return;
        
        await RunOperationAsync("Rendering montage...", async progress =>
        {
            await _renderService.RenderMontageAsync(VideoPath, progress);
        });
    }

    private async Task RunOperationAsync(string statusMessage, Func<IProgress<string>, Task> operation)
    {
        IsProcessing = true;
        StatusText = statusMessage;
        Progress = 0;
        
        var progress = new Progress<string>(message =>
        {
            LogOutput += message + Environment.NewLine;
            
            // Simple progress estimation based on checkmarks
            if (message.Contains("✅"))
                Progress = 100;
            else
                Progress = Math.Min(Progress + 10, 90);
        });

        try
        {
            await Task.Run(() => operation(progress));
            StatusText = "Completed";
            Progress = 100;
        }
        catch (Exception ex)
        {
            LogOutput += $"❌ Error: {ex.Message}{Environment.NewLine}";
            StatusText = "Error";
        }
        finally
        {
            IsProcessing = false;
        }
    }

    public void SetVideoPath(string path)
    {
        VideoPath = path;
        LogOutput = $"Selected: {path}{Environment.NewLine}";
        StatusText = "Video loaded";
        
        InitializeMediaPlayer(path);
        _ = LoadSceneDataAsync();
    }
    
    public void InitializeLibVLC()
    {
        if (_libVLC == null)
        {
            LibVLCSharp.Shared.Core.Initialize();
            _libVLC = new LibVLC("--no-xlib");
            MediaPlayer = new MediaPlayer(_libVLC);
            
            MediaPlayer.PositionChanged += (s, e) =>
            {
                CurrentPosition = e.Position * VideoDurationSeconds;
                UpdateTimeDisplay();
            };
            
            MediaPlayer.Playing += (s, e) => PlayPauseIcon = "⏸";
            MediaPlayer.Paused += (s, e) => PlayPauseIcon = "▶";
            MediaPlayer.Stopped += (s, e) => PlayPauseIcon = "▶";
        }
    }
    
    private void InitializeMediaPlayer(string path)
    {
        if (_libVLC == null || MediaPlayer == null) return;
        
        _media?.Dispose();
        _media = new Media(_libVLC, path, FromType.FromPath);
        MediaPlayer.Media = _media;
        
        _media.Parse(MediaParseOptions.ParseLocal).ContinueWith(_ =>
        {
            if (_media.Duration > 0)
            {
                VideoDurationSeconds = _media.Duration / 1000.0;
                TrimEnd = VideoDurationSeconds;
                VideoDuration = FormatTime(VideoDurationSeconds);
                
                foreach (var track in _media.Tracks)
                {
                    if (track.TrackType == TrackType.Video)
                    {
                        VideoResolution = $"{track.Data.Video.Width}x{track.Data.Video.Height}";
                        break;
                    }
                }
            }
        });
    }
    
    [RelayCommand]
    private void PlayPause()
    {
        if (MediaPlayer == null) return;
        
        if (MediaPlayer.IsPlaying)
            MediaPlayer.Pause();
        else
            MediaPlayer.Play();
    }
    
    [RelayCommand]
    private void SeekStart()
    {
        if (MediaPlayer != null && VideoDurationSeconds > 0)
            MediaPlayer.Position = (float)(TrimStart / VideoDurationSeconds);
    }
    
    [RelayCommand]
    private void SeekEnd()
    {
        if (MediaPlayer != null && VideoDurationSeconds > 0)
            MediaPlayer.Position = (float)(TrimEnd / VideoDurationSeconds);
    }
    
    [RelayCommand]
    private void SeekBack()
    {
        if (MediaPlayer == null || VideoDurationSeconds == 0) return;
        var newPos = Math.Max(0, MediaPlayer.Position - 5.0f / (float)VideoDurationSeconds);
        MediaPlayer.Position = newPos;
    }
    
    [RelayCommand]
    private void SeekForward()
    {
        if (MediaPlayer == null || VideoDurationSeconds == 0) return;
        var newPos = Math.Min(1, MediaPlayer.Position + 5.0f / (float)VideoDurationSeconds);
        MediaPlayer.Position = newPos;
    }
    
    [RelayCommand]
    private void ClearLog() => LogOutput = "";
    
    public void SeekToPosition(double position)
    {
        if (MediaPlayer == null || VideoDurationSeconds == 0) return;
        MediaPlayer.Position = (float)(position / VideoDurationSeconds);
    }
    
    private void UpdateTimeDisplay()
    {
        var current = FormatTime(CurrentPosition);
        var total = FormatTime(VideoDurationSeconds);
        CurrentTimeDisplay = $"{current} / {total}";
    }
    
    private static string FormatTime(double seconds)
    {
        var ts = TimeSpan.FromSeconds(seconds);
        return ts.ToString(@"hh\:mm\:ss");
    }

    private async Task LoadSceneDataAsync()
    {
        if (string.IsNullOrEmpty(VideoPath)) return;
        
        try
        {
            var scenePath = _videoService.GetScenePath(VideoPath);
            if (File.Exists(scenePath))
            {
                var json = await File.ReadAllTextAsync(scenePath);
                var sceneData = JsonSerializer.Deserialize<SceneData>(json);
                
                if (sceneData != null)
                {
                    Speakers.Clear();
                    foreach (var speaker in sceneData.Speakers)
                    {
                        Speakers.Add(new SpeakerInfo(speaker.Id, speaker.Name));
                    }
                    SpeakerCount = Speakers.Count;
                }
            }
        }
        catch
        {
            // Ignore errors loading cached data
        }
    }
    
    public void Dispose()
    {
        MediaPlayer?.Stop();
        MediaPlayer?.Dispose();
        _media?.Dispose();
        _libVLC?.Dispose();
    }
}

public record SpeakerInfo(string Id, string Name);
