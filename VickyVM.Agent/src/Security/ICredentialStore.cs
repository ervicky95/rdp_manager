using System.Threading;
using System.Threading.Tasks;

namespace VickyVM.Agent.Security;

/// <summary>
/// Persists the agent credential so the service can re-authenticate after a
/// restart without re-running the installer. Implementations protect the
/// credential at rest; never log its contents.
/// </summary>
public interface ICredentialStore
{
    /// <summary>
    /// Loads the stored credential, or <c>null</c> when the agent is not
    /// enrolled yet (or the stored value could not be recovered).
    /// </summary>
    Task<StoredAgentCredential?> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Stores the credential at rest.</summary>
    Task SaveAsync(StoredAgentCredential credential, CancellationToken cancellationToken = default);

    /// <summary>Removes the stored credential (used on re-enrollment).</summary>
    Task DeleteAsync(CancellationToken cancellationToken = default);
}
