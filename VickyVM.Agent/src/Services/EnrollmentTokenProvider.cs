using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Services;

/// <summary>
/// Reads the installer-provided enrollment token from a permission-restricted
/// file in the agent data directory. The token is a temporary single-use
/// secret: it is read once for enrollment and then deleted. Never log it.
/// </summary>
public sealed class EnrollmentTokenProvider
{
    private readonly string? _path;
    private readonly ILogger<EnrollmentTokenProvider> _logger;

    public EnrollmentTokenProvider(AgentSettings settings, ILogger<EnrollmentTokenProvider> logger)
    {
        _path = string.IsNullOrWhiteSpace(settings.EnrollmentTokenPath) ? null : settings.EnrollmentTokenPath;
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<string?> GetTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_path is null || !File.Exists(_path)) return null;
        try
        {
            var token = (await File.ReadAllTextAsync(_path, cancellationToken)).Trim();
            return token.Length == 0 ? null : token;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read enrollment token file");
            return null;
        }
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            if (_path is not null && File.Exists(_path)) File.Delete(_path);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not delete enrollment token file");
        }
        return Task.CompletedTask;
    }
}
