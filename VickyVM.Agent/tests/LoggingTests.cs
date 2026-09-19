using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Logging;
using VickyVM.Agent.Tests.TestHelpers;
using Xunit;

namespace VickyVM.Agent.Tests.Logging;

public class StructuredLoggerTests : IClassFixture<TempDirectoryFixture>
{
    private readonly TempDirectoryFixture _fixture;
    private readonly string _testDir;

    public StructuredLoggerTests(TempDirectoryFixture fixture)
    {
        _fixture = fixture;
        // Isolate each test: the shared class fixture must not leak log lines between tests.
        _testDir = Path.Combine(fixture.TempPath, Guid.NewGuid().ToString("N")[..8]);
    }

    private string DatedLogPath => Path.Combine(_testDir, $"agent-{DateTime.UtcNow:yyyy-MM-dd}.log");

    private StructuredLogger CreateLogger(string minLevel = "Information", string? subdir = null)
    {
        var options = Options.Create(new StructuredLoggerOptions
        {
            Path = Path.Combine(subdir is null ? _testDir : Path.Combine(_testDir, subdir), "agent-.log"),
            MinLogLevel = minLevel,
            RetainedFileCountLimit = 5,
            FileSizeLimitBytes = 1048576,
            MaxLogAgeDays = 30
        });
        return new StructuredLogger("VickyVM.Agent.Tests", options);
    }

    [Fact]
    public void Log_WritesJsonLine_ToDatedFile()
    {
        // Arrange
        using var logger = CreateLogger();

        // Act
        logger.LogInformation("Agent started on {Machine}", "vm-01");

        // Assert
        File.Exists(DatedLogPath).Should().BeTrue("the logger must write to the configured path with a date stamp");
        var lines = File.ReadAllLines(DatedLogPath);
        lines.Should().HaveCount(1);
        lines[0].Should().Contain("Agent started on vm-01");

        using var doc = JsonDocument.Parse(lines[0]);
        var root = doc.RootElement;
        root.GetProperty("Level").GetString().Should().Be("Information");
        root.GetProperty("Category").GetString().Should().Be("VickyVM.Agent.Tests");
        root.GetProperty("Timestamp").GetDateTime().Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(60));
    }

    [Fact]
    public void Log_FiltersEntries_BelowMinimumLevel()
    {
        // Arrange
        using var logger = CreateLogger(minLevel: "Information");

        // Act - below minimum level only
        logger.LogTrace("trace message {Id}", 1);

        // Assert - nothing was written
        File.Exists(DatedLogPath).Should().BeFalse("Trace is below the Information minimum");

        // Act - at/above minimum level
        logger.LogWarning("warning message");

        // Assert
        File.Exists(DatedLogPath).Should().BeTrue();
        File.ReadAllLines(DatedLogPath).Should().ContainSingle(l => l.Contains("warning message"));
    }

    [Fact]
    public void Log_IncludesException_WhenProvided()
    {
        // Arrange
        using var logger = CreateLogger();
        var exception = new InvalidOperationException("boom");

        // Act
        logger.LogError(exception, "Operation failed");

        // Assert
        var line = File.ReadAllLines(DatedLogPath).Single();
        line.Should().Contain("Operation failed");
        line.Should().Contain("InvalidOperationException");
        line.Should().Contain("boom");
    }

    [Fact]
    public void Log_DoesNotThrow_WhenDirectoryMissing()
    {
        // Arrange - directory does not exist yet
        var options = Options.Create(new StructuredLoggerOptions
        {
            Path = Path.Combine(_testDir, "nested", "logs", "agent-.log"),
            MinLogLevel = "Information"
        });

        using var logger = new StructuredLogger("test", options);

        // Act & Assert
        var act = () => logger.LogInformation("hello");
        act.Should().NotThrow();
        File.Exists(Path.Combine(_testDir, "nested", "logs", $"agent-{DateTime.UtcNow:yyyy-MM-dd}.log"))
            .Should().BeTrue("the logger must create missing directories");
    }
}