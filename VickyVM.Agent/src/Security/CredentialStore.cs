using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Security;

/// <summary>
/// File-backed credential store. The stored value is protected by an injected
/// <see cref="ICredentialProtector"/> (DPAPI on Windows). The credential is
/// never logged; a corrupt or unreadable store is treated as "not enrolled"
/// so the agent can re-enroll instead of crashing on boot.
/// </summary>
public sealed class CredentialStore : ICredentialStore
{
    private readonly string _path;
    private readonly ICredentialProtector _protector;
    private readonly ILogger<CredentialStore> _logger;

    public CredentialStore(
        AgentSettings settings,
        ICredentialProtector protector,
        ILogger<CredentialStore> logger)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _protector = protector ?? throw new ArgumentNullException(nameof(protector));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));

        Directory.CreateDirectory(settings.DataDirectory);
        _path = Path.Combine(settings.DataDirectory, "agent-credential.bin");
    }

    public async Task<StoredAgentCredential?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_path)) return null;

        byte[] raw;
        try
        {
            raw = await File.ReadAllBytesAsync(_path, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read credential store; treating agent as not enrolled");
            return null;
        }

        try
        {
            var unprotected = _protector.Unprotect(raw);
            var dto = JsonSerializer.Deserialize<StoredCredentialDto>(unprotected);
            if (dto is null || string.IsNullOrEmpty(dto.AgentId) || string.IsNullOrEmpty(dto.Credential))
                return null;
            return new StoredAgentCredential(dto.AgentId, dto.Credential);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not decrypt/decode credential store; re-enrollment required");
            return null;
        }
    }

    public async Task SaveAsync(StoredAgentCredential credential, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credential);
        var json = JsonSerializer.SerializeToUtf8Bytes(new StoredCredentialDto(credential.AgentId, credential.Credential));
        var protectedBytes = _protector.Protect(json);
        await File.WriteAllBytesAsync(_path, protectedBytes, cancellationToken);
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            if (File.Exists(_path)) File.Delete(_path);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not delete credential store");
        }
        return Task.CompletedTask;
    }

    internal sealed record StoredCredentialDto(string AgentId, string Credential);
}
