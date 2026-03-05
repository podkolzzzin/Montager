using Montager.Core.Services;

namespace Montager.Cli;

/// <summary>
/// Montager CLI - Command-line interface for video montage generation.
/// </summary>
class Program
{
    static async Task<int> Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help")
        {
            PrintHelp();
            return 0;
        }

        var command = args[0].ToLowerInvariant();
        var videoArg = args.Length > 1 ? args[1] : null;

        try
        {
            var videoPath = VideoService.FindVideoFile(videoArg);
            var progress = new Progress<string>(Console.WriteLine);

            switch (command)
            {
                case "/detect-scene":
                    using (var detector = new DetectionService())
                    {
                        await detector.DetectSceneAsync(videoPath, progress);
                    }
                    break;

                case "/detect-voicemap":
                    using (var diarizer = new DiarizationService())
                    {
                        await diarizer.DetectVoiceMapAsync(videoPath, null, progress);
                    }
                    break;

                case "/preview":
                    await PreviewService.GeneratePreviewAsync(videoPath, progress);
                    break;

                case "/render":
                    await RenderService.RenderMontageAsync(videoPath, progress);
                    break;

                default:
                    Console.Error.WriteLine($"Unknown command: {command}");
                    PrintHelp();
                    return 1;
            }

            return 0;
        }
        catch (FileNotFoundException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
    }

    static void PrintHelp()
    {
        Console.WriteLine("""
            Montager CLI - Automatic 3-camera montage generation
            
            Usage:
                montager <command> [video_path]
            
            Commands:
                /detect-scene [video]    - Detect faces and generate scene.json
                /detect-voicemap [video] - Detect speech segments and map to speakers
                /preview [video]         - Generate HTML preview
                /render [video]          - Render final montage video
            
            If video_path is omitted, uses first video file in current directory.
            """);
    }
}
