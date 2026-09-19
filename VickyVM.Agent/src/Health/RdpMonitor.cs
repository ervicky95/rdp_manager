using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Win32;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Health;

/// <summary>
/// Windows RDP health monitor and recovery.
///
/// Checks (all safe, no RDP login): TermService state, TCP port 3389 listener
/// probe, and the RDP enabled flag read from the terminal-server configuration.
///
/// Recovery, only when RDP is confirmed unhealthy on Windows:
///   1. restart the TermService via the Windows service APIs;
///   2. wait RdpSettings.RecoveryWaitSeconds and recheck;
///   3. if still unhealthy, restart UmRdpService once (when available);
///   4. wait RdpSettings.RecoveryWaitSeconds, recheck, and record the outcome.
///
/// The agent never reboots/shuts down the machine, never stops unrelated
/// services, never changes firewall rules, and never writes to the registry.
/// </summary>
public sealed class RdpMonitor : IRdpMonitor
{
    private static readonly string TermServiceName = "TermService";
    private static readonly string UserRdpServiceName = "UmRdpService";
    private static readonly ushort RdpPort = 3389;

    private readonly ILogger<RdpMonitor> _logger;
    private readonly RdpSettings _settings;
    private readonly SemaphoreSlim _recoveryLock = new(1, 1);

    public RdpMonitor(ILogger<RdpMonitor> logger, IOptions<AgentConfiguration> config)
    {
        _logger = logger;
        _settings = config.Value.Rdp;
    }

    public bool CanCheck => OperatingSystem.IsWindows();

    public Task<RdpReport> CheckAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanCheck)
        {
            return Task.FromResult(new RdpReport
            {
                Status = "NotSupported",
                CheckedAt = DateTimeOffset.UtcNow,
                Error = "RDP checks are only supported on Windows.",
            });
        }

        try
        {
            var service = SafeGetService(TermServiceName);
            var serviceRunning = service is not null && service!.Status == ServiceControllerStatus.Running;
            var serviceState = service?.Status.ToString() ?? "Unknown";
            var portOpen = IsPortOpen(cancellationToken);
            var enabled = IsRdpEnabled();

            var healthy = serviceRunning && portOpen && (enabled ?? true);
            return Task.FromResult(new RdpReport
            {
                Status = healthy ? "Healthy" : "Unhealthy",
                CheckedAt = DateTimeOffset.UtcNow,
                ServiceState = serviceState,
                ServiceRunning = serviceRunning,
                Port3389Open = portOpen,
                RdpEnabled = enabled,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Local RDP health check failed; treating RDP as unknown");
            return Task.FromResult(new RdpReport
            {
                Status = "Unknown",
                CheckedAt = DateTimeOffset.UtcNow,
                Error = ex.Message,
            });
        }
    }

    public async Task<RdpReport> RecoverIfNeededAsync(RdpReport current, CancellationToken cancellationToken = default)
    {
        if (!CanCheck)
        {
            return current;
        }

        // Single-flight: never run two recovery passes at the same time.
        if (!_recoveryLock.Wait(0))
        {
            return current with { RecoveryResult = "Recovery already in progress; this pass skipped." };
        }

        try
        {
            return await RecoverCoreAsync(current, cancellationToken);
        }
        finally
        {
            _recoveryLock.Release();
        }
    }

    private async Task<RdpReport> RecoverCoreAsync(RdpReport current, CancellationToken cancellationToken)
    {
        if (!CanCheck)
        {
            return current;
        }

        if (current.Status == "Healthy" || current.Status == "NotSupported")
        {
            return current;
        }

        // Recovery exclusively touches the RDP services; never other services,
        // the firewall, the registry, or the OS (no reboot/shutdown).
        if (current.Status == "Unknown" && string.IsNullOrEmpty(current.ServiceState))
        {
            // A genuinely unreadable state should not trigger blind restarts.
            _logger.LogWarning("RDP state unknown; skipping automatic recovery");
            return current;
        }

        var last = current;
        var notes = new List<string>();

        var restarted = TryRestartService(TermServiceName, cancellationToken);
        if (restarted is not null)
        {
            notes.Add("TermService restarted");
            last = await RecheckAsync(restarted, cancellationToken);
        }

        if (!last.IsHealthy && last.Status != "NotSupported")
        {
            var userService = SafeGetService(UserRdpServiceName);
            if (userService is not null)
            {
                notes.Add("UmRdpService restarted (once)");
                last = await RecheckAsync(TryRestartService(UserRdpServiceName, cancellationToken), cancellationToken);
            }
        }

        var result = new RdpReport
        {
            Status = last.Status,
            ServiceState = last.ServiceState,
            Port3389Open = last.Port3389Open,
            RdpEnabled = last.RdpEnabled,
            ServiceRunning = last.ServiceRunning,
            RecoveryAttempted = true,
            RecoveryResult = notes.Count == 0 ? "no recovery action taken" : string.Join("; ", notes) + "; final status: " + last.Status,
            Error = last.Error,
        };

        _logger.LogInformation(
            "RDP recovery pass complete: {Status} (notes: {Notes})",
            result.Status, result.RecoveryResult);
        return result;
    }

    private async Task<RdpReport> RecheckAsync(ServiceController? afterRestart, CancellationToken ct)
    {
        if (afterRestart is not null)
        {
            _logger.LogInformation("RDP recovery: waiting {Seconds}s before recheck", _settings.RecoveryWaitSeconds);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(_settings.RecoveryWaitSeconds), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return new RdpReport
                {
                    Status = "Unknown",
                    Error = "Recovery cancelled while waiting to recheck.",
                };
            }
        }
        return await CheckAsync(ct);
    }

    private ServiceController? TryRestartService(string serviceName, CancellationToken ct)
    {
        try
        {
            var service = SafeGetService(serviceName);
            if (service is null)
            {
                _logger.LogInformation("RDP recovery: service {Service} not present; skipping", serviceName);
                return null;
            }

            // Safe restart: stop, wait for stopped, start, wait for running.
            if (service.Status == ServiceControllerStatus.Running)
            {
                service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
                service.Refresh();
                _logger.LogWarning("RDP recovery: stopped {Service} to restore an unhealthy RDP stack", serviceName);
            }

            service.Start();
            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
            service.Refresh();
            return service;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "RDP recovery: failed to restart {Service}; continuing", serviceName);
            return null;
        }
    }

    private static ServiceController? SafeGetService(string serviceName)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            foreach (var service in ServiceController.GetServices())
            {
                if (string.Equals(service.ServiceName, serviceName, StringComparison.OrdinalIgnoreCase))
                    return service;
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    private bool IsPortOpen(CancellationToken ct)
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            // Lightweight loopback probe: bound to a short wait so an unreachable
            // listener can never hang the poll loop.
            var connect = socket.ConnectAsync(IPAddress.Loopback, RdpPort);
            if (ct.IsCancellationRequested)
            {
                return false;
            }
            return connect.Wait(TimeSpan.FromSeconds(_settings.PortCheckTimeoutSeconds)) && socket.IsBound;
        }
        catch
        {
            return false;
        }
    }

    private static bool? IsRdpEnabled()
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            // Read-only: mirrors fDenyTSConnections (0 = RDP enabled). Never writes.
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Terminal Server");
            var value = key?.GetValue("fDenyTSConnections");
            return value is int raw ? raw == 0 : null;
        }
        catch
        {
            return null;
        }
    }
}