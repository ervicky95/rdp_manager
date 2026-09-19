using System.Threading;
using System.Threading.Tasks;
using VickyVM.Agent.Models;

namespace VickyVM.Agent.Health;

/// <summary>
/// Interface for system health monitoring.
///
/// Local monitoring covers CPU, RAM, disk, and RDP. Report reads are
/// read-only observation: the monitor never kills processes, never closes
/// applications, and never stops unrelated services. RDP checks are
/// non-authenticating (no RDP login required); manual Get Status performs a
/// fresh RDP check, and an explicit RDP check can run recovery.
/// </summary>
public interface IHealthMonitor
{
    /// <summary>
    /// Gets a fresh local resource report (CPU/RAM/disk + top processes).
    /// When <paramref name="includeRdp"/> is true a fresh, non-authenticating
    /// RDP check is also performed. Never runs RDP recovery.
    /// </summary>
    Task<HealthReport> GetHealthReportAsync(bool includeRdp = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// Performs a fresh local RDP check. When <paramref name="recoverIfUnhealthy"/>
    /// is true and RDP is confirmed unhealthy, runs the safe RDP recovery sequence.
    /// </summary>
    Task<RdpReport> CheckRdpAsync(bool recoverIfUnhealthy = false, CancellationToken cancellationToken = default);
}