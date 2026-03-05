using Microsoft.Maui.Controls;
using Montager.Core.Services;

namespace Montager.Maui;

public partial class MainPage : ContentPage
{
    private string? _videoPath;
    private bool _isProcessing;

    public MainPage()
    {
        InitializeComponent();
    }

    private async void OnBrowseClicked(object sender, EventArgs e)
    {
        if (_isProcessing)
            return;

        try
        {
            var result = await FilePicker.PickAsync(new PickOptions
            {
                FileTypes = new FilePickerFileType(
                    new Dictionary<DevicePlatform, IEnumerable<string>>
                    {
                        { DevicePlatform.WinUI, new[] { ".mp4", ".mov", ".avi", ".mkv", ".webm" } },
                        { DevicePlatform.macOS, new[] { "public.movie" } },
                        { DevicePlatform.iOS, new[] { "public.movie" } },
                        { DevicePlatform.Android, new[] { "video/*" } }
                    }),
                PickerTitle = "Select a video file"
            });

            if (result != null)
            {
                SetVideoFile(result.FullPath);
            }
        }
        catch (Exception ex)
        {
            await DisplayAlert("Error", $"Failed to select file: {ex.Message}", "OK");
        }
    }

    private void SetVideoFile(string path)
    {
        _videoPath = path;
        var fileName = Path.GetFileName(path);
        FileLabel.Text = $"📹 {fileName}";
        FileLabel.TextColor = Color.FromArgb("#00ff88");
        PreviewButton.IsEnabled = true;
        RenderButton.IsEnabled = true;
        StatusLabel.Text = $"Ready: {fileName}";
    }

    private void SetProcessing(bool active)
    {
        _isProcessing = active;
        PreviewButton.IsEnabled = !active && _videoPath != null;
        RenderButton.IsEnabled = !active && _videoPath != null;
        BrowseButton.IsEnabled = !active;
        ProgressIndicator.IsVisible = active;
        ProgressIndicator.IsRunning = active;
    }

    private async void OnPreviewClicked(object sender, EventArgs e)
    {
        if (_videoPath == null || _isProcessing)
            return;

        SetProcessing(true);

        try
        {
            var progress = new Progress<string>(msg => 
                MainThread.BeginInvokeOnMainThread(() => StatusLabel.Text = msg));

            await Task.Run(async () =>
            {
                progress.Report("Detecting faces...");
                using var detector = new DetectionService();
                await detector.DetectSceneAsync(_videoPath, progress);

                progress.Report("Detecting speech...");
                using var diarizer = new DiarizationService();
                await diarizer.DetectVoiceMapAsync(_videoPath, null, progress);

                progress.Report("Generating preview...");
                var previewPath = await PreviewService.GeneratePreviewAsync(_videoPath, progress);
            });

            await DisplayAlert("Complete", "Preview generated and opened in browser", "OK");
        }
        catch (Exception ex)
        {
            await DisplayAlert("Error", ex.Message, "OK");
            StatusLabel.Text = $"Error: {ex.Message}";
        }
        finally
        {
            SetProcessing(false);
        }
    }

    private async void OnRenderClicked(object sender, EventArgs e)
    {
        if (_videoPath == null || _isProcessing)
            return;

        SetProcessing(true);

        try
        {
            var progress = new Progress<string>(msg => 
                MainThread.BeginInvokeOnMainThread(() => StatusLabel.Text = msg));

            string outputPath = "";
            await Task.Run(async () =>
            {
                progress.Report("Detecting faces...");
                using var detector = new DetectionService();
                await detector.DetectSceneAsync(_videoPath, progress);

                progress.Report("Detecting speech...");
                using var diarizer = new DiarizationService();
                await diarizer.DetectVoiceMapAsync(_videoPath, null, progress);

                progress.Report("Rendering montage...");
                outputPath = await RenderService.RenderMontageAsync(_videoPath, progress);
            });

            await DisplayAlert("Complete", $"Rendered: {Path.GetFileName(outputPath)}", "OK");
            StatusLabel.Text = $"Rendered: {Path.GetFileName(outputPath)}";
        }
        catch (Exception ex)
        {
            await DisplayAlert("Error", ex.Message, "OK");
            StatusLabel.Text = $"Error: {ex.Message}";
        }
        finally
        {
            SetProcessing(false);
        }
    }
}
