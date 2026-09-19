using System;
using System.Text.Json.Serialization;

namespace VickyVM.Agent.Models;

/// <summary>
/// A compact event the agent reports to the server during a poll. The payloads
/// are intentionally tiny and allowlisted: they never carry CPU/RAM/disk/RDP
/// metrics or any sensitive credentials. Serialized to the server in snake_case.
/// </summary>
public sealed record AgentEvent(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("command_id")] string? CommandId = null,
    [property: JsonPropertyName("result")] string? Result = null,
    [property: JsonPropertyName("at")] DateTimeOffset At = default)
{
    public DateTimeOffset OccurredAt => At == default ? DateTimeOffset.UtcNow : At;
}
