using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Health;
using VickyVM.Agent.Http;
using VickyVM.Agent.Models;
using VickyVM.Agent.Security;
using VickyVM.Agent.Services;
using VickyVM.Agent.Tests.TestHelpers;
using Xunit;

namespace VickyVM.Agent.Tests.Services;

/// <summary>
/// Tests for the enroll-then-poll service loop. All I/O is faked/in-memory so
/// the loop runs deterministically on any platform. No network, no secrets in
/// test output.
/// </summary>
public class AgentServiceTests
{
    private static AgentService CreateService(
        FakeAgentHttpClient? http = null,
        InMemoryCredentialStore? store = null,
        EnrollmentTokenProvider? tokens = null,
        FakeHealthMonitor? health = null)
    {
        var config = Options.Create(new AgentConfiguration
        {
            Agent = new AgentSettings
            {
                PollIntervalSeconds = 1,
                StartupGracePeriodMinutes = 1,
                BaseRetryDelaySeconds = 1,
                MaxRetryDelaySeconds = 2,
                DataDirectory = "/tmp/vickytest/none",
                EnrollmentTokenPath = "/tmp/vickytest/none/enrollment.token",
            },
            // Automatic RDP checks stay off so the loop is fully deterministic.
            Rdp = new RdpSettings { AutomaticChecksEnabled = false },
        });

        var logger = LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<AgentService>();
        var rdpGuard = new RdpCheckGuard(
            config,
            LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<RdpCheckGuard>());
        var healthMonitor = health ?? new FakeHealthMonitor();

        return new AgentService(
            logger,
            config,
            http ?? new FakeAgentHttpClient(),
            (ICredentialStore)(store ?? new InMemoryCredentialStore()),
            tokens ?? new EnrollmentTokenProvider(config.Value.Agent, LoggerFactory
                .Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<EnrollmentTokenProvider>()),
            healthMonitor,
            rdpGuard);
    }

    [Fact]
    public async Task Service_StartsAndStops_WithoutError()
    {
        // Arrange - no token and no credential; the loop should just wait.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await StartAndStop(cts.Token);
    }

    [Fact]
    public async Task Service_StopsCleanly_OnCancellation()
    {
        using var startCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var stopCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var service = CreateService();
        await service.StartAsync(startCts.Token);
        await Task.Delay(200);
        await service.StopAsync(stopCts.Token);
    }

