using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Health;

/// <summary>
/// Rate-limits automatic local RDP checks. Manual checks (Get Status / Check
/// RDP) bypass this guard entirely. Automatic checks are capped at
/// <see cref="RdpSettings.MaxAutomaticChecksPerDay"/> per rolling 24 hours and
/// never run more often than <see cref="RdpSettings.AutoCheckIntervalHours"/>.
/// The last automatic check timestamps are persisted so the cap survives restarts.
/// </summary>
public sealed class RdpCheckGuard
{
    private const string StateFileName = "rdp-auto-checks.json";

    private readonly RdpSettings _settings;
    private readonly ILogger<RdpCheckGuard> _logger;
    private readonly string _statePath;
    private readonly SemaphoreSlim _sync = new(1, 1);
    private List<DateTimeOffset> _automaticCheckTimesUtc = [];

    public RdpCheckGuard(IOptions<AgentConfiguration> config, ILogger<RdpCheckGuard> logger)
    {
        var agent = config.Value.Agent;
        _settings = config.Value.Rdp;
        _logger = logger;
        _statePath = Path.Combine(agent.DataDirectory, StateFileName);
        Load();
    }

    /// <summary>
    /// Returns true when an automatic RDP check is allowed now given the
    /// persisted history. Throwing is only for cancelled operations.
    /// </summary>
    public async Task<bool> TryAllowAutomaticCheckAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (!_settings.AutomaticChecksEnabled) return false;

        await _sync.WaitAsync(cancellationToken);
        try
        {
            Prune(nowUtc);

            if (_automaticCheckTimesUtc.Count >= _settings.MaxAutomaticChecksPerDay)
            {
                _logger.LogDebug("Automatic RDP check skipped: {Count}/{Max} per 24h already used", _automaticCheckTimesUtc.Count, _settings.MaxAutomaticChecksPerDay);
                return false;
            }

            if (_automaticCheckTimesUtc.Count > 0)
            {
                var waiting = _automaticCheckTimesUtc.Max();
                var next = waiting + TimeSpan.FromHours(_settings.AutoCheckIntervalHours);
                if (nowUtc < next)
                {
                    _logger.LogDebug("Automatic RDP check skipped: next allowed at {Next}", next);
                    return false;
                }
            }

            return true;
        }
        finally
        {
            _sync.Release();
        }
    }

    /// <summary>
    /// Records that an automatic check was performed at the given time.
    /// </summary>
    public async Task RecordAutomaticCheckAsync(DateTimeOffset atUtc, CancellationToken cancellationToken = default)
    {
        await _sync.WaitAsync(cancellationToken);
        try
        {
            Prune(atUtc);
            _automaticCheckTimesUtc.Add(atUtc);
            Save();
        }
        finally
        {
            _sync.Release();
        }
    }

    private void Prune(DateTimeOffset nowUtc)
    {
        var cutoff = nowUtc.AddDays(-1);
        _automaticCheckTimesUtc = _automaticCheckTimesUtc.Where(t => t >= cutoff).ToList();
    }

    private void Save()
    {
        try
        {
            var directory = Path.GetDirectoryName(_statePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            var state = new StateDto { AutomaticChecks = _automaticCheckTimesUtc.Select(t => t.ToString("O")).ToArray() };
            File.WriteAllText(_statePath, JsonSerializer.Serialize(state));
        }
        catch (Exception ex)
        {
            // Never let state persistence break the guard; the in-memory cap still applies.
            _logger.LogWarning(ex, "Failed to persist RDP automatic check state");
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            var state = JsonSerializer.Deserialize<StateDto>(File.ReadAllText(_statePath));
            _automaticCheckTimesUtc = state?.AutomaticChecks?
                .Select(t => DateTimeOffset.TryParse(t, out var dto) ? dto : (DateTimeOffset?)null)
                .Where(d => d.HasValue)
                .Select(d => d!.Value)
                .ToList() ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load RDP automatic check state; starting fresh");
            _automaticCheckTimesUtc = [];
        }
    }

    private sealed class StateDto
    {
        public string[]? AutomaticChecks { get; set; }
    }
}