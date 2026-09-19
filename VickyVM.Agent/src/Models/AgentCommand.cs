using System;

namespace VickyVM.Agent.Models;

/// <summary>
/// An allowlisted command the server has queued for this agent. Only the
/// project's approved commands are ever delivered; execution is a later-phase
/// concern. Phase 4 acknowledges receipt via compact events.
/// </summary>
public sealed record AgentCommand(string Id, string Command, DateTimeOffset CreatedAt);
