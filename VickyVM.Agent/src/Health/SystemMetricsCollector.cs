using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using VickyVM.Agent.Models;

namespace VickyVM.Agent.Health;

/// <summary>
/// Platform-aware resource collector.
///
///  - Windows: PerformanceCounter (CPU), GlobalMemoryStatusEx (RAM), DriveInfo (disk).
///  - Linux:   /proc/stat and /proc/meminfo (CPU/RAM), DriveInfo (disk).
///  - Other:   only disk is available; CPU/RAM stay null.
///
/// Every read is wrapped so a failing counter never breaks the agent, and the
/// collector never launches processes or modifies anything.
/// </summary>
public sealed class SystemMetricsCollector : ISystemMetricsCollector
{
    /// <summary>Per-process CPU samples from the previous collection, keyed by PID.</summary>
    private Dictionary<int, ProcessCpuSample>? _previousCpuSamples;
    private DateTime _previousCpuSampleAt;
    private readonly object _lock = new();

    public Task<ResourceMetrics> CollectAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var metrics = new ResourceMetrics
        {
            CpuUsagePercent = CollectCpuPercent(cancellationToken),
            MemoryUsagePercent = CollectMemoryPercent(),
            DiskUsagePercent = CollectDiskPercent(),
            TopCpuProcesses = CollectProcesses(byCpu: true),
            TopRamProcesses = CollectProcesses(byCpu: false),
        };

        return Task.FromResult(metrics);
    }

    private double? CollectCpuPercent(CancellationToken ct)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                using var counter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
                counter.NextValue(); // prime the counter so the next read is a real delta
                if (!ct.CanBeCanceled || !ct.IsCancellationRequested) Thread.Sleep(250);
                return Math.Clamp(counter.NextValue(), 0, 100);
            }

            if (OperatingSystem.IsLinux())
            {
                var idle1 = ReadLinuxCpuTotals();
                try { Thread.Sleep(250); } catch { }
                var idle2 = ReadLinuxCpuTotals();
                if (idle1 is null || idle2 is null) return null;
                var total = idle2.Value.total - idle1.Value.total;
                var idle = idle2.Value.idle - idle1.Value.idle;
                if (total <= 0) return 0;
                return Math.Clamp(100.0 * (total - idle) / total, 0, 100);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private double? CollectMemoryPercent()
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var status = new MemoryStatusEx { dwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
                if (!GlobalMemoryStatusEx(ref status) || status.ullTotalPhys == 0) return null;
                var used = status.ullTotalPhys - status.ullAvailPhys;
                return Math.Clamp(100.0 * used / status.ullTotalPhys, 0, 100);
            }

            if (OperatingSystem.IsLinux())
            {
                var (total, available) = ReadLinuxMemory();
                if (total <= 0) return null;
                return Math.Clamp(100.0 * (total - available) / total, 0, 100);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static double? CollectDiskPercent()
    {
        try
        {
            var root = Path.GetPathRoot(Environment.SystemDirectory ?? AppContext.BaseDirectory);
            if (string.IsNullOrEmpty(root)) root = Path.GetPathRoot(AppContext.BaseDirectory);
            var drive = new DriveInfo(root ?? "/");
            if (!drive.IsReady || drive.TotalSize <= 0) return null;
            return Math.Clamp(100.0 * drive.TotalFreeSpace / drive.TotalSize, 0, 100);
        }
        catch
        {
            return null;
        }
    }

    private IReadOnlyList<ProcessSample> CollectProcesses(bool byCpu)
    {
        try
        {
            var now = DateTime.UtcNow;
            var samples = new List<ProcessSample>();
            foreach (var proc in Process.GetProcesses())
            {
                try
                {
                    if (string.IsNullOrEmpty(proc.ProcessName) || proc.Id <= 0) continue;
                    double cpuPercent = 0;
                    if (byCpu)
                    {
                        cpuPercent = ComputeCpuPercent(proc, now);
                    }
                    var memoryMb = Math.Max(0, proc.WorkingSet64 / (1024 * 1024));
                    samples.Add(new ProcessSample(proc.ProcessName, proc.Id, byCpu ? cpuPercent : 0, memoryMb));
                }
                catch
                {
                    // Protected/system processes can throw; skip them.
                }
                finally
                {
                    try { proc.Dispose(); } catch { }
                }
            }

            if (byCpu)
            {
                lock (_lock)
                {
                    _previousCpuSamples = null;
                    _previousCpuSampleAt = now;
                }
            }

            return samples
                .OrderByDescending(s => byCpu ? s.CpuPercent : s.MemoryMb)
                .Take(5)
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    private double ComputeCpuPercent(Process proc, DateTime now)
    {
        lock (_lock)
        {
            // Keep per-process CPU time deltas between two consecutive samples.
            // The first collection populates the delta table without scoring.
            if (_previousCpuSamples is null || _previousCpuSampleAt == default)
            {
                _previousCpuSamples = new Dictionary<int, ProcessCpuSample>();
                _previousCpuSampleAt = now;
                _previousCpuSamples[proc.Id] = new ProcessCpuSample(proc.TotalProcessorTime.TotalMilliseconds, now);
                return 0;
            }

            var previousCpuMs = _previousCpuSamples.TryGetValue(proc.Id, out var prev) ? prev.CpuMs : 0;

            var currentCpuMs = proc.TotalProcessorTime.TotalMilliseconds;
            var idleMs = (now - _previousCpuSampleAt).TotalMilliseconds;

            _previousCpuSamples[proc.Id] = new ProcessCpuSample(currentCpuMs, now);
            if (_previousCpuSamples.Count > 512) _previousCpuSamples.Clear();

            var deltaMs = currentCpuMs - previousCpuMs;
            if (deltaMs <= 0 || idleMs <= 0) return 0;

            var cores = Math.Max(1, Environment.ProcessorCount);
            return Math.Clamp(100.0 * deltaMs / (idleMs * cores), 0, 100);
        }
    }

    private static (long total, long idle)? ReadLinuxCpuTotals()
    {
        var line = File.ReadLines("/proc/stat").FirstOrDefault(l => l.StartsWith("cpu "));
        if (string.IsNullOrEmpty(line)) return null;
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 5) return null;
        long total = 0;
        for (var i = 1; i < parts.Length; i++)
        {
            if (long.TryParse(parts[i], out var value)) total += value;
        }
        var idle = long.TryParse(parts[4], out var idleValue) ? idleValue : 0L;
        return (total, idle);
    }

    private static (long total, long available) ReadLinuxMemory()
    {
        long total = 0;
        long available = 0;
        foreach (var line in File.ReadLines("/proc/meminfo"))
        {
            if (line.StartsWith("MemTotal:")) total = ParseKb(line);
            else if (line.StartsWith("MemAvailable:")) available = ParseKb(line);
        }
        return (total, available);
    }

    private static long ParseKb(string line)
    {
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length > 1 && long.TryParse(parts[1], out var kb) ? kb * 1024 : 0;
    }

    private readonly record struct ProcessCpuSample(double CpuMs, DateTime At);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx lpBuffer);
}