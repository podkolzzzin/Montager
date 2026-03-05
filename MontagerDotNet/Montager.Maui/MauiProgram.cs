// Fallback console UI when MAUI workload is not installed.
// Install MAUI workload for full GUI: sudo dotnet workload install maui

using Montager.Core.Services;

namespace Montager.Maui;

/// <summary>
/// Fallback console-based UI for when MAUI is not available.
/// </summary>
class Program
{
    static async Task<int> Main(string[] args)
    {
        Console.WriteLine("🎬 Montager - Console Mode");
        Console.WriteLine("(Install MAUI workload for GUI: sudo dotnet workload install maui)\n");

        string? videoPath = null;

        if (args.Length > 0)
        {
            videoPath = args[0];
        }
        else
        {
            Console.Write("Enter video path (or press Enter to scan directory): ");
            var input = Console.ReadLine()?.Trim();
            if (!string.IsNullOrEmpty(input))
                videoPath = input;
        }

        try
        {
            videoPath = VideoService.FindVideoFile(videoPath);
            Console.WriteLine($"📹 Selected: {Path.GetFileName(videoPath)}\n");

            Console.WriteLine("Choose action:");
            Console.WriteLine("  1. Preview (detect + generate HTML)");
            Console.WriteLine("  2. Render (detect + generate montage)");
            Console.WriteLine("  3. Exit");
            Console.Write("\nChoice [1/2/3]: ");

            var choice = Console.ReadLine()?.Trim();
            var progress = new Progress<string>(msg => Console.WriteLine($"  {msg}"));

            switch (choice)
            {
                case "1":
                    Console.WriteLine("\n--- Running Preview Pipeline ---");
                    using (var detector = new DetectionService())
                        await detector.DetectSceneAsync(videoPath, progress);
                    using (var diarizer = new DiarizationService())
                        await diarizer.DetectVoiceMapAsync(videoPath, null, progress);
                    await PreviewService.GeneratePreviewAsync(videoPath, progress);
                    Console.WriteLine("\n✅ Preview complete!");
                    break;

                case "2":
                    Console.WriteLine("\n--- Running Render Pipeline ---");
                    await RenderService.RenderMontageAsync(videoPath, progress);
                    Console.WriteLine("\n✅ Render complete!");
                    break;

                default:
                    Console.WriteLine("Exiting.");
                    break;
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"\n❌ Error: {ex.Message}");
            return 1;
        }
    }
}
