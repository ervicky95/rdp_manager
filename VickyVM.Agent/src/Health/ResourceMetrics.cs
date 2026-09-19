using System.Collections.Generic;
using VickyVM.Agent.Models;

namespace VickyVM.Agent.Health;

/// <summary>
/// Snapshot of local resource metrics: CPU, RAM, disk, and the recorded top
/// processes. A null percentage means the metric could not be collected on
/// this platform (for example, CPU counters on non-Windows hosts).
/// </summary>
public sealed record ResourceMetrics
{
    public double? CpuUsagePercent { get; init; }

    public double? MemoryUsagePercent { get; init; }

    public double? DiskUsagePercent { get; init; }

    public IReadOnlyList<ProcessSample> TopCpuProcesses { get; init; } = [];

    public IReadOnlyList<ProcessSample> TopRamProcesses { get; init; } = [];
}