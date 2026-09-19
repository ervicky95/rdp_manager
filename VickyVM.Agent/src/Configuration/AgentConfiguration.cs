namespace VickyVM.Agent.Configuration;

/// <summary>
/// Root configuration for the VickyVM Agent.
/// </summary>
public sealed class AgentConfiguration
{
    /// <summary>
    /// Agent runtime settings.
    /// </summary>
    public AgentSettings Agent { get; set; } = new();

    /// <summary>
    /// Logging settings (built-in levels and file logging).
    /// </summary>
    public LoggingSettings Logging { get; set; } = new();

    /// <summary>
    /// Local resource monitoring (CPU/RAM/disk) thresholds.
    /// </summary>
    public HealthSettings Health { get; set; } = new();

    /// <summary>
    /// Local RDP monitoring and recovery settings.
    /// </summary>
    public RdpSettings Rdp { get; set; } = new();

    /// <summary>
    /// Local maintenance settings for safe agent-owned cleanup.
    /// </summary>
    public MaintenanceSettings Maintenance { get; set; } = new();
}

/// <summary>
/// Thresholds for local resource monitoring. A metric at/above its warning
/// threshold raises a WARN; at/above its critical threshold raises an ERROR.
/// </summary>
public sealed class HealthSettings
{
    /// <summary>CPU usage percentage (0-100) that triggers a warning.</summary>
    public int CpuWarningPercent { get; set; } = 80;

    /// <summary>CPU usage percentage (0-100) that triggers a critical alert.</summary>
    public int CpuCriticalPercent { get; set; } = 95;

    /// <summary>RAM usage percentage (0-100) that triggers a warning.</summary>
    public int MemoryWarningPercent { get; set; } = 80;

    /// <summary>RAM usage percentage (0-100) that triggers a critical alert.</summary>
    public int MemoryCriticalPercent { get; set; } = 90;

    /// <summary>Disk usage percentage (0-100) that triggers a warning.</summary>
    public int DiskWarningPercent { get; set; } = 80;

    /// <summary>Disk usage percentage (0-100) that triggers a critical alert.</summary>
    public int DiskCriticalPercent { get; set; } = 90;

    /// <summary>Number of top CPU/RAM processes recorded when a threshold is crossed.</summary>
    public int TopProcessCount { get; set; } = 5;
}

/// <summary>
/// Local RDP monitoring settings. Automatic checks are intentionally rate
/// limited so the agent never probes RDP on every poll.
/// </summary>
public sealed class RdpSettings
{
    /// <summary>
    /// Maximum number of automatic local RDP checks per rolling 24 hours.
    /// Manual checks (Get Status / Check RDP) are never rate limited.
    /// </summary>
    public int MaxAutomaticChecksPerDay { get; set; } = 2;

    /// <summary>
    /// Minimum interval between automatic RDP checks, combined with
    /// <see cref="MaxAutomaticChecksPerDay"/> to cap automatic probing.
    /// </summary>
    public int AutoCheckIntervalHours { get; set; } = 12;

    /// <summary>
    /// Seconds to wait after restarting a service before the RDP recheck.
    /// </summary>
    public int RecoveryWaitSeconds { get; set; } = 15;

    /// <summary>
    /// Timeout in seconds for the TCP 3389 RDP listener probe.
    /// </summary>
    public int PortCheckTimeoutSeconds { get; set; } = 2;

    /// <summary>
    /// Whether automatic RDP checks are enabled at all.
    /// </summary>
    public bool AutomaticChecksEnabled { get; set; } = true;
}

/// <summary>
/// Core agent runtime settings.
/// </summary>
public sealed class AgentSettings
{
    /// <summary>
    /// Base URL of the management server (e.g., https://worker.subdomain.workers.dev).
    /// Communication is outbound HTTPS only; the agent never listens on a port.
    /// </summary>
    public string ServerUrl { get; set; } = "https://localhost:8787";

    /// <summary>
    /// Polling interval in seconds for the agent's idle loop (~60 seconds default).
    /// The loop does not spin: it waits on a timer, keeping CPU and memory use low.
    /// </summary>
    public int PollIntervalSeconds { get; set; } = 60;

    /// <summary>
    /// Grace period after service start (minutes) before scheduled work is eligible to run.
    /// </summary>
    public int StartupGracePeriodMinutes { get; set; } = 5;

    /// <summary>
    /// Minimum log level for the agent (Debug, Information, Warning, Error, Critical).
    /// </summary>
    public string LogLevel { get; set; } = "Information";

    /// <summary>
    /// Directory for agent data (state, cache for later phases).
    /// </summary>
    public string DataDirectory { get; set; } = @"C:\ProgramData\VickyVM.Agent";

