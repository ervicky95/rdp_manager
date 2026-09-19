using System;

namespace VickyVM.Agent.Security;

/// <summary>
/// <b>Development-only</b> credential protection for platforms without DPAPI
/// (macOS/Linux builds and CI). Provides no real encryption — it exists solely
/// so the agent builds and its logic can be unit-tested cross-platform.
///
/// Production agent runs on Windows always use <see cref="DpapiCredentialProtector"/>.
/// </summary>
public sealed class DevFileCredentialProtector : ICredentialProtector
{
    public byte[] Protect(byte[] payload) => payload;

    public byte[] Unprotect(byte[] protectedData) => protectedData;
}
