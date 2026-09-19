namespace VickyVM.Agent.Models;

/// <summary>
/// Result of a successful enrollment. The credential secret is returned to the
/// agent exactly once and must never be logged.
/// </summary>
public sealed record EnrollmentResult(
    string AgentId,
    string Credential,
    int PollIntervalSeconds);
