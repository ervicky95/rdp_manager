using System;

namespace VickyVM.Agent.Services;

/// <summary>
/// Exponential backoff with a capped delay. Used to retry enrollment and to
/// reconnect after network or server failures without hammering the server.
/// Delays follow base * 2^attempt, clamped to a maximum.
/// </summary>
public sealed class ExponentialBackoff
{
    private readonly int _baseSeconds;
    private readonly int _maxSeconds;
    private long _attempts;

    public ExponentialBackoff(int baseSeconds, int maxSeconds)
    {
        _baseSeconds = Math.Max(1, baseSeconds);
        _maxSeconds = Math.Max(_baseSeconds, maxSeconds);
    }

    /// <summary>Returns the next delay, growing until the cap is reached.</summary>
    public TimeSpan NextDelay()
    {
        var attempt = _attempts++;
        if (attempt > 30) attempt = 30;
        var secondsPowers = Math.Pow(2d, attempt);
        var seconds = _baseSeconds * secondsPowers;
        var capped = Math.Min(seconds, _maxSeconds);
        return TimeSpan.FromSeconds(Math.Max(1, capped));
    }

    /// <summary>Resets backoff after a successful operation.</summary>
    public void Reset() => _attempts = 0;

    public long Attempts => _attempts;
}
