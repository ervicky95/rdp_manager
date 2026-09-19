using System.Threading;
using System.Threading.Tasks;

namespace VickyVM.Agent.Health;

/// <summary>
/// Local RDP health checks and recovery. All checks are lightweight and
/// non-authenticating (no RDP login required). Recovery only restarts the RDP
/// services via safe Windows service APIs; it never reboots the machine,
/// changes firewall rules, or writes to the registry.
/// </summary>
public interface IRdpMonitor
{
    /// <summary>
    /// True when local RDP checks are supported on this platform (Windows).
    /// </summary>
    bool CanCheck { get; }

    /// <summary>
    /// Performs a fresh local RDP health check. Never initiates recovery.
    /// </summary>
    Task<RdpReport> CheckAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// If the given report confirms an unhealthy RDP state, runs the recovery
    /// sequence (TermService, then UmRdpService once if still unhealthy),
    /// waiting <c>RdpSettings.RecoveryWaitSeconds</c> between steps, and returns
    /// a fresh report describing the final state.
    /// </summary>
    Task<RdpReport> RecoverIfNeededAsync(RdpReport current, CancellationToken cancellationToken = default);
}