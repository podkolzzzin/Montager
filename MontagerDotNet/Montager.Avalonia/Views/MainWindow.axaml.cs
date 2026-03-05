using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Montager.Avalonia.ViewModels;

namespace Montager.Avalonia.Views;

public partial class MainWindow : Window
{
    private bool _isDraggingTrimStart;
    private bool _isDraggingTrimEnd;
    private Border? _timelineTrack;
    private Border? _playhead;
    private DispatcherTimer? _playheadTimer;

    public MainWindow()
    {
        InitializeComponent();
        
        AddHandler(DragDrop.DropEvent, OnDrop);
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        
        var browseButton = this.FindControl<Button>("BrowseButton");
        if (browseButton != null)
        {
            browseButton.Click += async (s, e) => await BrowseForVideo();
        }
        
        _timelineTrack = this.FindControl<Border>("TimelineTrack");
        _playhead = this.FindControl<Border>("Playhead");
        
        SetupTrimHandles();
        SetupPlayheadTimer();
    }
    
    protected override void OnLoaded(global::Avalonia.Interactivity.RoutedEventArgs e)
    {
        base.OnLoaded(e);
        if (DataContext is MainWindowViewModel vm)
        {
            vm.InitializeLibVLC();
        }
    }
    
    private void SetupTrimHandles()
    {
        var trimStart = this.FindControl<Border>("TrimStartHandle");
        var trimEnd = this.FindControl<Border>("TrimEndHandle");
        
        if (trimStart != null)
        {
            trimStart.PointerPressed += (s, e) => _isDraggingTrimStart = true;
            trimStart.PointerReleased += (s, e) => _isDraggingTrimStart = false;
            trimStart.PointerMoved += OnTrimStartMoved;
        }
        
        if (trimEnd != null)
        {
            trimEnd.PointerPressed += (s, e) => _isDraggingTrimEnd = true;
            trimEnd.PointerReleased += (s, e) => _isDraggingTrimEnd = false;
            trimEnd.PointerMoved += OnTrimEndMoved;
        }
    }
    
    private void SetupPlayheadTimer()
    {
        _playheadTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _playheadTimer.Tick += (s, e) => UpdatePlayheadPosition();
        _playheadTimer.Start();
    }
    
    private void UpdatePlayheadPosition()
    {
        if (_playhead == null || _timelineTrack == null) return;
        if (DataContext is not MainWindowViewModel vm) return;
        if (vm.VideoDurationSeconds <= 0) return;
        
        var ratio = vm.CurrentPosition / vm.VideoDurationSeconds;
        var trackWidth = _timelineTrack.Bounds.Width;
        Canvas.SetLeft(_playhead, ratio * trackWidth);
    }

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        e.DragEffects = e.Data.Contains(DataFormats.Files) 
            ? DragDropEffects.Copy 
            : DragDropEffects.None;
    }

    private void OnDrop(object? sender, DragEventArgs e)
    {
        if (e.Data.Contains(DataFormats.Files))
        {
            var files = e.Data.GetFiles();
            if (files != null)
            {
                foreach (var file in files)
                {
                    var path = file.Path.LocalPath;
                    if (IsVideoFile(path))
                    {
                        SetVideoPath(path);
                        break;
                    }
                }
            }
        }
    }

    private async Task BrowseForVideo()
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Select Video File",
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("Video Files")
                {
                    Patterns = new[] { "*.mp4", "*.mov", "*.avi", "*.mkv", "*.webm" }
                },
                FilePickerFileTypes.All
            }
        });

        if (files.Count > 0)
        {
            SetVideoPath(files[0].Path.LocalPath);
        }
    }

    private void SetVideoPath(string path)
    {
        if (DataContext is MainWindowViewModel vm)
        {
            vm.SetVideoPath(path);
        }
    }

    private static bool IsVideoFile(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext is ".mp4" or ".mov" or ".avi" or ".mkv" or ".webm";
    }
    
    private void OnTimelinePointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_timelineTrack == null || DataContext is not MainWindowViewModel vm) return;
        
        var pos = e.GetPosition(_timelineTrack);
        var ratio = pos.X / _timelineTrack.Bounds.Width;
        var seekPos = ratio * vm.VideoDurationSeconds;
        vm.SeekToPosition(seekPos);
    }
    
    private void OnTrimStartMoved(object? sender, PointerEventArgs e)
    {
        if (!_isDraggingTrimStart || _timelineTrack == null) return;
        if (DataContext is not MainWindowViewModel vm) return;
        
        var pos = e.GetPosition(_timelineTrack);
        var ratio = Math.Clamp(pos.X / _timelineTrack.Bounds.Width, 0, 1);
        vm.TrimStart = ratio * vm.VideoDurationSeconds;
    }
    
    private void OnTrimEndMoved(object? sender, PointerEventArgs e)
    {
        if (!_isDraggingTrimEnd || _timelineTrack == null) return;
        if (DataContext is not MainWindowViewModel vm) return;
        
        var pos = e.GetPosition(_timelineTrack);
        var ratio = Math.Clamp(pos.X / _timelineTrack.Bounds.Width, 0, 1);
        vm.TrimEnd = ratio * vm.VideoDurationSeconds;
    }
    
    protected override void OnClosed(EventArgs e)
    {
        _playheadTimer?.Stop();
        if (DataContext is MainWindowViewModel vm)
        {
            vm.Dispose();
        }
        base.OnClosed(e);
    }
}
