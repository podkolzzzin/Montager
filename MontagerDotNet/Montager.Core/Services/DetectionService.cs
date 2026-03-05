using System.Text.Json;
using Montager.Core.Interfaces;
using Montager.Core.Models;
using OpenCvSharp;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Montager.Core.Services;

/// <summary>
/// Face detection and scene analysis using BlazeFace ONNX model.
/// </summary>
public class DetectionService : IDetectionService
{
    private InferenceSession? _session;
    private string? _modelPath;
    private readonly IVideoService _videoService;
    private bool _disposed;
    private bool _modelSearched;

    public DetectionService(IVideoService videoService, string? modelPath = null)
    {
        _videoService = videoService;
        _modelPath = modelPath;
    }

    private string? FindModelPath()
    {
        if (_modelSearched) return _modelPath;
        _modelSearched = true;
        
        // Look for model in common locations
        var locations = new[]
        {
            "blaze_face_short_range.onnx",
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "blaze_face_short_range.onnx"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Models", "blaze_face_short_range.onnx")
        };

        foreach (var loc in locations)
        {
            if (File.Exists(loc))
            {
                _modelPath = loc;
                return _modelPath;
            }
        }

        // No ONNX model found - will fall back to OpenCV cascade
        return null;
    }

    /// <summary>
    /// Run scene detection and save results.
    /// </summary>
    public async Task<string> DetectSceneAsync(string videoPath, IProgress<string>? progress = null)
    {
        progress?.Report("Initializing face detection...");
        
        var videoInfo = await _videoService.GetVideoInfoAsync(videoPath);
        var faces = DetectFacesInVideo(videoPath, videoInfo, progress);
        
        progress?.Report($"Found {faces.Count} face detections");
        
        var speakers = ClusterFacesByPosition(faces, videoInfo.Width, videoInfo.Height);
        progress?.Report($"Identified {speakers.Count} unique speakers");
        
        var sceneData = new SceneData
        {
            VideoPath = videoPath,
            Width = videoInfo.Width,
            Height = videoInfo.Height,
            Fps = videoInfo.Fps,
            Duration = videoInfo.Duration,
            Speakers = speakers.Select(SpeakerDto.FromSpeaker).ToList()
        };
        
        var outputPath = _videoService.GetScenePath(videoPath);
        var json = JsonSerializer.Serialize(sceneData, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(outputPath, json);
        
        progress?.Report($"✅ Scene data saved to: {outputPath}");
        return outputPath;
    }

    private List<FaceDetection> DetectFacesInVideo(string videoPath, VideoInfo info, IProgress<string>? progress)
    {
        var allFaces = new List<FaceDetection>();
        
        using var capture = new VideoCapture(videoPath);
        if (!capture.IsOpened())
            throw new InvalidOperationException($"Failed to open video: {videoPath}");
        
        var sampleDuration = Math.Min(30, info.Duration);
        const int numSamples = 20;
        var timestamps = Enumerable.Range(0, numSamples)
            .Select(i => i * sampleDuration / numSamples)
            .ToList();
        
        using var frame = new Mat();
        
        foreach (var ts in timestamps)
        {
            capture.Set(VideoCaptureProperties.PosMsec, ts * 1000);
            if (!capture.Read(frame) || frame.Empty())
                continue;
            
            var detections = DetectFacesInFrame(frame);
            foreach (var det in detections)
            {
                allFaces.Add(new FaceDetection
                {
                    Timestamp = ts,
                    X = det.X,
                    Y = det.Y,
                    Width = det.Width,
                    Height = det.Height,
                    CenterX = det.X + det.Width / 2,
                    CenterY = det.Y + det.Height / 2
                });
            }
        }
        
        return allFaces;
    }

    private List<BoundingBox> DetectFacesInFrame(Mat frame)
    {
        // Try ONNX model first, fall back to cascade
        var modelPath = FindModelPath();
        if (string.IsNullOrEmpty(modelPath))
        {
            return DetectFacesWithCascade(frame);
        }
        
        // Lazy initialize ONNX session
        _session ??= new InferenceSession(modelPath);
        
        var results = new List<BoundingBox>();
        
        // Preprocess: resize to model input size (128x128 for BlazeFace)
        const int inputSize = 128;
        using var resized = new Mat();
        Cv2.Resize(frame, resized, new OpenCvSharp.Size(inputSize, inputSize));
        
        // Convert to RGB float tensor normalized to [-1, 1]
        using var rgb = new Mat();
        Cv2.CvtColor(resized, rgb, ColorConversionCodes.BGR2RGB);
        
        var inputTensor = new DenseTensor<float>([1, 3, inputSize, inputSize]);
        
        for (int y = 0; y < inputSize; y++)
        {
            for (int x = 0; x < inputSize; x++)
            {
                var pixel = rgb.At<Vec3b>(y, x);
                inputTensor[0, 0, y, x] = (pixel.Item0 / 127.5f) - 1f; // R
                inputTensor[0, 1, y, x] = (pixel.Item1 / 127.5f) - 1f; // G
                inputTensor[0, 2, y, x] = (pixel.Item2 / 127.5f) - 1f; // B
            }
        }
        
        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input", inputTensor)
        };
        
        try
        {
            using var outputs = _session.Run(inputs);
            var outputList = outputs.ToList();
            
            // Parse detections (model-specific)
            // BlazeFace outputs: boxes and scores
            if (outputList.Count >= 2)
            {
                var boxes = outputList[0].AsTensor<float>();
                var scores = outputList[1].AsTensor<float>();
                
                var scaleX = (float)frame.Width / inputSize;
                var scaleY = (float)frame.Height / inputSize;
                
                for (int i = 0; i < scores.Length; i++)
                {
                    if (scores[i] > 0.5f) // Confidence threshold
                    {
                        // Box format: [ymin, xmin, ymax, xmax] normalized
                        int boxOffset = i * 4;
                        if (boxOffset + 3 < boxes.Length)
                        {
                            var ymin = boxes[boxOffset] * inputSize * scaleY;
                            var xmin = boxes[boxOffset + 1] * inputSize * scaleX;
                            var ymax = boxes[boxOffset + 2] * inputSize * scaleY;
                            var xmax = boxes[boxOffset + 3] * inputSize * scaleX;
                            
                            results.Add(new BoundingBox(
                                (int)xmin,
                                (int)ymin,
                                (int)(xmax - xmin),
                                (int)(ymax - ymin)
                            ));
                        }
                    }
                }
            }
        }
        catch (Exception)
        {
            // If ONNX inference fails, fall back to OpenCV cascade
            results = DetectFacesWithCascade(frame);
        }
        
        return results;
    }

