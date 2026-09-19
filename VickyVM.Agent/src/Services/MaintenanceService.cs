using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Services;

/// <summary>
/// Local maintenance background service.
///
/// Runs at most twice per 24 hours (12-hour interval) with a startup grace period.
/// Only cleans clearly identified agent-owned files in approved subdirectories:
/// - Temp, Cache, Logs under the agent DataDirectory
/// - Files matching safe patterns: *.tmp, *.temp, *.cache, *.log
/// - Files older than configured age thresholds
///
/// Never deletes:
/// - Documents, Downloads, Desktop, User profiles, Application data
/// - Databases, Windows system files, Recycle Bin data
/// - Files outside approved cleanup directories
/// - Files that cannot be clearly identified as temporary or cache files
///
/// Never:
/// - Closes random applications
/// - Kills arbitrary background processes
/// - Kills Windows system processes
/// - Stops unrelated services
/// - Terminates high CPU/RAM processes automatically
/// - Accepts arbitrary cleanup paths or process names from external sources
///
/// Records high-resource processes instead of acting on them.
/// </summary>
public sealed class MaintenanceService : BackgroundService
{
    private readonly ILogger<MaintenanceService> _logger;
    private readonly AgentSettings _agentSettings;
    private readonly MaintenanceSettings _maintenanceSettings;
    private readonly MaintenanceGuard _maintenanceGuard;
    private readonly TimeSpan _startTime = DateTimeOffset.UtcNow - Process.GetCurrentProcess().StartTime.ToUniversalTime();

    public MaintenanceService(
        ILogger<MaintenanceService> logger,
        IOptions<AgentConfiguration> config,
        MaintenanceGuard maintenanceGuard)
    {
        _logger = logger;
        _agentSettings = config.Value.Agent;
        _maintenanceSettings = config.Value.Maintenance;
        _maintenanceGuard = maintenanceGuard;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("VickyVM Agent maintenance service starting");

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var now = DateTimeOffset.UtcNow;
                var uptime = now - DateTimeOffset.UtcNow.Add(-_startTime);

                bool allowed;
                try
                {
                    allowed = await _maintenanceGuard.TryAllowRunAsync(now, uptime, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }

                if (allowed)
                {
                    await RunMaintenanceAsync(stoppingToken);
                    await _maintenanceGuard.RecordRunAsync(now, stoppingToken);
                }

                // Check every hour (bounded wait with cancellation)
                await DelayOrCancel(TimeSpan.FromHours(1), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown
        }
        finally
        {
            _logger.LogInformation("VickyVM Agent maintenance service stopping");
        }
    }

    private async Task RunMaintenanceAsync(CancellationToken ct)
    {
        var runId = Guid.NewGuid().ToString("N")[..8];
        _logger.LogInformation("Maintenance run {RunId} started", runId);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_maintenanceSettings.RunTimeoutSeconds));

