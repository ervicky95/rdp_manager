using System;
using System.Collections.Generic;

namespace VickyVM.Agent.Models;

/// <summary>
/// Response to a successful lightweight poll. Carries only allowlisted
/// commands, not metrics.
/// </summary>
public sealed record PollResult(
    IReadOnlyList<AgentCommand> Commands,
    int PollIntervalSeconds,
    DateTimeOffset ServerTime);
