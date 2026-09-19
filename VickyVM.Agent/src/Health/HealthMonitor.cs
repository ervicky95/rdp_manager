using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Models;

namespace VickyVM.Agent.Health;

/// <summary>
/// Local resource and RDP monitor.
///
/// Threshold behavior (configurable, defaults CPU 80/95, RAM 80/90, disk 80/90):
///  - healthy metrics log an INFO summary each report;
///  - crossing a warning threshold logs WARN and records the top CPU/RAM processes;
///  - crossing a critical threshold logs ERROR and records the top CPU/RAM processes;
///  - returning to normal logs INFO.
/// Logging is transition-based so a poll loop never spams the same alert line.
/// The monitor never kills processes, closes applications, or stops services.
/// </summary>
public sealed class HealthMonitor : IHealthMonitor, IDisposable
{
    private readonly ILogger<HealthMonitor> _logger;
    private readonly HealthSettings _health;
    private readonly ISystemMetricsCollector _metrics;
    private readonly IRdpMonitor _rdp;

    /// <summary>Resources currently in a warning/critical state (transition tracking).</summary>
    private readonly HashSet<string> _alerting = new();
    private readonly object _alertLock = new();

    /// <summary>
    /// Summaries of recent significant events (threshold crossings and RDP
    /// recovery outcomes) reported to the operator on manual status.
    /// </summary>
    private readonly LinkedList<string> _significantEvents = new();

    private bool _disposed;

    public HealthMonitor(
        ILogger<HealthMonitor> logger,
        IOptions<AgentConfiguration> config,
        ISystemMetricsCollector metrics,
        IRdpMonitor rdp)
    {
        _logger = logger;
        _health = config.Value.Health;
        _metrics = metrics;
        _rdp = rdp;
    }

    public async Task<HealthReport> GetHealthReportAsync(bool includeRdp = false, CancellationToken cancellationToken = default)
    {
        var metrics = await _metrics.CollectAsync(cancellationToken);
        var report = new HealthReport
        {
            Timestamp = DateTimeOffset.UtcNow,
            CpuUsagePercent = metrics.CpuUsagePercent ?? 0,
            MemoryUsagePercent = metrics.MemoryUsagePercent ?? 0,
            DiskUsagePercent = metrics.DiskUsagePercent ?? 0,
            TopCpuProcesses = metrics.TopCpuProcesses,
            TopRamProcesses = metrics.TopRamProcesses,
        };

        if (includeRdp)
        {
            var rdpReport = await _rdp.CheckAsync(cancellationToken);
            report.Rdp = rdpReport;
        }

        report.AlertLevel = EvaluateThresholds(report, metrics);

        // Significant events are captured after evaluation so a report includes
        // the crossings it just detected.
        report.SignificantEvents = RecentSignificantEvents;

        if (report.AlertLevel is null)
        {
            _logger.LogInformation(
                "Local resources healthy: CPU {Cpu:F1}%, RAM {Ram:F1}%, disk {Disk:F1}%",
                report.CpuUsagePercent, report.MemoryUsagePercent, report.DiskUsagePercent);
        }

        return report;
    }

    public Task<RdpReport> CheckRdpAsync(bool recoverIfUnhealthy = false, CancellationToken cancellationToken = default)
    {
        return CheckRdpCoreAsync(recoverIfUnhealthy, cancellationToken);
    }

    private async Task<RdpReport> CheckRdpCoreAsync(bool recoverIfUnhealthy, CancellationToken ct)
    {
        var report = await _rdp.CheckAsync(ct);
        if (recoverIfUnhealthy && report.Status == "Unhealthy")
        {
            report = await _rdp.RecoverIfNeededAsync(report, ct);
            RecordSignificantEvent($"RDP recovery attempted: {report.Status} ({report.RecoveryResult})");
        }
        else if (report.Status == "Unhealthy")
        {
            RecordSignificantEvent("RDP unhealthy (no recovery run)");
        }
        return report;
    }

    private string? EvaluateThresholds(HealthReport report, ResourceMetrics metrics)
    {
        string? highest = null;
        EvaluateResource("CPU", metrics.CpuUsagePercent, _health.CpuWarningPercent, _health.CpuCriticalPercent, ref highest);
        EvaluateResource("RAM", metrics.MemoryUsagePercent, _health.MemoryWarningPercent, _health.MemoryCriticalPercent, ref highest);
        EvaluateResource("Disk", metrics.DiskUsagePercent, _health.DiskWarningPercent, _health.DiskCriticalPercent, ref highest);

        lock (_alertLock)
        {
            report.AlertLevel = highest;
            if (highest is not null)
            {
                if (_alerting.Add("any"))
                {
                    RecordSignificantEvent($"Resource alert: {highest} (CPU {report.CpuUsagePercent:F0}%, RAM {report.MemoryUsagePercent:F0}%, disk {report.DiskUsagePercent:F0}%)");
                }
            }
            else if (_alerting.Remove("any"))
            {
                RecordSignificantEvent("Resources returned to normal");
            }
        }
        return highest;
    }

    private void EvaluateResource(string name, double? value, int warning, int critical, ref string? highest)
    {
        if (value is null)
        {
            return; // not collectable on this platform; not an alert
        }

        var current = value.Value;
        if (current >= critical)
        {
            highest = "Critical";
            _logger.LogError(
                "{Resource} usage critical: {Usage:F1}% (critical at {Threshold}%); top processes recorded",
                name, current, critical);
            RecordSignificantEvent($"{name} usage critical ({current:F1}%)");
        }
        else if (current >= warning)
        {
            highest ??= "Warning";
            _logger.LogWarning(
                "{Resource} usage warning: {Usage:F1}% (warning at {Threshold}%); top processes recorded",
                name, current, warning);
            RecordSignificantEvent($"{name} usage warning ({current:F1}%)");
        }
    }

    private void RecordSignificantEvent(string description)
    {
        lock (_alertLock)
        {
            _significantEvents.AddLast(description);
            while (_significantEvents.Count > 20) _significantEvents.RemoveFirst();
        }
        _logger.LogInformation("Significant event recorded: {Event}", description);
    }

    /// <summary>
    /// Recent significant events (alert crossings, RDP recovery outcomes) that
    /// the operator sees in a manual status or significant-event report.
    /// </summary>
    public IReadOnlyList<string> RecentSignificantEvents
    {
        get
        {
            lock (_alertLock)
            {
                return [.. _significantEvents];
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        GC.SuppressFinalize(this);
    }
}