    [Fact]
    public async Task Enrolls_ThenPolls_WhenTokenPresent()
    {
        // Arrange
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        var enrollmentIssued = new StoredAgentCredential("ag_issued", "dv-secret-issued-xxxxxxxxxxxxxxxxxxxx");
        http.OnEnroll = (_t, _i) => new AgentHttpResult<EnrollmentResult>(
            new EnrollmentResult(enrollmentIssued.AgentId, enrollmentIssued.Credential, 1),
            AgentHttpFailure.None);

        var config = Options.Create(new AgentConfiguration
        {
            Agent = new AgentSettings { PollIntervalSeconds = 1, BaseRetryDelaySeconds = 1, MaxRetryDelaySeconds = 1 }
        });

        using var tokenDir = new TempDir();
        var tokenPath = Path.Combine(tokenDir.Path, "enrollment.token");
        await File.WriteAllTextAsync(tokenPath, "tok-single-use-123456");
        var tokens = new EnrollmentTokenProvider(
            new AgentSettings { EnrollmentTokenPath = tokenPath },
            LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<EnrollmentTokenProvider>());

        var rdpGuard = new RdpCheckGuard(
            config,
            LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<RdpCheckGuard>());

        var service = new AgentService(
            LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<AgentService>(),
            config, http, store, tokens, new FakeHealthMonitor(), rdpGuard);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));

        // Act - run until it has enrolled and polled at least once
        await service.StartAsync(cts.Token);
        await WaitForAsync(() => http.EnrollCalls >= 1 && http.PollCalls >= 1, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert
        store.Stored.Should().NotBeNull();
        store.Stored!.AgentId.Should().Be(enrollmentIssued.AgentId);
        store.Stored.Credential.Should().Be(enrollmentIssued.Credential);

        // The enrollment token file must be consumed (deleted) after enrollment.
        File.Exists(tokenPath).Should().BeFalse("the single-use token file is deleted after enrollment");

        // The correct credential and a heartbeat event were sent on poll.
        http.LastPollCredential.Should().BeEquivalentTo(enrollmentIssued);
    }

    [Fact]
    public async Task RejectsCredential_AndClearsStore_WhenServerReturnsUnauthorized()
    {
        // Arrange
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        store.Stored = new StoredAgentCredential("ag_active", "dv-secret-active-0000000000000000000000");
        http.OnPoll = (_c, _e) => new AgentHttpResult<PollResult>(null, AgentHttpFailure.Unauthorized);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var service = await StartService(http, store, cts.Token);

        // Act - run until the unauthorized poll has been processed
        await WaitForAsync(() => store.Stored is null && http.PollCalls >= 1, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert - the rejected credential is dropped so the agent can re-enroll
        store.Stored.Should().BeNull();
    }

    [Fact]
    public async Task Survives_NetworkFailure_AndRetriesPolling()
    {
        // Arrange
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        store.Stored = new StoredAgentCredential("ag_resilient", "dv-secret-resilient-000000000000000");
        var polls = 0;
        http.OnPoll = (_c, _e) =>
        {
            polls++;
            return polls == 1
                ? new AgentHttpResult<PollResult>(null, AgentHttpFailure.Network)
                : new AgentHttpResult<PollResult>(new PollResult(Array.Empty<AgentCommand>(), 1, DateTimeOffset.UtcNow), AgentHttpFailure.None);
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var service = await StartService(http, store, cts.Token);

        // Act - wait until a retry poll succeeds after the initial network failure
        await WaitForAsync(() => http.PollCalls >= 2 && polls >= 2, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert - the credential was retained across the transient failure
        store.Stored.Should().NotBeNull();
    }

    [Fact]
    public async Task AcknowledgesReceivedCommands_WithCompactEvents()
    {
        // Arrange
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        store.Stored = new StoredAgentCredential("ag_cmd", "dv-secret-cmd-000000000000000000000000");
        var commandDelivered = false;
        http.OnPoll = (_c, _e) =>
        {
            if (!commandDelivered)
            {
                commandDelivered = true;
                return new AgentHttpResult<PollResult>(
                    new PollResult(new[] { new AgentCommand("cmd-1", "restart", DateTimeOffset.UtcNow) }, 1, DateTimeOffset.UtcNow),
                    AgentHttpFailure.None);
            }
            return new AgentHttpResult<PollResult>(new PollResult(Array.Empty<AgentCommand>(), 1, DateTimeOffset.UtcNow), AgentHttpFailure.None);
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var service = await StartService(http, store, cts.Token);

        // Act - wait for the commanded poll and the subsequent ack poll
        await WaitForAsync(() => http.PollCalls >= 2, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert - the follow-up poll carried a compact acknowledgement for the command
        http.LastEvents!.Should().Contain(e => e.Type == "command_acknowledged" && e.CommandId == "cmd-1");
        // A heartbeat is always reported alongside compact events.
        http.LastEvents.Should().Contain(e => e.Type == "heartbeat");
    }

    [Fact]
    public async Task GetStatusCommand_PerformsFreshStatusAndRdpCheck_AndReportsCompleted()
    {
        // Arrange - the fake reports realistic local metrics and a healthy RDP.
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        store.Stored = new StoredAgentCredential("ag_stat", "dv-secret-stat-0000000000000000000000000");
        var health = new FakeHealthMonitor
        {
            Report = new HealthReport { CpuUsagePercent = 12.5, MemoryUsagePercent = 40, DiskUsagePercent = 30 },
            Rdp = new RdpReport { Status = "Healthy" },
        };
        var commandDelivered = false;
        http.OnPoll = (_c, _e) =>
        {
            if (!commandDelivered)
            {
                commandDelivered = true;
                return new AgentHttpResult<PollResult>(
                    new PollResult(new[] { new AgentCommand("cmd-s1", "get_status", DateTimeOffset.UtcNow) }, 1, DateTimeOffset.UtcNow),
                    AgentHttpFailure.None);
            }
            return new AgentHttpResult<PollResult>(new PollResult(Array.Empty<AgentCommand>(), 1, DateTimeOffset.UtcNow), AgentHttpFailure.None);
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var service = await StartServiceWithHealth(http, store, health, cts.Token);

        // Act - wait for the commanded poll plus the completed-event poll
        await WaitForAsync(() => http.PollCalls >= 2, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert - a fresh status (including a fresh RDP check) was reported as completed.
        http.LastEvents!.Should().Contain(e =>
            e.Type == "command_completed" && e.CommandId == "cmd-s1" && e.Result!.Contains("cpu_percent"));
        health.LastIncludeRdp.Should().BeTrue("manual Get Status performs a fresh RDP check");
    }

    [Fact]
    public async Task CheckRdpCommand_TriggersRecovery_AndReportsCompleted()
    {
        // Arrange
        var http = new FakeAgentHttpClient();
        var store = new InMemoryCredentialStore();
        store.Stored = new StoredAgentCredential("ag_rdp", "dv-secret-rdp-00000000000000000000000000");
        var health = new FakeHealthMonitor
        {
            Rdp = new RdpReport { Status = "Healthy", RecoveryAttempted = true, RecoveryResult = "fake recovery" },
        };
        var commandDelivered = false;
        http.OnPoll = (_c, _e) =>
        {
            if (!commandDelivered)
            {
                commandDelivered = true;
                return new AgentHttpResult<PollResult>(
                    new PollResult(new[] { new AgentCommand("cmd-r1", "check_rdp", DateTimeOffset.UtcNow) }, 1, DateTimeOffset.UtcNow),
                    AgentHttpFailure.None);
            }
            return new AgentHttpResult<PollResult>(new PollResult(Array.Empty<AgentCommand>(), 1, DateTimeOffset.UtcNow), AgentHttpFailure.None);
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var service = await StartServiceWithHealth(http, store, health, cts.Token);

        // Act - wait for the commanded poll plus the completed-event poll
        await WaitForAsync(() => http.PollCalls >= 2, TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        // Assert - a fresh check_rdp (with recovery) reported its result.
        http.LastEvents!.Should().Contain(e =>
            e.Type == "command_completed" && e.CommandId == "cmd-r1" && e.Result!.Contains("recovery"));
        health.LastRecoverIfUnhealthy.Should().BeTrue("Check RDP runs the safe recovery sequence");
    }

    private static async Task<AgentService> StartServiceWithHealth(
        FakeAgentHttpClient http,
        InMemoryCredentialStore store,
        FakeHealthMonitor health,
        CancellationToken ct)
    {
        var service = CreateService(http, store, health: health);
        await service.StartAsync(ct);
        return service;
    }

    private static async Task<AgentService> StartService(FakeAgentHttpClient http, InMemoryCredentialStore store, CancellationToken ct)
    {
        var service = CreateService(http, store);
        await service.StartAsync(ct);
        return service;
    }

    private static async Task StartAndStop(CancellationToken ct)
    {
        var service = CreateService();
        await service.StartAsync(ct);
        await Task.Delay(200);
        await service.StopAsync(CancellationToken.None);
    }

    private static async Task WaitForAsync(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(50);
        }
        throw new TimeoutException("Condition was not met within the timeout");
    }

    private sealed class TempDir : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "vickytest-" + Guid.NewGuid().ToString("N")[..8]);
        public TempDir() => Directory.CreateDirectory(Path);
        public void Dispose()
        {
            try { if (Directory.Exists(Path)) Directory.Delete(Path, true); } catch { }
        }
    }
}
