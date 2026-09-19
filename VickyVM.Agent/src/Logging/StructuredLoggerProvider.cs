using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Logging;

/// <summary>
/// Logger provider for the structured file logger.
/// </summary>
public sealed class StructuredLoggerProvider : ILoggerProvider
{
    private readonly StructuredLoggerOptions _options;
    private readonly ConcurrentDictionary<string, StructuredLogger> _loggers = new();
    private bool _disposed;

    public StructuredLoggerProvider(IOptions<StructuredLoggerOptions> options)
    {
        _options = options.Value;
    }

    public ILogger CreateLogger(string categoryName)
    {
        return _loggers.GetOrAdd(categoryName, name => new StructuredLogger(name, Options.Create(_options)));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var logger in _loggers.Values)
        {
            logger.Dispose();
        }
        _loggers.Clear();
    }
}

/// <summary>
/// Extension methods for adding structured logging to the host.
/// </summary>
public static class StructuredLoggingExtensions
{
    /// <summary>
    /// Adds the structured file logger to the logging builder.
    /// </summary>
    public static ILoggingBuilder AddStructuredFileLogging(
        this ILoggingBuilder builder,
        Action<StructuredLoggerOptions>? configure = null)
    {
        if (configure != null)
        {
            builder.Services.Configure(configure);
        }

        builder.Services.AddSingleton<ILoggerProvider, StructuredLoggerProvider>();
        return builder;
    }

    /// <summary>
    /// Adds the structured file logger using configuration section.
    /// </summary>
    public static ILoggingBuilder AddStructuredFileLogging(
        this ILoggingBuilder builder,
        IConfigurationSection section)
    {
        builder.Services.Configure<StructuredLoggerOptions>(section);
        builder.Services.AddSingleton<ILoggerProvider, StructuredLoggerProvider>();
        return builder;
    }
}