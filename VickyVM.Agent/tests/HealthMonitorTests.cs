using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Health;
using VickyVM.Agent.Models;
using VickyVM.Agent.Tests.TestHelpers;
using Xunit;

namespace VickyVM.Agent.Tests.Health;

public class HealthMonitorTests
{
    private static HealthMonitor CreateMonitor(
        FakeSystemMetricsCollector? metrics = null,
        FakeRdpMonitor? rdp = null,
        AgentConfiguration? config = null)
    {
        config ??= new AgentConfiguration();
        return new HealthMonitor(
            LoggerFactory.Create(b => b.SetMinimumLevel(LogLevel.Debug)).CreateLogger<HealthMonitor>(),
            Options.Create(config),
            metrics ?? new FakeSystemMetricsCollector(),
            rdp ?? new FakeRdpMonitor());
    }

    [Fact]
    public async Task GetHealthReportAsync_ReturnsReport_WithoutThrowing()
    {
        // Arrange - no metrics collected on the fake; values are 0.
        var monitor = CreateMonitor(new FakeSystemMetricsCollector());

        // Act
        var report = await monitor.GetHealthReportAsync();

        // Assert
        report.Should().NotBeNull();
        report.Timestamp.Should().BeCloseTo(DateTimeOffset.UtcNow, TimeSpan.FromSeconds(30));
        report.CpuUsagePercent.Should().Be(0);
        report.MemoryUsagePercent.Should().Be(0);
        report.DiskUsagePercent.Should().Be(0);
        report.AlertLevel.Should().BeNull();
    }

    [Fact]
    public async Task GetHealthReportAsync_RespectsCancellation()
    {
        // Arrange
        var monitor = CreateMonitor();
        using var cts = new System.Threading.CancellationTokenSource();
        cts.Cancel();

        // Act - a pre-cancelled token surfaces the cancellation immediately.
        var exception = await Assert.ThrowsAsync<System.OperationCanceledException>(() =>
            monitor.GetHealthReportAsync(cancellationToken: cts.Token));

        // Assert
        exception.Should().NotBeNull();
    }

    [Fact]
    public void HealthReport_HasStableShape()
    {
        // The report model is the contract for later phases; assert the surface stays small.
        var props = typeof(HealthReport).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray();
        props.Should().BeEquivalentTo(new[]
        {
            "Timestamp", "CpuUsagePercent", "MemoryUsagePercent", "DiskUsagePercent", "AlertLevel",
            "TopCpuProcesses", "TopRamProcesses", "Rdp", "SignificantEvents",
        });
    }

    [Fact]
    public async Task CpuAboveWarning_RaisesWarning()
    {
        // Arrange
        var metrics = new FakeSystemMetricsCollector
        {
            Metrics = new ResourceMetrics { CpuUsagePercent = 85, MemoryUsagePercent = 30, DiskUsagePercent = 40 },
        };
        var monitor = CreateMonitor(metrics);

        // Act
        var report = await monitor.GetHealthReportAsync();

        // Assert
        report.AlertLevel.Should().Be("Warning");
        report.CpuUsagePercent.Should().Be(85);
    }

    [Fact]
    public async Task RamAboveCritical_RaisesCritical()
    {
        // Arrange
        var metrics = new FakeSystemMetricsCollector
        {
            Metrics = new ResourceMetrics { CpuUsagePercent = 10, MemoryUsagePercent = 95, DiskUsagePercent = 40 },
        };
        var monitor = CreateMonitor(metrics);

        // Act
        var report = await monitor.GetHealthReportAsync();

        // Assert - critical dominates and the thresholds are RAM 80/90.
        report.AlertLevel.Should().Be("Critical");
    }

    [Fact]
    public async Task DiskAboveCritical_AndHighCpu_RaisesCritical()
    {
        // Arrange
        var metrics = new FakeSystemMetricsCollector
        {
            Metrics = new ResourceMetrics { CpuUsagePercent = 96, MemoryUsagePercent = 50, DiskUsagePercent = 92 },
        };
        var monitor = CreateMonitor(metrics);

        // Act
        var report = await monitor.GetHealthReportAsync();

        // Assert - any critical resource sets the alert level.
        report.AlertLevel.Should().Be("Critical");
    }

    [Fact]
    public async Task TopProcesses_AreRecorded_InReport()
    {
        // Arrange
        var top = new[]
        {
            new ProcessSample("producer", 101, 12.5, 256),
            new ProcessSample("worker", 102, 9.1, 128),
        };
        var metrics = new FakeSystemMetricsCollector
        {
            Metrics = new ResourceMetrics { CpuUsagePercent = 90, TopCpuProcesses = top, TopRamProcesses = top },
        };
        var monitor = CreateMonitor(metrics);

        // Act
        var report = await monitor.GetHealthReportAsync();

        // Assert - the recorded top processes travel with the manual status report.
        report.TopCpuProcesses.Should().BeEquivalentTo(top);
        report.TopRamProcesses.Should().BeEquivalentTo(top);
        report.SignificantEvents.Should().NotBeEmpty();
    }

    [Fact]
    public async Task GetHealthReport_IncludeRdp_PerformsFreshRdpCheck()
    {
        // Arrange
        var rdp = new FakeRdpMonitor
        {
            OnCheck = () => new RdpReport { Status = "Healthy", Port3389Open = true },
        };
        var monitor = CreateMonitor(rdp: rdp);

        // Act
        var report = await monitor.GetHealthReportAsync(includeRdp: true);

        // Assert - a fresh check was performed and is embedded in the report.
        rdp.CheckCalls.Should().Be(1);
        report.Rdp.Should().NotBeNull();
        report.Rdp!.IsHealthy.Should().BeTrue();
    }

    [Fact]
    public async Task CheckRdp_WithRecovery_RunsRecoveryWhenUnhealthy()
    {
        // Arrange
        var rdp = new FakeRdpMonitor
        {
            OnCheck = () => new RdpReport { Status = "Unhealthy", Port3389Open = false },
            OnRecover = c => c with { Status = "Healthy", RecoveryAttempted = true, RecoveryResult = "fake recovery" },
        };
        var monitor = CreateMonitor(rdp: rdp);

        // Act
        var report = await monitor.CheckRdpAsync(recoverIfUnhealthy: true);

        // Assert - recovery was triggered exactly once after confirming unhealthy.
        rdp.RecoverCalls.Should().Be(1);
        report.RecoveryAttempted.Should().BeTrue();
        report.Status.Should().Be("Healthy");
    }

    [Fact]
    public async Task CheckRdp_WithoutRecovery_DoesNotRecover()
    {
        // Arrange
        var rdp = new FakeRdpMonitor
        {
            OnCheck = () => new RdpReport { Status = "Unhealthy" },
        };
        var monitor = CreateMonitor(rdp: rdp);

        // Act
        var report = await monitor.CheckRdpAsync(recoverIfUnhealthy: false);

        // Assert - a manual Get Status-style check never starts a recovery.
        rdp.RecoverCalls.Should().Be(0);
        report.Status.Should().Be("Unhealthy");
    }

    [Fact]
    public void Thresholds_DefaultToPhaseValues()
    {
        // Arrange - sanity check the phase defaults (CPU 80/95, RAM 80/90, disk 80/90).
        var settings = new HealthSettings();

        settings.CpuWarningPercent.Should().Be(80);
        settings.CpuCriticalPercent.Should().Be(95);
        settings.MemoryWarningPercent.Should().Be(80);
        settings.MemoryCriticalPercent.Should().Be(90);
        settings.DiskWarningPercent.Should().Be(80);
        settings.DiskCriticalPercent.Should().Be(90);
    }
}