    /// <summary>
    /// Path to the installer-provided enrollment token file. The token is a
    /// temporary single-use secret; it is read once during enrollment and the
    /// file is then deleted.
    /// </summary>
    public string EnrollmentTokenPath { get; set; } = @"C:\ProgramData\VickyVM.Agent\enrollment.token";

    /// <summary>
    /// Directory for log files.
    /// </summary>
    public string LogDirectory { get; set; } = @"C:\ProgramData\VickyVM.Agent\Logs";

    /// <summary>
    /// Maximum age of log files in days before automatic cleanup.
    /// </summary>
    public int MaxLogAgeDays { get; set; } = 30;

    /// <summary>
    /// Maximum total log size in MB before rotation.
    /// </summary>
    public int MaxLogSizeMB { get; set; } = 100;

    /// <summary>
    /// HTTP request timeout in seconds.
    /// </summary>
    public int RequestTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Maximum retry attempts for failed requests.
    /// </summary>
    public int MaxRetryAttempts { get; set; } = 3;

    /// <summary>
    /// Base delay for exponential backoff in seconds.
    /// </summary>
    public int BaseRetryDelaySeconds { get; set; } = 5;

    /// <summary>
    /// Maximum delay for retry backoff in seconds.
    /// </summary>
    public int MaxRetryDelaySeconds { get; set; } = 300;
}

/// <summary>
/// Logging configuration.
/// </summary>
public sealed class LoggingSettings
{
    /// <summary>
    /// Log level overrides by category.
    /// </summary>
    public Dictionary<string, string> LogLevel { get; set; } = new();

    /// <summary>
    /// File logging settings.
    /// </summary>
    public FileLoggingSettings File { get; set; } = new();
}

/// <summary>
/// File logging specific settings. Keys match the "Logging:File" JSON section.
/// </summary>
public sealed class FileLoggingSettings
{
    /// <summary>
    /// Log file path pattern (a date suffix is inserted before ".log" on rotation).
    /// </summary>
    public string Path { get; set; } = @"C:\ProgramData\VickyVM.Agent\Logs\agent-.log";

    /// <summary>
    /// Rolling interval (Day, Hour, etc.).
    /// </summary>
    public string RollingInterval { get; set; } = "Day";

    /// <summary>
    /// Maximum number of log files to retain.
    /// </summary>
    public int RetainedFileCountLimit { get; set; } = 30;

    /// <summary>
    /// Maximum size of a single log file in bytes.
    /// </summary>
    public long FileSizeLimitBytes { get; set; } = 104857600; // 100 MB

    /// <summary>
    /// Minimum level written to the file logger.
    /// </summary>
    public string MinLogLevel { get; set; } = "Information";

    /// <summary>
    /// Maximum age of log files in days before automatic cleanup.
    /// </summary>
    public int MaxLogAgeDays { get; set; } = 30;
}

/// <summary>
/// Local maintenance settings for safe agent-owned cleanup.
/// Runs at most twice per 24 hours with a startup grace period.
/// Only cleans clearly identified agent-owned temporary/cache/log files.
/// </summary>
public sealed class MaintenanceSettings
{
    /// <summary>
    /// Whether local maintenance is enabled.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Maximum maintenance runs per rolling 24 hours (default 2 = 12-hour interval).
    /// </summary>
    public int MaxRunsPerDay { get; set; } = 2;

    /// <summary>
    /// Minimum interval between maintenance runs in hours.
    /// </summary>
    public int MinIntervalHours { get; set; } = 12;

    /// <summary>
    /// Grace period after service start (minutes) before first maintenance run is eligible.
    /// </summary>
    public int StartupGracePeriodMinutes { get; set; } = 15;

    /// <summary>
    /// Timeout in seconds for the entire maintenance run.
    /// </summary>
    public int RunTimeoutSeconds { get; set; } = 60;

    /// <summary>
    /// Maximum age in days for agent log files before cleanup.
    /// </summary>
    public int LogMaxAgeDays { get; set; } = 30;

    /// <summary>
    /// Maximum age in days for agent-owned temporary files before cleanup.
    /// </summary>
    public int TempMaxAgeDays { get; set; } = 7;

    /// <summary>
    /// Maximum age in days for agent-owned cache files before cleanup.
    /// </summary>
    public int CacheMaxAgeDays { get; set; } = 14;

    /// <summary>
    /// Directory names under the agent data directory that are considered safe for cleanup.
    /// Only these subdirectories are scanned (never parent or unrelated directories).
    /// </summary>
    public List<string> CleanupSubdirectories { get; set; } = new() { "Temp", "Cache", "Logs" };

    /// <summary>
    /// File patterns considered safe for cleanup (relative to cleanup subdirectories).
    /// Only files matching these patterns are removed.
    /// </summary>
    public List<string> SafeFilePatterns { get; set; } = new() { "*.tmp", "*.temp", "*.cache", "*.log" };
}