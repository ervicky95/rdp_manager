using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using VickyVM.Agent.Models;
using VickyVM.Agent.Security;

namespace VickyVM.Agent.Http;

/// <summary>
/// Classifies a failed agent-server request so the service loop can decide
/// whether to keep its credential or re-enroll.
/// </summary>
public enum AgentHttpFailure
{
    /// <summary>No failure (the request succeeded).</summary>
    None,
    /// <summary>Server rejected the credential or token (401).</summary>
    Unauthorized,
    /// <summary>Network/timeout error; the server was unreachable.</summary>
    Network,
    /// <summary>Server responded with an error status (4xx/5xx).</summary>
    Server,
}

/// <summary>
/// A typed result that optionally carries parsed data and a failure reason.
/// </summary>
public sealed record AgentHttpResult<T>(T? Result, AgentHttpFailure Failure)
{
    public bool IsSuccess => Failure == AgentHttpFailure.None && Result is not null;
    public bool IsUnauthorized => Failure == AgentHttpFailure.Unauthorized;
}

/// <summary>
/// Information the agent reports to the server at enrollment.
/// </summary>
public sealed record AgentEnrollmentInfo(string MachineId, string Hostname, string AgentVersion);

/// <summary>
/// Outbound HTTPS client for agent-server communication.
///
/// Design contract: outbound HTTPS only. The agent never listens on a port and
/// never initiates inbound connections; all communication flows from the agent
/// to the management server over HTTPS. Enrollment tokens and the returned
/// credential are never written to logs.
/// </summary>
public interface IAgentHttpClient : IDisposable
{
    /// <summary>Gets or sets the base server URL (HTTPS in production).</summary>
    string BaseUrl { get; set; }

    /// <summary>Sends a lightweight outbound HTTPS ping to the health endpoint.</summary>
    Task<bool> PingAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Enrolls with a single-use token. On success returns the issued credential.
    /// A 401 means the token was invalid or expired.
    /// </summary>
    Task<AgentHttpResult<EnrollmentResult>> EnrollAsync(
        string enrollmentToken,
        AgentEnrollmentInfo info,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Polls the server with the agent credential, reporting compact events and
    /// receiving allowlisted commands. A 401 means the credential was revoked —
    /// the caller should drop it and re-enroll.
    /// </summary>
    Task<AgentHttpResult<PollResult>> PollAsync(
        StoredAgentCredential credential,
        IReadOnlyList<AgentEvent> events,
        CancellationToken cancellationToken = default);
}
