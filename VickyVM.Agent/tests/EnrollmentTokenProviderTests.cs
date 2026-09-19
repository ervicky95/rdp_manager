using System.IO;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Services;
using VickyVM.Agent.Tests.TestHelpers;
using Xunit;

namespace VickyVM.Agent.Tests.Services;

public class EnrollmentTokenProviderTests : IClassFixture<TempDirectoryFixture>
{
    private readonly string _dir;

    public EnrollmentTokenProviderTests(TempDirectoryFixture fixture)
    {
        _dir = Path.Combine(fixture.TempPath, Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_dir);
    }

    private static ILogger<EnrollmentTokenProvider> Logger => LoggerFactory
        .Create(b => b.SetMinimumLevel(LogLevel.Debug))
        .CreateLogger<EnrollmentTokenProvider>();

    private EnrollmentTokenProvider CreateProvider(string path)
        => new(new AgentSettings { EnrollmentTokenPath = path }, Logger);

    [Fact]
    public async Task GetToken_ReadsFile_AndTrims()
    {
        // Arrange
        var path = Path.Combine(_dir, "enrollment.token");
        await File.WriteAllTextAsync(path, "  token-123456  ");

        // Act
        var token = await CreateProvider(path).GetTokenAsync();

        // Assert
        token.Should().Be("token-123456");
    }

    [Fact]
    public async Task GetToken_ReturnsNull_WhenFileMissingOrEmpty()
    {
        // Arrange
        var missing = Path.Combine(_dir, "missing.token");
        var empty = Path.Combine(_dir, "empty.token");
        await File.WriteAllTextAsync(empty, "   ");

        // Act & Assert
        (await CreateProvider(missing).GetTokenAsync()).Should().BeNull();
        (await CreateProvider(empty).GetTokenAsync()).Should().BeNull();
    }

    [Fact]
    public async Task Clear_DeletesTokenFile()
    {
        // Arrange
        var path = Path.Combine(_dir, "enrollment.token");
        await File.WriteAllTextAsync(path, "token-123456");
        var provider = CreateProvider(path);

        // Act
        await provider.ClearAsync();

        // Assert - the single-use token is gone after enrollment
        File.Exists(path).Should().BeFalse();
    }
}
