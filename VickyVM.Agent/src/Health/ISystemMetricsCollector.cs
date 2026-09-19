using System.Threading;
using System.Threading.Tasks;

namespace VickyVM.Agent.Health;

/// <summary>
/// Collects local resource metrics. Implementations must never modify
/// workloads: metrics collection is read-only observation.
/// </summary>
public interface ISystemMetricsCollector
{
    /// <summary>
    /// Returns a snapshot of CPU/RAM/disk usage plus top processes. Fields that
    /// cannot be measured on the current platform are null-costing (null values
    /// or empty lists), never sentinel values.
    /// </summary>
    Task<ResourceMetrics> CollectAsync(CancellationToken cancellationToken = default);
}