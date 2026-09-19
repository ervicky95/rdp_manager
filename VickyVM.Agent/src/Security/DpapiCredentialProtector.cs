using System;
using System.Security.Cryptography;

namespace VickyVM.Agent.Security;

/// <summary>
/// DPAPI credential protection scoped to the current user (the service runs
/// as LocalSystem, so the credential is bound to that account). Windows-only;
/// on other operating systems the Operations call throws
/// PlatformNotSupportedException.
/// </summary>
public sealed class DpapiCredentialProtector : ICredentialProtector
{
    public byte[] Protect(byte[] payload)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("DPAPI credential protection is only available on Windows.");
        return ProtectedData.Protect(payload, null, DataProtectionScope.CurrentUser);
    }

    public byte[] Unprotect(byte[] protectedData)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("DPAPI credential protection is only available on Windows.");
        return ProtectedData.Unprotect(protectedData, null, DataProtectionScope.CurrentUser);
    }
}
