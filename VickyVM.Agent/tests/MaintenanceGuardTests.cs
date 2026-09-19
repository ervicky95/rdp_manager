using System;
using System.IO;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Services;
using Xunit;

namespace VickyVM.Agent.Tests.Services;

/// <summary>
/// Verifies the maintenance run rate limit: at most two runs per rolling 24 hours,
/// with the guard persisted across instances. Also verifies startup grace period
/// and minimum interval enforcement.
/// </summary>
public class MaintenanceGuardTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "vickytest-maintenance-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly AgentConfiguration _config;

    public MaintenanceGuardTests()
    {
        _config = new AgentConfiguration
        {
            Agent = new AgentSettings { DataDirectory = _dir },
            Maintenance = new MaintenanceSettings
            {
                Enabled = true,
                MaxRunsPerDay = 2,
                MinIntervalHours = 12,
                StartupGracePeriodMinutes = 15,
            },
        };
    }

    private MaintenanceGuard CreateGuard() => new(
        Options.Create(_config),
        LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<MaintenanceGuard>());

    [Fact]
    public async Task Allows_TwoRuns_ThenDenies_Within24Hours()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;
        var uptime = TimeSpan.FromMinutes(20); // Past grace period

        // Act & Assert - runs spaced at the 12h interval are allowed up to the 2-per-24h cap.
        (await guard.TryAllowRunAsync(now, uptime)).Should().BeTrue();
        await guard.RecordRunAsync(now);

        (await guard.TryAllowRunAsync(now.AddHours(12), uptime)).Should().BeTrue();
        await guard.RecordRunAsync(now.AddHours(12));

        // The cap is two per rolling 24h; the third must be denied even on a
        // fresh instance (the state is persisted).
        var fresh = CreateGuard();
        (await fresh.TryAllowRunAsync(now.AddHours(13), uptime)).Should().BeFalse();
    }

    [Fact]
    public async Task Enforces_MinimumInterval_ForRuns()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;
        var uptime = TimeSpan.FromMinutes(20);
        await guard.RecordRunAsync(now);

        // Act - a run 1 hour later is too soon (12h minimum interval).
        (await guard.TryAllowRunAsync(now.AddHours(1), uptime)).Should().BeFalse();
    }

    [Fact]
    public async Task Respects_StartupGracePeriod()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;

        // Act & Assert - within grace period (15 min), should be denied
        (await guard.TryAllowRunAsync(now, TimeSpan.FromMinutes(5))).Should().BeFalse();
        (await guard.TryAllowRunAsync(now, TimeSpan.FromMinutes(14))).Should().BeFalse();

        // After grace period, should be allowed
        (await guard.TryAllowRunAsync(now, TimeSpan.FromMinutes(16))).Should().BeTrue();
    }

    [Fact]
    public async Task ExpiredEntries_RollOut_After24Hours()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;
        var uptime = TimeSpan.FromMinutes(20);
        await guard.RecordRunAsync(now);
        await guard.RecordRunAsync(now.AddHours(1));

        // Initially capped...
        (await guard.TryAllowRunAsync(now.AddHours(2), uptime)).Should().BeFalse();

        // ...but a fresh 24h window allows runs again.
        (await guard.TryAllowRunAsync(now.AddDays(2), uptime)).Should().BeTrue();
    }

    [Fact]
    public async Task Guard_CanBeDisabled_ByConfiguration()
    {
        _config.Maintenance.Enabled = false;
        var guard = CreateGuard();
        var uptime = TimeSpan.FromMinutes(20);
        (await guard.TryAllowRunAsync(DateTimeOffset.UtcNow, uptime)).Should().BeFalse();
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_dir)) Directory.Delete(_dir, true); } catch { }
    }
}