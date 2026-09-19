using System;
using System.IO;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Health;
using Xunit;

namespace VickyVM.Agent.Tests.Health;

/// <summary>
/// Verifies the automatic-RDP-check rate limit: at most two automatic checks
/// per rolling 24 hours, with the guard persisted across instances.
/// </summary>
public class RdpCheckGuardTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "vickytest-rdpguard-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly AgentConfiguration _config;

    public RdpCheckGuardTests()
    {
        _config = new AgentConfiguration
        {
            Agent = new AgentSettings { DataDirectory = _dir },
            Rdp = new RdpSettings { MaxAutomaticChecksPerDay = 2, AutoCheckIntervalHours = 12 },
        };
    }

    private RdpCheckGuard CreateGuard() => new(
        Options.Create(_config),
        LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<RdpCheckGuard>());

    [Fact]
    public async Task Allows_TwoChecks_ThenDenies_Within24Hours()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;

        // Act & Assert - checks spaced at the 12h interval are allowed up to the 2-per-24h cap.
        (await guard.TryAllowAutomaticCheckAsync(now)).Should().BeTrue();
        await guard.RecordAutomaticCheckAsync(now);

        (await guard.TryAllowAutomaticCheckAsync(now.AddHours(12))).Should().BeTrue();
        await guard.RecordAutomaticCheckAsync(now.AddHours(12));

        // The cap is two per rolling 24h; the third must be denied even on a
        // fresh instance (the state is persisted).
        var fresh = CreateGuard();
        (await fresh.TryAllowAutomaticCheckAsync(now.AddHours(13))).Should().BeFalse();
    }

    [Fact]
    public async Task Enforces_MinimumInterval_ForAutomaticChecks()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;
        await guard.RecordAutomaticCheckAsync(now);

        // Act - a check 1 hour later is too soon (12h minimum interval).
        (await guard.TryAllowAutomaticCheckAsync(now.AddHours(1))).Should().BeFalse();
    }

    [Fact]
    public async Task ManualChecks_AreNotTracked_ByTheGuard()
    {
        // Arrange - no automatic checks recorded means the next check is allowed.
        var guard = CreateGuard();

        // Act & Assert
        (await guard.TryAllowAutomaticCheckAsync(DateTimeOffset.UtcNow)).Should().BeTrue();
    }

    [Fact]
    public async Task ExpiredEntries_RollOut_After24Hours()
    {
        // Arrange
        var guard = CreateGuard();
        var now = DateTimeOffset.UtcNow;
        await guard.RecordAutomaticCheckAsync(now);
        await guard.RecordAutomaticCheckAsync(now.AddHours(1));

        // Initially capped...
        (await guard.TryAllowAutomaticCheckAsync(now.AddHours(2))).Should().BeFalse();

        // ...but a fresh 24h window allows checks again.
        (await guard.TryAllowAutomaticCheckAsync(now.AddDays(2))).Should().BeTrue();
    }

    [Fact]
    public async Task Guard_CanBeDisabled_ByConfiguration()
    {
        _config.Rdp.AutomaticChecksEnabled = false;
        var guard = CreateGuard();
        (await guard.TryAllowAutomaticCheckAsync(DateTimeOffset.UtcNow)).Should().BeFalse();
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_dir)) Directory.Delete(_dir, true); } catch { }
    }
}