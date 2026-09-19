using System;

namespace VickyVM.Agent.Health;

/// <summary>
/// Lightweight local RDP health. Deliberately non-authenticating: the check
/// inspects the TermService status, the TCP 3389 listener, and the RDP enabled
/// state without requiring any RDP login.
/// </summary>
public sealed record RdpReport
{
    /// <summary>
    /// One of "Healthy", "Unhealthy", "Unknown" or "NotSupported".
    /// RDP checks and recovery are only possible on Windows.
    /// </summary>
    public string Status { get; init; } = "Unknown";

    public bool IsHealthy => Status == "Healthy";

    public DateTimeOffset CheckedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>TermService state, e.g. "Running", "Stopped", or null when unsupported.</summary>
    public string? ServiceState { get; init; }

    /// <summary>RDP service running (TermService status Running).</summary>
    public bool? ServiceRunning { get; init; }

    /// <summary>TCP port 3389 accepting connections.</summary>
    public bool? Port3389Open { get; init; }

    /// <summary>RDP enabled in the terminal-server configuration.</summary>
    public bool? RdpEnabled { get; init; }

    /// <summary>True when a recovery pass was attempted for an unhealthy RDP state.</summary>
    public bool RecoveryAttempted { get; init; }

    /// <summary>Human-readable outcome of any recovery pass.</summary>
    public string? RecoveryResult { get; init; }

    /// <summary>Set when the recovery pass never finished its full sequence.</summary>
    public string? Error { get; init; }
}