    private static List<BoundingBox> DetectFacesWithCascade(Mat frame)
    {
        var results = new List<BoundingBox>();
        
        // Use OpenCV's built-in cascade classifier as fallback
        var cascadePath = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, 
            "haarcascade_frontalface_default.xml");
        
        if (!File.Exists(cascadePath))
        {
            // Try to find it in OpenCV data directory
            var opencvDataPaths = new[]
            {
                "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
                "/usr/share/opencv/haarcascades/haarcascade_frontalface_default.xml",
                "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml"
            };
            
            cascadePath = opencvDataPaths.FirstOrDefault(File.Exists) ?? "";
        }
        
        if (string.IsNullOrEmpty(cascadePath) || !File.Exists(cascadePath))
            return results;
        
        using var cascade = new CascadeClassifier(cascadePath);
        using var gray = new Mat();
        Cv2.CvtColor(frame, gray, ColorConversionCodes.BGR2GRAY);
        
        var faces = cascade.DetectMultiScale(
            gray,
            scaleFactor: 1.1,
            minNeighbors: 5,
            minSize: new OpenCvSharp.Size(30, 30));
        
        foreach (var face in faces)
        {
            results.Add(new BoundingBox(face.X, face.Y, face.Width, face.Height));
        }
        
        return results;
    }

    private static List<Speaker> ClusterFacesByPosition(
        List<FaceDetection> faces, int videoWidth, int videoHeight)
    {
        if (faces.Count == 0)
            return [];
        
        // Divide into 3 horizontal regions
        var regionWidth = videoWidth / 3;
        var regions = new Dictionary<int, List<FaceDetection>>();
        
        foreach (var face in faces)
        {
            var region = Math.Min(face.CenterX / regionWidth, 2);
            if (!regions.ContainsKey(region))
                regions[region] = [];
            regions[region].Add(face);
        }
        
        // Filter regions with at least 3 detections
        var validRegions = regions
            .Where(kv => kv.Value.Count >= 3)
            .OrderBy(kv => kv.Key)
            .ToList();
        
        var speakers = new List<Speaker>();
        
        foreach (var (_, facesInRegion) in validRegions)
        {
            var avgX = (int)facesInRegion.Average(f => f.CenterX);
            var avgY = (int)facesInRegion.Average(f => f.CenterY);
            var avgW = (int)facesInRegion.Average(f => f.Width);
            var avgH = (int)facesInRegion.Average(f => f.Height);
            
            var cropRect = CalculateCropRect(avgX, avgY, videoWidth, videoHeight);
            
            var speakerId = $"speaker_{speakers.Count + 1}";
            speakers.Add(new Speaker
            {
                Id = speakerId,
                Name = $"Speaker {speakers.Count + 1}",
                Bbox = new BoundingBox(avgX - avgW / 2, avgY - avgH / 2, avgW, avgH),
                CropRect = cropRect
            });
        }
        
        return speakers;
    }

    private static BoundingBox CalculateCropRect(int centerX, int centerY, int videoWidth, int videoHeight)
    {
        int cropW, cropH;
        
        if (videoWidth > Constants.OutputWidth && videoHeight > Constants.OutputHeight)
        {
            cropW = Constants.OutputWidth;
            cropH = Constants.OutputHeight;
        }
        else
        {
            cropW = (int)(videoWidth * 0.6);
            cropH = (int)(videoHeight * 0.6);
            
            // Maintain 16:9 aspect ratio
            if ((double)cropW / cropH > 16.0 / 9.0)
                cropW = (int)(cropH * 16.0 / 9.0);
            else
                cropH = (int)(cropW * 9.0 / 16.0);
        }
        
        var x = centerX - cropW / 2;
        var y = centerY - cropH / 2;
        
        // Clamp to video bounds
        x = Math.Max(0, Math.Min(x, videoWidth - cropW));
        y = Math.Max(0, Math.Min(y, videoHeight - cropH));
        
        return new BoundingBox(x, y, cropW, cropH);
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _session?.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }

    private record FaceDetection
    {
        public double Timestamp { get; init; }
        public int X { get; init; }
        public int Y { get; init; }
        public int Width { get; init; }
        public int Height { get; init; }
        public int CenterX { get; init; }
        public int CenterY { get; init; }
    }
}
