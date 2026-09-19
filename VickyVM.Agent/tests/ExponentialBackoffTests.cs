using System;
using FluentAssertions;
using VickyVM.Agent.Services;
using Xunit;

namespace VickyVM.Agent.Tests.Services;

public class ExponentialBackoffTests
{
    [Fact]
    public void Delays_GrowExponentially_UpToCap()
    {
        // Arrange - base 2s, cap 10s
        var backoff = new ExponentialBackoff(2, 10);

        // Act
        var d1 = backoff.NextDelay();
        var d2 = backoff.NextDelay();
        var d3 = backoff.NextDelay();
        var d4 = backoff.NextDelay();
        var d5 = backoff.NextDelay();

        // Assert - 2, 4, 8, 10 (capped), 10 (stays capped)
        d1.Should().Be(TimeSpan.FromSeconds(2));
        d2.Should().Be(TimeSpan.FromSeconds(4));
        d3.Should().Be(TimeSpan.FromSeconds(8));
        d4.Should().Be(TimeSpan.FromSeconds(10));
        d5.Should().Be(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public void Reset_RestartsAtBaseDelay()
    {
        // Arrange
        var backoff = new ExponentialBackoff(1, 60);
        _ = backoff.NextDelay(); // 1s
        _ = backoff.NextDelay(); // 2s

        // Act
        backoff.Reset();
        var again = backoff.NextDelay();

        // Assert
        again.Should().Be(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void BaseAndMax_AreClamped()
    {
        // Arrange & Act - base below minimum is raised to 1s
        var backoff = new ExponentialBackoff(0, 0);

        var first = backoff.NextDelay();

        // Assert
        first.Should().Be(TimeSpan.FromSeconds(1));
    }
}
