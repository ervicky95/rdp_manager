using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Health;
using VickyVM.Agent.Http;
using VickyVM.Agent.Logging;
using VickyVM.Agent.Security;
using VickyVM.Agent.Services;

namespace VickyVM.Agent;

/// <summary>
/// VickyVM Windows Agent - Main entry point.
/// Runs as a normal visible Windows Service with outbound HTTPS communication only.
/// No inbound management port and no arbitrary process execution.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length > 0)
        {
            switch (args[0].ToLowerInvariant())
            {
                case "--version":
                    Console.WriteLine($"VickyVM Agent {GetVersion()}");
                    return 0;
                case "--help":
                case "-h":
                    PrintHelp();
                    return 0;
            }
        }

        var builder = Host.CreateApplicationBuilder(args);

        // Configuration: appsettings.json + environment overrides (VICKYVM_ prefix).
        builder.Configuration
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: true)
            .AddEnvironmentVariables(prefix: "VICKYVM_");

        builder.Services.Configure<AgentConfiguration>(builder.Configuration);

        // Register the nested AgentSettings object required by agent services.
        builder.Services.AddSingleton<AgentSettings>(sp =>
            sp.GetRequiredService<IOptions<AgentConfiguration>>().Value.Agent);

        // Structured local text logging (rolling JSON-lines files) + console.
        builder.Logging.ClearProviders();
        builder.Logging.AddStructuredFileLogging(builder.Configuration.GetSection("Logging:File"));
        builder.Logging.AddConsole();
        builder.Logging.SetMinimumLevel(LogLevel.Information);

        // Outbound-only HTTPS client abstraction.
        builder.Services.AddHttpClient<IAgentHttpClient, AgentHttpClient>();

        // Health-monitoring interfaces (CPU/RAM/disk local monitoring + RDP checks).
        builder.Services.AddSingleton<ISystemMetricsCollector, SystemMetricsCollector>();
        builder.Services.AddSingleton<IRdpMonitor, RdpMonitor>();
        builder.Services.AddSingleton<RdpCheckGuard>();
        builder.Services.AddSingleton<IHealthMonitor, HealthMonitor>();

        // Local maintenance (safe cleanup of agent-owned temp/cache/log files).
        builder.Services.AddSingleton<MaintenanceGuard>();
        builder.Services.AddHostedService<MaintenanceService>();

        // Credential protection: DPAPI on Windows; development-only fallback on
        // other platforms so the agent builds and tests cross-platform.
        builder.Services.AddSingleton<ICredentialProtector>(_ =>
            OperatingSystem.IsWindows() ? new DpapiCredentialProtector() : new DevFileCredentialProtector());
        builder.Services.AddSingleton<ICredentialStore, CredentialStore>();
        builder.Services.AddSingleton<EnrollmentTokenProvider>();

        // Main agent service. Runs as a Windows Service on Windows; console otherwise.
        builder.Services.AddHostedService<AgentService>();
        builder.Services.AddWindowsService(options =>
        {
            options.ServiceName = "VickyVM.Agent";
        });

        var host = builder.Build();

        await host.RunAsync();
        return 0;
    }

    private static void PrintHelp()
    {
        Console.WriteLine(@"
VickyVM Agent - Windows VM Management Agent (foundation)

Usage:
  VickyVM.Agent                    Run as Windows Service / console host
  VickyVM.Agent --version          Show version
  VickyVM.Agent --help             Show this help

Environment Variables (VICKYVM_ prefix, double underscore = section separator):
  VICKYVM_AGENT__SERVERURL         Override server URL
  VICKYVM_AGENT__POLLINTERVALSECONDS  Override poll interval

Configuration:
  appsettings.json                 Main configuration file

Security model:
  Outbound HTTPS only. The agent never listens on a port and never executes
  arbitrary commands.
");
    }

    private static string GetVersion()
    {
        return System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0";
    }
}