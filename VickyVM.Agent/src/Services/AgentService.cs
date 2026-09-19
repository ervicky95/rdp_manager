using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Health;
using VickyVM.Agent.Http;
using VickyVM.Agent.Models;
using VickyVM.Agent.Security;

namespace VickyVM.Agent.Services;

/// <summary>
/// Main agent background service.
///
/// Phase 5 state machine:
///  - If no stored credential, read the installer-provided enrollment token
///    and enroll over HTTPS (with exponential-backoff retries). The server
///    issues an agent credential, which is stored at rest (DPAPI on Windows).
///  - Once enrolled, poll every ~60s over HTTPS with the credential. Polling
///    stays lightweight: heartbeats, command acknowledgements and compact
///    command results — full CPU/RAM/disk/RDP status is only uploaded when the
///    operator explicitly requests a manual Get Status or Check RDP.
///  - Manual commands handled this phase: "get_status" (fresh local resources
///    plus a fresh RDP check) and "check_rdp" (fresh RDP check plus safe
///    recovery when confirmed unhealthy). Other allowlisted commands are only
///    acknowledged (execution is a later phase).
///  - Automatic local RDP checks run at most twice per 24h (never every poll),
///    stay entirely local, and never upload full status. Checks and recovery
///    require no RDP login.
///  - On network failure, back off and reconnect. If the server rejects the
///    credential (401), drop it and re-enter the enrolling state.
///
/// No inbound ports, no arbitrary process execution, no secret logging.
/// </summary>
public sealed class AgentService : BackgroundService
{
    private const string GetStatusCommand = "get_status";
    private const string CheckRdpCommand = "check_rdp";

    private readonly ILogger<AgentService> _logger;
    private readonly AgentSettings _settings;
    private readonly IAgentHttpClient _http;
    private readonly ICredentialStore _credentialStore;
    private readonly EnrollmentTokenProvider _enrollmentTokens;
    private readonly IHealthMonitor _health;
    private readonly RdpCheckGuard _rdpGuard;

    private bool _hasCredential;
    private StoredAgentCredential? _credential;
    private readonly HashSet<string> _pendingCommandIds = new();
    private readonly List<AgentEvent> _pendingEvents = new();

