using Microsoft.Extensions.DependencyInjection;
using Montager.Core.Interfaces;
using Montager.Core.Services;

namespace Montager.Core;

/// <summary>
/// Extension methods for registering Montager services with DI.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Adds all Montager core services to the service collection.
    /// </summary>
    public static IServiceCollection AddMontagerServices(this IServiceCollection services)
    {
        services.AddSingleton<IVideoService, VideoService>();
        services.AddTransient<IDetectionService, DetectionService>();
        services.AddTransient<IDiarizationService, DiarizationService>();
        services.AddTransient<IPreviewService, PreviewService>();
        services.AddTransient<IRenderService, RenderService>();
        
        return services;
    }
}
