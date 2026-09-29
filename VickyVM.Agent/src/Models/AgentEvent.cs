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
    [property: JsonPropertyName("at")] DateTimeOffset At = default,
    // Status report metric fields (sent only on explicit get_status/rdp_check completion)
    [property: JsonPropertyName("cpu_percent")] double? CpuPercent = null,
    [property: JsonPropertyName("ram_percent")] double? RamPercent = null,
    [property: JsonPropertyName("disk_percent")] double? DiskPercent = null,
    [property: JsonPropertyName("windows_version")] string? WindowsVersion = null,
    [property: JsonPropertyName("agent_version")] string? AgentVersion = null,
    [property: JsonPropertyName("uptime_seconds")] long? UptimeSeconds = null,
    [property: JsonPropertyName("rdp_status")] string? RdpStatus = null)
{
    public DateTimeOffset OccurredAt => At == default ? DateTimeOffset.UtcNow : At;
}