        try
        {
            var results = new MaintenanceResults();

            // 1. Clean old log files
            await CleanDirectoryAsync(
                Path.Combine(_agentSettings.DataDirectory, "Logs"),
                _maintenanceSettings.LogMaxAgeDays,
                new[] { "*.log" },
                results,
                cts.Token);

            // 2. Clean agent temp files
            await CleanDirectoryAsync(
                Path.Combine(_agentSettings.DataDirectory, "Temp"),
                _maintenanceSettings.TempMaxAgeDays,
                _maintenanceSettings.SafeFilePatterns.ToArray(),
                results,
                cts.Token);

            // 3. Clean agent cache files
            await CleanDirectoryAsync(
                Path.Combine(_agentSettings.DataDirectory, "Cache"),
                _maintenanceSettings.CacheMaxAgeDays,
                _maintenanceSettings.SafeFilePatterns.ToArray(),
                results,
                cts.Token);

            // 4. Record high-resource processes (never kill, only log)
            RecordHighResourceProcesses(results);

            _logger.LogInformation(
                "Maintenance run {RunId} completed: inspected={Inspected}, removed={Removed}, skipped={Skipped}, errors={Errors}, highCpu={HighCpu}, highRam={HighRam}",
                runId,
                results.InspectedCount,
                results.RemovedCount,
                results.SkippedCount,
                results.ErrorCount,
                results.HighCpuProcesses.Count,
                results.HighRamProcesses.Count);
        }
        catch (OperationCanceledException) when (cts.Token.IsCancellationRequested)
        {
            _logger.LogWarning("Maintenance run {RunId} timed out after {Timeout}s", runId, _maintenanceSettings.RunTimeoutSeconds);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Maintenance run {RunId} failed", runId);
        }
    }

    private async Task CleanDirectoryAsync(
        string directory,
        int maxAgeDays,
        string[] patterns,
        MaintenanceResults results,
        CancellationToken ct)
    {
        if (!Directory.Exists(directory))
        {
            _logger.LogDebug("Maintenance: directory does not exist (skipped): {Directory}", directory);
            return;
        }

        // Validate directory is under agent DataDirectory (defense in depth)
        var dataDir = Path.GetFullPath(_agentSettings.DataDirectory);
        var targetDir = Path.GetFullPath(directory);
        if (!targetDir.StartsWith(dataDir, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Maintenance: refused to clean directory outside DataDirectory: {Directory}", directory);
            return;
        }

        var cutoff = DateTime.UtcNow.AddDays(-maxAgeDays);

        foreach (var pattern in patterns)
        {
            string[] files;
            try
            {
                files = Directory.GetFiles(directory, pattern, SearchOption.TopDirectoryOnly);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Maintenance: failed to enumerate files in {Directory} with pattern {Pattern}", directory, pattern);
                results.ErrorCount++;
                continue;
            }

            foreach (var file in files)
            {
                results.InspectedCount++;
                ct.ThrowIfCancellationRequested();

                try
                {
                    var fileInfo = new FileInfo(file);

                    // Skip if file is too new
                    if (fileInfo.LastWriteTimeUtc > cutoff)
                    {
                        results.SkippedCount++;
                        _logger.LogDebug("Maintenance: skipped (too new): {File}", file);
                        continue;
                    }

                    // Try to delete - will fail if locked
                    var deleted = TryDeleteFile(fileInfo);
                    if (deleted)
                    {
                        results.RemovedCount++;
                        _logger.LogInformation("Maintenance: removed old file: {File} (age: {Age} days)",
                            file, (DateTime.UtcNow - fileInfo.LastWriteTimeUtc).TotalDays);
                    }
                    else
                    {
                        results.SkippedCount++;
                        _logger.LogDebug("Maintenance: skipped (locked or inaccessible): {File}", file);
                    }
                }
                catch (Exception ex)
                {
                    results.ErrorCount++;
                    _logger.LogWarning(ex, "Maintenance: error processing file {File}", file);
                }
            }
        }
    }

    private static bool TryDeleteFile(FileInfo file)
    {
        try
        {
            // Attempt to open with exclusive access to detect locks
            using (var stream = file.Open(FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                // If we can open exclusively, it's not locked
            }
            file.Delete();
            return true;
        }
        catch (IOException)
        {
            // File is locked or in use
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            // No permission
            return false;
        }
        catch (Exception)
        {
            // Any other error - treat as not deletable
            return false;
        }
    }

    private void RecordHighResourceProcesses(MaintenanceResults results)
    {
        try
        {
            var processes = Process.GetProcesses();
            var highCpuThreshold = TimeSpan.FromSeconds(30); // Processes using >30s CPU time
            var highRamThreshold = 500_000_000L; // 500 MB

            foreach (var process in processes)
            {
                try
                {
                    if (process.HasExited) continue;

                    var cpuTime = process.TotalProcessorTime;
                    var ramBytes = process.WorkingSet64;

                    if (cpuTime > highCpuThreshold)
                    {
                        results.HighCpuProcesses.Add(new HighResourceProcess
                        {
                            Name = process.ProcessName,
                            Id = process.Id,
                            CpuTime = cpuTime,
                            RamBytes = ramBytes
                        });
                    }

                    if (ramBytes > highRamThreshold)
                    {
                        results.HighRamProcesses.Add(new HighResourceProcess
                        {
                            Name = process.ProcessName,
                            Id = process.Id,
                            CpuTime = cpuTime,
                            RamBytes = ramBytes
                        });
                    }
                }
                catch
                {
                    // Ignore processes we can't query
                }
                finally
                {
                    process.Dispose();
                }
            }

            if (results.HighCpuProcesses.Count > 0)
            {
                _logger.LogWarning("High CPU processes detected: {Count}", results.HighCpuProcesses.Count);
                foreach (var p in results.HighCpuProcesses.OrderByDescending(x => x.CpuTime).Take(5))
                {
                    _logger.LogWarning("  High CPU: {Name} (PID {Id}) - CPU: {CpuTime}, RAM: {RamMB} MB",
                        p.Name, p.Id, p.CpuTime, p.RamBytes / 1_048_576);
                }
            }

            if (results.HighRamProcesses.Count > 0)
            {
                _logger.LogWarning("High RAM processes detected: {Count}", results.HighRamProcesses.Count);
                foreach (var p in results.HighRamProcesses.OrderByDescending(x => x.RamBytes).Take(5))
                {
                    _logger.LogWarning("  High RAM: {Name} (PID {Id}) - RAM: {RamMB} MB, CPU: {CpuTime}",
                        p.Name, p.Id, p.RamBytes / 1_048_576, p.CpuTime);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to enumerate processes for resource recording");
        }
    }

    private static async Task DelayOrCancel(TimeSpan delay, CancellationToken ct)
    {
        try
        {
            await Task.Delay(delay, ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
    }

    private sealed class MaintenanceResults
    {
        public int InspectedCount { get; set; }
        public int RemovedCount { get; set; }
        public int SkippedCount { get; set; }
        public int ErrorCount { get; set; }
        public List<HighResourceProcess> HighCpuProcesses { get; } = new();
        public List<HighResourceProcess> HighRamProcesses { get; } = new();
    }

    private sealed class HighResourceProcess
    {
        public string Name { get; set; } = string.Empty;
        public int Id { get; set; }
        public TimeSpan CpuTime { get; set; }
        public long RamBytes { get; set; }
    }
}