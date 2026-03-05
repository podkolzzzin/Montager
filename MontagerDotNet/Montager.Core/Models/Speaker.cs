namespace Montager.Core.Models;

/// <summary>
/// Represents a detected speaker with face location and crop rectangle.
/// </summary>
public record Speaker
{
    /// <summary>Unique identifier (e.g., "speaker_1").</summary>
    public required string Id { get; init; }
    
    /// <summary>Display name (e.g., "Speaker 1").</summary>
    public required string Name { get; init; }
    
    /// <summary>Face bounding box (x, y, width, height) in original video coordinates.</summary>
    public required BoundingBox Bbox { get; init; }
    
    /// <summary>Crop rectangle (x, y, width, height) for 1080p output.</summary>
    public required BoundingBox CropRect { get; init; }
}

/// <summary>
/// Bounding box or rectangle coordinates.
/// </summary>
public record BoundingBox(int X, int Y, int Width, int Height);
