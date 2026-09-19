using System;
using System.Collections.Generic;
using VickyVM.Agent.Health;

namespace VickyVM.Agent.Models;

/// <summary>
/// Health report for the local machine.
/// Field surface is intentionally small; it grows with the health-reporting phase.
/// </summary>
public sealed record HealthReport
{
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// CPU usage percentage (0-100).
    /// </summary>
    public double CpuUsagePercent { get; set; }

    /// <summary>
    /// Memory usage percentage (0-100).
    /// </summary>
    public double MemoryUsagePercent { get; set; }

    /// <summary>
    /// Disk usage percentage (0-100).
    /// </summary>
    public double DiskUsagePercent { get; set; }

    /// <summary>
    /// Optional alert level ("Warning", "Critical", or null when healthy).
    /// </summary>
    public string? AlertLevel { get; set; }

    /// <summary>
    /// Top CPU-consuming processes recorded when a threshold was crossed.
    /// </summary>
    public IReadOnlyList<ProcessSample> TopCpuProcesses { get; set; } = [];

    /// <summary>
    /// Top memory-consuming processes recorded when a threshold was crossed.
    /// </summary>
    public IReadOnlyList<ProcessSample> TopRamProcesses { get; set; } = [];

    /// <summary>
    /// Fresh local RDP health check, present only when a manual status requested it.
    /// </summary>
    public RdpReport? Rdp { get; set; }

    /// <summary>
    /// Recent significant local events (threshold crossings, RDP recovery
    /// outcomes) surfaced in manual status reports.
    /// </summary>
    public IReadOnlyList<string> SignificantEvents { get; set; } = [];
}