namespace VickyVM.Agent.Models;

/// <summary>
/// A single local process sample used for top-CPU and top-RAM reporting.
/// The agent only records these; it never kills or modifies processes.
/// </summary>
public sealed record ProcessSample(string ProcessName, int ProcessId, double CpuPercent, long MemoryMb);