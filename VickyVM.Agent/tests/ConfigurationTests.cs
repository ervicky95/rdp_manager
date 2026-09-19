using System.IO;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using VickyVM.Agent.Configuration;
using Xunit;

namespace VickyVM.Agent.Tests.Configuration;

public class ConfigurationTests
{
    private static AgentConfiguration BindTestConfig()
    {
        var configBuilder = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.Test.json", optional: false);

        var config = configBuilder.Build();

        var agentConfig = new AgentConfiguration();
        config.Bind(agentConfig);
        return agentConfig;
    }

    [Fact]
    public void AgentConfiguration_BindsSections_FromJson()
    {
        // Act
        var config = BindTestConfig();

        // Assert
        config.Should().NotBeNull();
        config.Agent.Should().NotBeNull();
        config.Logging.Should().NotBeNull();
        config.Logging.File.Should().NotBeNull();
    }

    [Fact]
    public void AgentSettings_BindsValues_FromJson()
    {
        // Act
        var config = BindTestConfig();

        // Assert
        config.Agent.ServerUrl.Should().Be("https://test.example.com");
        config.Agent.PollIntervalSeconds.Should().Be(10);
        config.Agent.StartupGracePeriodMinutes.Should().Be(1);
        config.Agent.LogLevel.Should().Be("Debug");
        config.Agent.DataDirectory.Should().Be(@"C:\Temp\VickyVM.Agent.Tests");
        config.Agent.RequestTimeoutSeconds.Should().Be(10);
        config.Agent.MaxRetryAttempts.Should().Be(1);
    }

    [Fact]
    public void FileLoggingSettings_BindsValues_FromJson()
    {
        // Act
        var config = BindTestConfig();

        // Assert - Logging:File keys must bind to the logger options (regression:
        // the old options used different property names and the JSON was silently ignored).
        config.Logging.File.Path.Should().Be(@"C:\Temp\VickyVM.Agent.Tests\Logs\agent-.log");
        config.Logging.File.MinLogLevel.Should().Be("Debug");
        config.Logging.File.RollingInterval.Should().Be("Day");
        config.Logging.File.RetainedFileCountLimit.Should().Be(1);
        config.Logging.File.FileSizeLimitBytes.Should().Be(10485760);
        config.Logging.File.MaxLogAgeDays.Should().Be(1);
    }

    [Fact]
    public void AgentSettings_HaveSafeDefaults_WhenNotProvided()
    {
        // Arrange - no providers, pure defaults via binder round-trip
        var config = new ConfigurationBuilder().Build();
        var agentConfig = new AgentConfiguration();
        config.Bind(agentConfig);

        // Assert
        agentConfig.Agent.ServerUrl.Should().Be("https://localhost:8787");
        agentConfig.Agent.PollIntervalSeconds.Should().Be(60);
        agentConfig.Agent.StartupGracePeriodMinutes.Should().Be(5);
        agentConfig.Logging.File.Path.Should().Be(@"C:\ProgramData\VickyVM.Agent\Logs\agent-.log");
        agentConfig.Logging.File.MinLogLevel.Should().Be("Information");
    }

    [Fact]
    public void AgentSettings_EnvironmentVariables_OverrideJson()
    {
        // Arrange - VICKYVM_ prefix; "__" separates the section from the property.
        var configBuilder = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.Test.json", optional: false)
            .AddEnvironmentVariables(prefix: "VICKYVM_");

        System.Environment.SetEnvironmentVariable("VICKYVM_AGENT__SERVERURL", "https://env.example.com");
        try
        {
            var config = configBuilder.Build();
            var agentConfig = new AgentConfiguration();
            config.Bind(agentConfig);

            // Act & Assert
            agentConfig.Agent.ServerUrl.Should().Be("https://env.example.com");
            agentConfig.Agent.PollIntervalSeconds.Should().Be(10, "other settings still come from JSON");
        }
        finally
        {
            System.Environment.SetEnvironmentVariable("VICKYVM_AGENT__SERVERURL", null);
        }
    }
}