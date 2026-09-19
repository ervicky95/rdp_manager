namespace VickyVM.Agent.Security;

/// <summary>
/// Protects credential bytes at rest. On Windows this is DPAPI
/// (user-scoped); other platforms use a development-only fallback so the
/// agent can be built and tested cross-platform.
/// </summary>
public interface ICredentialProtector
{
    /// <summary>Protects (encrypts) the payload.</summary>
    byte[] Protect(byte[] payload);

    /// <summary>Unprotects (decrypts) previously protected bytes.</summary>
    byte[] Unprotect(byte[] protectedData);
}
