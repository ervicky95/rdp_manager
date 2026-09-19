using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using VickyVM.Agent.Health;
using VickyVM.Agent.Http;
using VickyVM.Agent.Models;
using VickyVM.Agent.Security;

namespace VickyVM.Agent.Tests.TestHelpers;

/// <summary>
/// In-memory fake HTTP client used to drive the agent service loop in tests
/// with scripted outcomes, without any network I/O.
/// </summary>
public sealed class FakeAgentHttpClient : IAgentHttpClient
{
    public Func<string, AgentEnrollmentInfo, AgentHttpResult<EnrollmentResult>>? OnEnroll
        = (_token, _info) => new AgentHttpResult<EnrollmentResult>(
            new EnrollmentResult("ag_test123456", "dv-credential-00000000000000000000000000000000", 1),
            AgentHttpFailure.None);

    public Func<StoredAgentCredential, IReadOnlyList<AgentEvent>, AgentHttpResult<PollResult>>? OnPoll
        = (_cred, _events) => new AgentHttpResult<PollResult>(
            new PollResult(Array.Empty<AgentCommand>(), 1, DateTimeOffset.UtcNow),
            AgentHttpFailure.None);

    public int EnrollCalls { get; private set; }
    public int PollCalls { get; private set; }
    public string? LastEnrollmentToken { get; private set; }
    public StoredAgentCredential? LastPollCredential { get; private set; }
    public IReadOnlyList<AgentEvent>? LastEvents { get; private set; }

    public string BaseUrl { get; set; } = "https://fake.example.com";

    public Task<bool> PingAsync(CancellationToken cancellationToken = default) => Task.FromResult(true);

    public Task<AgentHttpResult<EnrollmentResult>> EnrollAsync(
        string enrollmentToken,
        AgentEnrollmentInfo info,
        CancellationToken cancellationToken = default)
    {
        EnrollCalls++;
        LastEnrollmentToken = enrollmentToken;
        return Task.FromResult(OnEnroll!(enrollmentToken, info));
    }

    public Task<AgentHttpResult<PollResult>> PollAsync(
        StoredAgentCredential credential,
        IReadOnlyList<AgentEvent> events,
        CancellationToken cancellationToken = default)
    {
        PollCalls++;
        LastPollCredential = credential;
        LastEvents = events;
        return Task.FromResult(OnPoll!(credential, events));
    }

    public void Dispose() { }
}

/// <summary>
/// In-memory credential store so the service loop can be tested without touching
/// the filesystem.
/// </summary>
public sealed class InMemoryCredentialStore : ICredentialStore
{
    public StoredAgentCredential? Stored { get; set; }

    public Task<StoredAgentCredential?> LoadAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(Stored);
    }

    public Task SaveAsync(StoredAgentCredential credential, CancellationToken cancellationToken = default)
    {
        Stored = credential;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        Stored = null;
        return Task.CompletedTask;
    }
}

/// <summary>
/// Scriptable metrics collector for deterministic tests; never reads the OS.
/// </summary>
public sealed class FakeSystemMetricsCollector : ISystemMetricsCollector
{
    public ResourceMetrics Metrics { get; set; } = new();
    public int CollectCalls { get; private set; }

    public Task<ResourceMetrics> CollectAsync(CancellationToken cancellationToken = default)
    {
        CollectCalls++;
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(Metrics);
    }
}

/// <summary>
/// Scriptable RDP monitor for deterministic cross-platform tests.
/// </summary>
public sealed class FakeRdpMonitor : IRdpMonitor
{
    public Func<RdpReport>? OnCheck { get; set; }
    public Func<RdpReport, RdpReport>? OnRecover { get; set; }
    public int CheckCalls { get; private set; }
    public int RecoverCalls { get; private set; }
    public bool CanCheck { get; set; }

    public Task<RdpReport> CheckAsync(CancellationToken cancellationToken = default)
    {
        CheckCalls++;
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(OnCheck?.Invoke() ?? new RdpReport { Status = "NotSupported", Error = "fake not supported" });
    }

    public Task<RdpReport> RecoverIfNeededAsync(RdpReport current, CancellationToken cancellationToken = default)
    {
        RecoverCalls++;
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(OnRecover?.Invoke(current) ?? current);
    }
}

/// <summary>
/// Scriptable health monitor so the agent service loop can be driven in tests
/// without touching the OS. Tracks whether RDP was included/recovered.
/// </summary>
public sealed class FakeHealthMonitor : IHealthMonitor
{
    public HealthReport Report { get; set; } = new();
    public RdpReport Rdp { get; set; } = new() { Status = "Healthy" };
    public bool? LastIncludeRdp { get; private set; }
    public bool? LastRecoverIfUnhealthy { get; private set; }

    public Task<HealthReport> GetHealthReportAsync(bool includeRdp = false, CancellationToken cancellationToken = default)
    {
        LastIncludeRdp = includeRdp;
        var report = new HealthReport
        {
            Timestamp = Report.Timestamp,
            CpuUsagePercent = Report.CpuUsagePercent,
            MemoryUsagePercent = Report.MemoryUsagePercent,
            DiskUsagePercent = Report.DiskUsagePercent,
            AlertLevel = Report.AlertLevel,
            TopCpuProcesses = Report.TopCpuProcesses,
        };
        return Task.FromResult(report);
    }

    public Task<RdpReport> CheckRdpAsync(bool recoverIfUnhealthy = false, CancellationToken cancellationToken = default)
    {
        LastRecoverIfUnhealthy = recoverIfUnhealthy;
        return Task.FromResult(Rdp);
    }
}
