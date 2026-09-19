using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Security;
using VickyVM.Agent.Tests.TestHelpers;
using Xunit;

namespace VickyVM.Agent.Tests.Security;

public class CredentialStoreTests : IClassFixture<TempDirectoryFixture>
{
    private readonly string _dir;

    public CredentialStoreTests(TempDirectoryFixture fixture)
    {
        _dir = Path.Combine(fixture.TempPath, Guid.NewGuid().ToString("N")[..8]);
    }

    private static ILogger<CredentialStore> Logger => LoggerFactory
        .Create(b => b.SetMinimumLevel(LogLevel.Debug))
        .CreateLogger<CredentialStore>();

    private CredentialStore CreateStore(ICredentialProtector protector)
        => new(new AgentSettings { DataDirectory = _dir }, protector, Logger);

    private CredentialStore CreateStore()
        => CreateStore(new DevFileCredentialProtector());

    [Fact]
    public async Task SaveThenLoad_RoundTrips_Credential()
    {
        // Arrange
        var store = CreateStore();
        var credential = new StoredAgentCredential("ag_abc", "dv-secret-abc-0000000000000000000000");

        // Act
        await store.SaveAsync(credential);

        // Assert
        var loaded = await store.LoadAsync();
        loaded.Should().NotBeNull();
        loaded!.AgentId.Should().Be(credential.AgentId);
        loaded.Credential.Should().Be(credential.Credential);
    }

    [Fact]
    public async Task Load_ReturnsNull_WhenNoCredentialExists()
    {
        // Arrange
        var store = CreateStore();

        // Act & Assert
        (await store.LoadAsync()).Should().BeNull();
    }

    [Fact]
    public async Task Load_ReturnsNull_WhenStoredBytesAreCorrupt()
    {
        // Arrange
        var store = CreateStore();
        await store.SaveAsync(new StoredAgentCredential("ag_a", "credential-a"));
        await File.WriteAllBytesAsync(Path.Combine(_dir, "agent-credential.bin"), Encoding.UTF8.GetBytes("not json"));

        // Act & Assert - a corrupt store must degrade to "not enrolled"
        (await store.LoadAsync()).Should().BeNull();
    }

    [Fact]
    public async Task Delete_Removes_Credential()
    {
        // Arrange
        var store = CreateStore();
        await store.SaveAsync(new StoredAgentCredential("ag_a", "credential-a"));

        // Act
        await store.DeleteAsync();

        // Assert
        (await store.LoadAsync()).Should().BeNull();
        File.Exists(Path.Combine(_dir, "agent-credential.bin")).Should().BeFalse();
    }
}