    public AgentService(
        ILogger<AgentService> logger,
        IOptions<AgentConfiguration> config,
        IAgentHttpClient http,
        ICredentialStore credentialStore,
        EnrollmentTokenProvider enrollmentTokens,
        IHealthMonitor health,
        RdpCheckGuard rdpGuard)
    {
        _logger = logger;
        _settings = config.Value.Agent;
        _http = http;
        _credentialStore = credentialStore;
        _enrollmentTokens = enrollmentTokens;
        _health = health;
        _rdpGuard = rdpGuard;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        _logger.LogInformation("VickyVM Agent service starting (version {Version})", version);

        // Recover an existing credential across restarts so the agent does not
        // need the installer again unless re-enrollment is genuinely required.
        _credential = await _credentialStore.LoadAsync(stoppingToken);
        _hasCredential = _credential is not null;

        var backoff = new ExponentialBackoff(_settings.BaseRetryDelaySeconds, _settings.MaxRetryDelaySeconds);

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                if (_hasCredential)
                {
                    var outcome = await PollOnceAsync(stoppingToken);
                    switch (outcome)
                    {
                        case PollOutcome.Unauthorized:
                            _logger.LogWarning("Server rejected the agent credential; re-enrollment required");
                            _hasCredential = false;
                            _credential = null;
                            _pendingCommandIds.Clear();
                            _pendingEvents.Clear();
                            await _credentialStore.DeleteAsync(stoppingToken);
                            backoff.Reset();
                            break;
                        case PollOutcome.Failed:
                            _logger.LogWarning("Poll failed; backing off and retrying");
                            await DelayOrCancel(backoff.NextDelay(), stoppingToken);
                            continue;
                        default:
                            backoff.Reset();
                            break;
                    }
                }
                else
                {
                    var enrolled = await TryEnrollAsync(backoff, stoppingToken);
                    if (!enrolled)
                    {
                        await DelayOrCancel(backoff.NextDelay(), stoppingToken);
                        continue;
                    }
                }

                // Automatic RDP checks are rate limited (at most 2 per rolling
                // 24h) and stay local: nothing is uploaded on this path.
                await MaybeRunAutomaticRdpCheckAsync(stoppingToken);

                await DelayOrCancel(TimeSpan.FromSeconds(_settings.PollIntervalSeconds), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }

    private async Task<PollOutcome> PollOnceAsync(CancellationToken ct)
    {
        var events = new List<AgentEvent> { new("heartbeat") };
        events.AddRange(_pendingEvents);
        _pendingEvents.Clear();
        foreach (var commandId in _pendingCommandIds)
        {
            events.Add(new AgentEvent("command_acknowledged", CommandId: commandId));
        }
        _pendingCommandIds.Clear();

        var result = await _http.PollAsync(_credential!, events, ct);
        if (result.IsUnauthorized) return PollOutcome.Unauthorized;
        if (result.Result is null) return PollOutcome.Failed;

        // Commands received are allowlisted. "get_status" and "check_rdp" are
        // handled this phase with fresh local checks; every other command is
        // only acknowledged (execution arrives in a later phase).
        foreach (var command in result.Result.Commands)
        {
            try
            {
                switch (command.Command)
                {
                    case GetStatusCommand:
                        await ExecuteGetStatusAsync(command, ct);
                        break;
                    case CheckRdpCommand:
                        await ExecuteCheckRdpAsync(command, ct);
                        break;
                    default:
                        _pendingCommandIds.Add(command.Id);
                        _logger.LogInformation(
                            "Received allowlisted command {Command} (id {IdSuffix}); acknowledgment queued",
                            command.Command, Redact(command.Id));
                        break;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Command {Command} (id {IdSuffix}) failed", command.Command, Redact(command.Id));
                _pendingEvents.Add(new AgentEvent("command_failed", CommandId: command.Id, Result: "command execution failed: " + ex.Message));
            }
        }
        return PollOutcome.Success;
    }

    private async Task ExecuteGetStatusAsync(AgentCommand command, CancellationToken ct)
    {
        var report = await _health.GetHealthReportAsync(includeRdp: true, ct);
        var payload = JsonSerializer.Serialize(new
        {
            cpu_percent = report.CpuUsagePercent,
            memory_percent = report.MemoryUsagePercent,
            disk_percent = report.DiskUsagePercent,
            alert = report.AlertLevel,
            top_cpu = SelectTop(report.TopCpuProcesses, p => $"{p.ProcessName} {p.CpuPercent:F1}%"),
            top_ram = SelectTop(report.TopRamProcesses, p => $"{p.ProcessName} {p.MemoryMb}MB"),
            rdp = report.Rdp is null ? null : RdpSummary(report.Rdp),
            significant_events = report.SignificantEvents,
        });
        _pendingEvents.Add(new AgentEvent("command_completed", CommandId: command.Id, Result: payload));
        _logger.LogInformation("Reported manual status for command {IdSuffix}", Redact(command.Id));
    }

    private async Task ExecuteCheckRdpAsync(AgentCommand command, CancellationToken ct)
    {
        var rdp = await _health.CheckRdpAsync(recoverIfUnhealthy: true, ct);
        var payload = JsonSerializer.Serialize(new
        {
            rdp = RdpSummary(rdp),
            recovery_attempted = rdp.RecoveryAttempted,
            recovery_result = rdp.RecoveryResult,
        });
        _pendingEvents.Add(new AgentEvent("command_completed", CommandId: command.Id, Result: payload));
        _logger.LogInformation("Reported manual RDP check for command {IdSuffix} (status {Status})", Redact(command.Id), rdp.Status);
    }

    private async Task MaybeRunAutomaticRdpCheckAsync(CancellationToken ct)
    {
        bool allowed;
        try
        {
            allowed = await _rdpGuard.TryAllowAutomaticCheckAsync(DateTimeOffset.UtcNow, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return;
        }

        if (!allowed) return;

        // Local-only lightweight check; never uploaded and never allowed to
        // block the poll loop.
        _ = Task.Run(() => RunAutomaticRdpCheckAsync(ct), ct);
    }

    private async Task RunAutomaticRdpCheckAsync(CancellationToken ct)
    {
        try
        {
            var rdp = await _health.CheckRdpAsync(recoverIfUnhealthy: true, ct);
            await _rdpGuard.RecordAutomaticCheckAsync(DateTimeOffset.UtcNow, ct);
            if (rdp.IsHealthy)
            {
                _logger.LogInformation("Automatic local RDP check: healthy");
            }
            else
            {
                _logger.LogWarning(
                    "Automatic local RDP check: {Status} (recovery: {Recovery})",
                    rdp.Status, rdp.RecoveryResult ?? rdp.Error ?? "none");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Service stopping; nothing to report.
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Automatic local RDP check failed");
        }
    }

    private static string[] SelectTop(IReadOnlyList<ProcessSample> samples, Func<ProcessSample, string> format)
        => samples.Take(5).Select(format).ToArray();

    private static string RdpSummary(RdpReport rdp)
    {
        var parts = new List<string>
        {
            rdp.Status,
        };
        if (rdp.ServiceState is not null) parts.Add($"service={rdp.ServiceState}");
        if (rdp.Port3389Open is { } port) parts.Add($"port3389={(port ? "open" : "closed")}");
        if (rdp.RdpEnabled is { } enabled) parts.Add($"rdp_enabled={(enabled ? "yes" : "no")}");
        if (rdp.RecoveryResult is not null) parts.Add($"recovery={rdp.RecoveryResult}");
        return string.Join(", ", parts);
    }

    private async Task<bool> TryEnrollAsync(ExponentialBackoff backoff, CancellationToken ct)
    {
        var token = await _enrollmentTokens.GetTokenAsync(ct);
        if (token is null)
        {
            _logger.LogDebug("No agent credential and no enrollment token available; waiting for the operator to install one");
            return false;
        }

        var info = new AgentEnrollmentInfo(
            MachineId: Environment.MachineName,
            Hostname: Environment.MachineName,
            AgentVersion: CurrentVersion());

        var result = await _http.EnrollAsync(token, info, ct);
        if (result.IsUnauthorized)
        {
            _logger.LogWarning("Enrollment token was rejected as invalid or expired");
            // Do not keep retrying a bad token; the operator must mint a new one.
            await _enrollmentTokens.ClearAsync(ct);
            return false;
        }
        if (result.Result is null)
        {
            _logger.LogWarning("Enrollment could not be completed (network/server); will retry");
            return false;
        }

        var issued = new StoredAgentCredential(result.Result.AgentId, result.Result.Credential);
        await _credentialStore.SaveAsync(issued, ct);
        _credential = issued;
        _hasCredential = true;
        await _enrollmentTokens.ClearAsync(ct);

        _logger.LogInformation(
            "Enrollment complete (agent {AgentIdSuffix}); credential stored securely",
            Redact(result.Result.AgentId));
        backoff.Reset();
        return true;
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("VickyVM Agent service stopping");
        await base.StopAsync(cancellationToken);
    }

    private static async Task DelayOrCancel(TimeSpan delay, CancellationToken ct)
    {
        try
        {
            await Task.Delay(delay, ct);
        }
        catch (OperationCanceledException)
        {
            // Propagate cancellation as the loop expects.
            throw;
        }
    }

    private static string CurrentVersion()
        => System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";

    /// <summary>
    /// Logs only a short, stable fragment of an identifier for operability while
    /// never logging the full value (or any credential).
    /// </summary>
    private static string Redact(string value)
        => value.Length > 6 ? value[^6..] : value;

    private enum PollOutcome
    {
        Success,
        Unauthorized,
        Failed,
    }
}
