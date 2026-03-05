using System.Text.Json.Serialization;

namespace Montager.Core.Models;

/// <summary>
/// Scene detection results containing video metadata and detected speakers.
/// </summary>
public record SceneData
{
    /// <summary>Path to the source video file.</summary>
    [JsonPropertyName("video_path")]
    public required string VideoPath { get; init; }
    
    /// <summary>Video width in pixels.</summary>
    [JsonPropertyName("width")]
    public required int Width { get; init; }
    
    /// <summary>Video height in pixels.</summary>
    [JsonPropertyName("height")]
    public required int Height { get; init; }
    
    /// <summary>Frames per second.</summary>
    [JsonPropertyName("fps")]
    public required double Fps { get; init; }
    
    /// <summary>Video duration in seconds.</summary>
    [JsonPropertyName("duration")]
    public required double Duration { get; init; }
    
    /// <summary>Detected speakers with positions.</summary>
    [JsonPropertyName("speakers")]
    public required List<SpeakerDto> Speakers { get; init; }
}

/// <summary>
/// Speaker data transfer object for JSON serialization.
/// </summary>
public record SpeakerDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    
    [JsonPropertyName("name")]
    public required string Name { get; init; }
    
    [JsonPropertyName("bbox")]
    public required int[] Bbox { get; init; }
    
    [JsonPropertyName("crop_rect")]
    public required int[] CropRect { get; init; }
    
    public Speaker ToSpeaker() => new()
    {
        Id = Id,
        Name = Name,
        Bbox = new BoundingBox(Bbox[0], Bbox[1], Bbox[2], Bbox[3]),
        CropRect = new BoundingBox(CropRect[0], CropRect[1], CropRect[2], CropRect[3])
    };
    
    public static SpeakerDto FromSpeaker(Speaker s) => new()
    {
        Id = s.Id,
        Name = s.Name,
        Bbox = [s.Bbox.X, s.Bbox.Y, s.Bbox.Width, s.Bbox.Height],
        CropRect = [s.CropRect.X, s.CropRect.Y, s.CropRect.Width, s.CropRect.Height]
    };
}
