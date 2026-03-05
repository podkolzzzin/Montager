using System.Text.Json;
using Montager.Core.Interfaces;
using Montager.Core.Models;
using MathNet.Numerics.LinearAlgebra;
using MathNet.Numerics.Statistics;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using NAudio.Wave;

namespace Montager.Core.Services;

/// <summary>
/// Speaker diarization using Silero VAD + MFCC embeddings + K-means clustering.
/// </summary>
public class DiarizationService : IDiarizationService
{
    private InferenceSession? _vadSession;
    private readonly string? _vadModelPath;
    private readonly IVideoService _videoService;
    private readonly IDetectionService _detectionService;
    private bool _disposed;
    private const int SampleRate = 16000;

    public DiarizationService(IVideoService videoService, IDetectionService detectionService, string? vadModelPath = null)
    {
        _videoService = videoService;
        _detectionService = detectionService;
        _vadModelPath = vadModelPath;
    }

    /// <summary>
    /// Run voice activity detection and speaker clustering, save results.
    /// </summary>
    public async Task<string> DetectVoiceMapAsync(
        string videoPath,
        SceneData? sceneData = null,
        IProgress<string>? progress = null)
    {
        // Load scene data if not provided
        if (sceneData == null)
        {
            var scenePath = _videoService.GetScenePath(videoPath);
            if (!File.Exists(scenePath))
            {
                progress?.Report("Scene data not found, running scene detection first...");
                await _detectionService.DetectSceneAsync(videoPath, progress);
            }
            
            var json = await File.ReadAllTextAsync(scenePath);
            sceneData = JsonSerializer.Deserialize<SceneData>(json)
                ?? throw new InvalidOperationException("Failed to parse scene data");
        }
        
        progress?.Report("Extracting audio...");
        var audioPath = await _videoService.ExtractAudioAsync(videoPath);
        
        try
        {
            progress?.Report("Running local speaker diarization...");
            var segments = await DiarizeLocalAsync(audioPath, sceneData, progress);
            
            segments = MapSpeakersToScene(segments, sceneData);
            progress?.Report($"Final: {segments.Count} segments");
            
            var voiceMapData = new VoiceMapData
            {
                VideoPath = videoPath,
                Segments = segments
            };
            
            var outputPath = _videoService.GetVoiceMapPath(videoPath);
            var jsonOutput = JsonSerializer.Serialize(voiceMapData, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(outputPath, jsonOutput);
            
            progress?.Report($"✅ Voice map saved to: {outputPath}");
            return outputPath;
        }
        finally
        {
            if (File.Exists(audioPath))
                File.Delete(audioPath);
        }
    }

    private async Task<List<Segment>> DiarizeLocalAsync(
        string audioPath,
        SceneData sceneData,
        IProgress<string>? progress)
    {
        // Load audio
        progress?.Report("  Loading audio...");
        var (waveform, sampleRate) = LoadWavFile(audioPath);
        
        if (sampleRate != SampleRate)
        {
            waveform = ResampleAudio(waveform, sampleRate, SampleRate);
        }
        
        // Detect speech segments using energy-based VAD (simple fallback)
        progress?.Report("  Detecting speech segments...");
        var speechTimestamps = DetectSpeechSegments(waveform);
        
        if (speechTimestamps.Count == 0)
        {
            progress?.Report("  No speech detected");
            return [];
        }
        
        progress?.Report($"  Found {speechTimestamps.Count} speech segments");
        
        var numSpeakers = sceneData.Speakers.Count;
        if (numSpeakers == 0) numSpeakers = 2;
        
        var rawSegments = speechTimestamps.Select(ts => new RawSegment
        {
            Start = ts.Start,
            End = ts.End,
            StartSample = ts.StartSample,
            EndSample = ts.EndSample,
            SpeakerLabel = "SPEAKER_00"
        }).ToList();
        
        // Cluster by speaker if multiple speakers
        if (numSpeakers >= 2 && rawSegments.Count >= 2)
        {
            progress?.Report($"  Clustering into {numSpeakers} speakers using embeddings...");
            rawSegments = ClusterByEmbeddings(rawSegments, waveform, numSpeakers);
        }
        
        return rawSegments.Select(s => new Segment
        {
            Start = Math.Round(s.Start, 3),
            End = Math.Round(s.End, 3),
            SpeakerId = s.SpeakerLabel
        }).ToList();
    }

    private static (float[] Waveform, int SampleRate) LoadWavFile(string path)
    {
        using var reader = new WaveFileReader(path);
        var sampleRate = reader.WaveFormat.SampleRate;
        var samples = new List<float>();
        var buffer = new float[reader.WaveFormat.SampleRate];
        int samplesRead;
        
        var provider = reader.ToSampleProvider();
        while ((samplesRead = provider.Read(buffer, 0, buffer.Length)) > 0)
        {
            for (int i = 0; i < samplesRead; i++)
                samples.Add(buffer[i]);
        }
        
        return (samples.ToArray(), sampleRate);
    }

    private static float[] ResampleAudio(float[] audio, int fromRate, int toRate)
    {
        if (fromRate == toRate)
            return audio;
        
        var ratio = (double)toRate / fromRate;
        var newLength = (int)(audio.Length * ratio);
        var resampled = new float[newLength];
        
        for (int i = 0; i < newLength; i++)
        {
            var srcIdx = i / ratio;
            var srcIdxInt = (int)srcIdx;
            var frac = (float)(srcIdx - srcIdxInt);
            
            if (srcIdxInt + 1 < audio.Length)
                resampled[i] = audio[srcIdxInt] * (1 - frac) + audio[srcIdxInt + 1] * frac;
            else if (srcIdxInt < audio.Length)
                resampled[i] = audio[srcIdxInt];
        }
        
        return resampled;
    }

    private static List<SpeechTimestamp> DetectSpeechSegments(float[] waveform)
    {
        // Energy-based VAD (simple but effective fallback)
        const int frameSize = 512;
        const int hopSize = 256;
        const double threshold = 0.35;
        const int minSpeechFrames = 8; // ~128ms at 16kHz
        const int minSilenceFrames = 5; // ~80ms
        const int padFrames = 3;
        
        var energies = new List<double>();
        
        for (int i = 0; i + frameSize <= waveform.Length; i += hopSize)
        {
            double energy = 0;
            for (int j = 0; j < frameSize; j++)
            {
                energy += waveform[i + j] * waveform[i + j];
            }
            energies.Add(Math.Sqrt(energy / frameSize));
        }
        
        if (energies.Count == 0)
            return [];
        
        // Adaptive threshold based on energy distribution
        var sorted = energies.OrderBy(e => e).ToList();
        var medianEnergy = sorted[sorted.Count / 2];
        var adaptiveThreshold = medianEnergy * 2;
        var actualThreshold = Math.Max(threshold * sorted.Max(), adaptiveThreshold);
        
        // Find speech regions
        var isSpeech = energies.Select(e => e > actualThreshold).ToArray();
        
        // Apply smoothing
        var smoothed = new bool[isSpeech.Length];
        for (int i = 0; i < isSpeech.Length; i++)
        {
            int speechCount = 0;
            for (int j = Math.Max(0, i - 2); j <= Math.Min(isSpeech.Length - 1, i + 2); j++)
            {
                if (isSpeech[j]) speechCount++;
            }
            smoothed[i] = speechCount >= 3;
        }
        
        // Extract continuous segments
        var segments = new List<SpeechTimestamp>();
        int? segmentStart = null;
        int silenceCount = 0;
        
        for (int i = 0; i < smoothed.Length; i++)
        {
            if (smoothed[i])
            {
                if (segmentStart == null)
                    segmentStart = Math.Max(0, i - padFrames);
                silenceCount = 0;
            }
            else if (segmentStart != null)
            {
                silenceCount++;
                if (silenceCount >= minSilenceFrames)
                {
                    var endFrame = i - silenceCount + padFrames;
                    if (endFrame - segmentStart.Value >= minSpeechFrames)
                    {
                        segments.Add(new SpeechTimestamp
                        {
                            StartSample = segmentStart.Value * hopSize,
                            EndSample = Math.Min(endFrame * hopSize, waveform.Length),
                            Start = segmentStart.Value * hopSize / (double)SampleRate,
                            End = Math.Min(endFrame * hopSize, waveform.Length) / (double)SampleRate
                        });
                    }
                    segmentStart = null;
                    silenceCount = 0;
                }
            }
        }
        
        // Handle segment at end
        if (segmentStart != null)
        {
            var endFrame = smoothed.Length + padFrames;
            if (endFrame - segmentStart.Value >= minSpeechFrames)
            {
                segments.Add(new SpeechTimestamp
                {
                    StartSample = segmentStart.Value * hopSize,
                    EndSample = waveform.Length,
                    Start = segmentStart.Value * hopSize / (double)SampleRate,
                    End = waveform.Length / (double)SampleRate
                });
            }
        }
        
        return segments;
    }

    private static List<RawSegment> ClusterByEmbeddings(
        List<RawSegment> segments,
        float[] audio,
        int numSpeakers)
    {
        // Compute MFCC embeddings for each segment
        var embeddings = new List<double[]>();
        
        foreach (var seg in segments)
        {
            var segmentAudio = audio.Skip(seg.StartSample).Take(seg.EndSample - seg.StartSample).ToArray();
            
            if (segmentAudio.Length < 1600)
            {
                embeddings.Add(new double[13]);
                continue;
            }
            
            var embedding = ComputeMfccEmbedding(segmentAudio, SampleRate);
            embeddings.Add(embedding);
        }
        
        // Simple K-means clustering
        var labels = KMeansCluster(embeddings, numSpeakers);
        
        for (int i = 0; i < segments.Count; i++)
        {
            segments[i].SpeakerLabel = $"SPEAKER_{labels[i]:D2}";
        }
        
        return segments;
    }

    private static double[] ComputeMfccEmbedding(float[] audio, int sampleRate, int nMfcc = 13)
    {
        // Pre-emphasis
        var emphasized = new double[audio.Length];
        emphasized[0] = audio[0];
        for (int i = 1; i < audio.Length; i++)
        {
            emphasized[i] = audio[i] - 0.97 * audio[i - 1];
        }
        
        // Frame parameters
        int frameSize = (int)(0.025 * sampleRate);
        int hopSize = (int)(0.010 * sampleRate);
        int nfft = 512;
        int nFilters = 26;
        
        int numFrames = 1 + (emphasized.Length - frameSize) / hopSize;
        if (numFrames < 1)
            return new double[nMfcc];
        
        // Compute mel filterbank
        var filterbank = CreateMelFilterbank(nFilters, nfft, sampleRate);
        
        // Process frames
        var mfccs = new List<double[]>();
        var hammingWindow = CreateHammingWindow(frameSize);
        
        for (int f = 0; f < numFrames; f++)
        {
            int start = f * hopSize;
            
            // Apply window
            var frame = new double[nfft];
            for (int i = 0; i < frameSize && start + i < emphasized.Length; i++)
            {
                frame[i] = emphasized[start + i] * hammingWindow[i];
            }
            
            // Power spectrum (using simple DFT for this implementation)
            var powerSpectrum = ComputePowerSpectrum(frame);
            
            // Apply mel filterbank
            var melSpec = new double[nFilters];
            for (int i = 0; i < nFilters; i++)
            {
                for (int j = 0; j < powerSpectrum.Length && j < filterbank[i].Length; j++)
                {
                    melSpec[i] += powerSpectrum[j] * filterbank[i][j];
                }
                melSpec[i] = Math.Log(Math.Max(melSpec[i], 1e-10));
            }
            
            // DCT to get MFCCs
            var mfcc = new double[nMfcc];
            for (int i = 0; i < nMfcc; i++)
            {
                for (int j = 0; j < nFilters; j++)
                {
                    mfcc[i] += melSpec[j] * Math.Cos(Math.PI * i * (j + 0.5) / nFilters);
                }
            }
            mfccs.Add(mfcc);
        }
        
        // Return mean MFCC across frames
        var result = new double[nMfcc];
        foreach (var mfcc in mfccs)
        {
            for (int i = 0; i < nMfcc; i++)
            {
                result[i] += mfcc[i];
            }
        }
        for (int i = 0; i < nMfcc; i++)
        {
            result[i] /= mfccs.Count;
        }
        
        return result;
    }

    private static double[][] CreateMelFilterbank(int nFilters, int nfft, int sampleRate)
    {
        double lowFreq = 0;
        double highFreq = sampleRate / 2.0;
        
        double melLow = 2595 * Math.Log10(1 + lowFreq / 700);
        double melHigh = 2595 * Math.Log10(1 + highFreq / 700);
        
        var melPoints = new double[nFilters + 2];
        for (int i = 0; i < nFilters + 2; i++)
        {
            melPoints[i] = melLow + i * (melHigh - melLow) / (nFilters + 1);
        }
        
        var hzPoints = melPoints.Select(m => 700 * (Math.Pow(10, m / 2595) - 1)).ToArray();
        var binPoints = hzPoints.Select(hz => (int)Math.Floor((nfft + 1) * hz / sampleRate)).ToArray();
        
        var filterbank = new double[nFilters][];
        int spectrumSize = nfft / 2 + 1;
        
        for (int i = 0; i < nFilters; i++)
        {
            filterbank[i] = new double[spectrumSize];
            
            for (int j = binPoints[i]; j < binPoints[i + 1] && j < spectrumSize; j++)
            {
                filterbank[i][j] = (double)(j - binPoints[i]) / (binPoints[i + 1] - binPoints[i]);
            }
            for (int j = binPoints[i + 1]; j < binPoints[i + 2] && j < spectrumSize; j++)
            {
                filterbank[i][j] = (double)(binPoints[i + 2] - j) / (binPoints[i + 2] - binPoints[i + 1]);
            }
        }
        
        return filterbank;
    }

    private static double[] CreateHammingWindow(int size)
    {
        var window = new double[size];
        for (int i = 0; i < size; i++)
        {
            window[i] = 0.54 - 0.46 * Math.Cos(2 * Math.PI * i / (size - 1));
        }
        return window;
    }

    private static double[] ComputePowerSpectrum(double[] frame)
    {
        int n = frame.Length;
        int halfN = n / 2 + 1;
        var spectrum = new double[halfN];
        
        // Simple DFT (not FFT, but works for small sizes)
        for (int k = 0; k < halfN; k++)
        {
            double real = 0, imag = 0;
            for (int t = 0; t < n; t++)
            {
                double angle = 2 * Math.PI * k * t / n;
                real += frame[t] * Math.Cos(angle);
                imag -= frame[t] * Math.Sin(angle);
            }
            spectrum[k] = real * real + imag * imag;
        }
        
        return spectrum;
    }

    private static int[] KMeansCluster(List<double[]> embeddings, int k)
    {
        if (embeddings.Count == 0 || k <= 0)
            return [];
        
        int n = embeddings.Count;
        int dim = embeddings[0].Length;
        var labels = new int[n];
        
        if (k >= n)
        {
            for (int i = 0; i < n; i++)
                labels[i] = i % k;
            return labels;
        }
        
        // Initialize centroids (first k embeddings)
        var centroids = new double[k][];
        for (int i = 0; i < k; i++)
        {
            centroids[i] = embeddings[i].ToArray();
        }
        
        // Normalize embeddings
        var normalized = embeddings.Select(e =>
        {
            var norm = Math.Sqrt(e.Sum(x => x * x));
            return norm > 0 ? e.Select(x => x / norm).ToArray() : e;
        }).ToList();
        
        // K-means iterations
        for (int iter = 0; iter < 10; iter++)
        {
            // Assign labels
            for (int i = 0; i < n; i++)
            {
                double minDist = double.MaxValue;
                int minLabel = 0;
                
                for (int c = 0; c < k; c++)
                {
                    double dist = 0;
                    for (int d = 0; d < dim; d++)
                    {
                        var diff = normalized[i][d] - centroids[c][d];
                        dist += diff * diff;
                    }
                    
                    if (dist < minDist)
                    {
                        minDist = dist;
                        minLabel = c;
                    }
                }
                
                labels[i] = minLabel;
            }
            
            // Update centroids
            for (int c = 0; c < k; c++)
            {
                var clusterPoints = Enumerable.Range(0, n)
                    .Where(i => labels[i] == c)
                    .Select(i => normalized[i])
                    .ToList();
                
                if (clusterPoints.Count > 0)
                {
                    for (int d = 0; d < dim; d++)
                    {
                        centroids[c][d] = clusterPoints.Average(p => p[d]);
                    }
                }
            }
        }
        
        return labels;
    }

    private static List<Segment> MapSpeakersToScene(List<Segment> segments, SceneData sceneData)
    {
        if (segments.Count == 0)
            return segments;
        
        var speakers = sceneData.Speakers;
        
        if (speakers.Count == 0)
        {
            return segments.Select(s => s with { SpeakerId = "wide" }).ToList();
        }
        
        // Get unique labels in order of appearance
        var seenLabels = new List<string>();
        foreach (var seg in segments)
        {
            if (!seenLabels.Contains(seg.SpeakerId))
                seenLabels.Add(seg.SpeakerId);
        }
        
        if (seenLabels.Count <= 1 || speakers.Count <= 1)
        {
            var speakerId = speakers.FirstOrDefault()?.Id ?? "wide";
            return segments.Select(s => s with { SpeakerId = speakerId }).ToList();
        }
        
        // Sort speakers by horizontal position
        var sortedSpeakers = speakers.OrderBy(s => s.Bbox[0]).ToList();
        
        // Map labels to speaker IDs
        var labelToId = new Dictionary<string, string>();
        for (int i = 0; i < seenLabels.Count; i++)
        {
            var speakerIdx = i % sortedSpeakers.Count;
            labelToId[seenLabels[i]] = sortedSpeakers[speakerIdx].Id;
        }
        
        return segments.Select(s => s with 
        { 
            SpeakerId = labelToId.GetValueOrDefault(s.SpeakerId, "wide") 
        }).ToList();
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _vadSession?.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }

    private record SpeechTimestamp
    {
        public int StartSample { get; init; }
        public int EndSample { get; init; }
        public double Start { get; init; }
        public double End { get; init; }
    }

    private record RawSegment
    {
        public double Start { get; init; }
        public double End { get; init; }
        public int StartSample { get; init; }
        public int EndSample { get; init; }
        public string SpeakerLabel { get; set; } = "SPEAKER_00";
    }
}
