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

namespace VickyVM.Agent.Services;

/// <summary>
/// Rate-limits local maintenance runs. Runs are capped at
/// <see cref="MaintenanceSettings.MaxRunsPerDay"/> per rolling 24 hours and
/// never run more often than <see cref="MaintenanceSettings.MinIntervalHours"/>.
/// The last maintenance run timestamps are persisted so the cap survives restarts.
/// </summary>
public sealed class MaintenanceGuard
{
    private const string StateFileName = "maintenance-runs.json";

    private readonly MaintenanceSettings _settings;
    private readonly ILogger<MaintenanceGuard> _logger;
    private readonly string _statePath;
    private readonly SemaphoreSlim _sync = new(1, 1);
    private List<DateTimeOffset> _maintenanceRunTimesUtc = [];

    public MaintenanceGuard(IOptions<AgentConfiguration> config, ILogger<MaintenanceGuard> logger)
    {
        var agent = config.Value.Agent;
        _settings = config.Value.Maintenance;
        _logger = logger;
        _statePath = Path.Combine(agent.DataDirectory, StateFileName);
        Load();
    }

    /// <summary>
    /// Returns true when a maintenance run is allowed now given the
    /// persisted history and startup grace period. Throwing is only for
    /// cancelled operations.
    /// </summary>
    public async Task<bool> TryAllowRunAsync(DateTimeOffset nowUtc, TimeSpan uptime, CancellationToken cancellationToken = default)
    {
        if (!_settings.Enabled) return false;

        // Respect startup grace period
        if (uptime < TimeSpan.FromMinutes(_settings.StartupGracePeriodMinutes))
        {
            _logger.LogDebug("Maintenance skipped: startup grace period ({Grace} min) not elapsed (uptime: {Uptime})",
                _settings.StartupGracePeriodMinutes, uptime);
            return false;
        }

        await _sync.WaitAsync(cancellationToken);
        try
        {
            Prune(nowUtc);

            if (_maintenanceRunTimesUtc.Count >= _settings.MaxRunsPerDay)
            {
                _logger.LogDebug("Maintenance skipped: {Count}/{Max} runs per 24h already used",
                    _maintenanceRunTimesUtc.Count, _settings.MaxRunsPerDay);
                return false;
            }

            if (_maintenanceRunTimesUtc.Count > 0)
            {
                var lastRun = _maintenanceRunTimesUtc.Max();
                var nextAllowed = lastRun + TimeSpan.FromHours(_settings.MinIntervalHours);
                if (nowUtc < nextAllowed)
                {
                    _logger.LogDebug("Maintenance skipped: next allowed at {Next} (last run at {Last})",
                        nextAllowed, lastRun);
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
    /// Records that a maintenance run was performed at the given time.
    /// </summary>
    public async Task RecordRunAsync(DateTimeOffset atUtc, CancellationToken cancellationToken = default)
    {
        await _sync.WaitAsync(cancellationToken);
        try
        {
            Prune(atUtc);
            _maintenanceRunTimesUtc.Add(atUtc);
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
        _maintenanceRunTimesUtc = _maintenanceRunTimesUtc.Where(t => t >= cutoff).ToList();
    }

    private void Save()
    {
        try
        {
            var directory = Path.GetDirectoryName(_statePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            var state = new StateDto
            {
                MaintenanceRuns = _maintenanceRunTimesUtc.Select(t => t.ToString("O")).ToArray()
            };
            File.WriteAllText(_statePath, JsonSerializer.Serialize(state));
        }
        catch (Exception ex)
        {
            // Never let state persistence break the guard; the in-memory cap still applies.
            _logger.LogWarning(ex, "Failed to persist maintenance run state");
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            var state = JsonSerializer.Deserialize<StateDto>(File.ReadAllText(_statePath));
            _maintenanceRunTimesUtc = state?.MaintenanceRuns?
                .Select(t => DateTimeOffset.TryParse(t, out var dto) ? dto : (DateTimeOffset?)null)
                .Where(d => d.HasValue)
                .Select(d => d!.Value)
                .ToList() ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load maintenance run state; starting fresh");
            _maintenanceRunTimesUtc = [];
        }
    }

    private sealed class StateDto
    {
        public string[]? MaintenanceRuns { get; set; }
    }
}