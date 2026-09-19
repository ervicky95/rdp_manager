namespace VickyVM.Agent.Security;

/// <summary>
/// The agent's identity credential, issued by the server during enrollment.
/// Contains the credential secret; callers must never log it.
/// </summary>
public sealed record StoredAgentCredential(string AgentId, string Credential);
