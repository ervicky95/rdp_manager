using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Http;
using VickyVM.Agent.Security;
using Xunit;

namespace VickyVM.Agent.Tests.Http;

public class AgentHttpClientTests
{
    private static IOptions<AgentConfiguration> TestConfig
    {
        get
        {
            var agentConfig = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.Test.json", optional: false)
                .Build()
                .Get<AgentConfiguration>() ?? new AgentConfiguration();
            return Options.Create(agentConfig);
        }
    }

    private static ILogger<AgentHttpClient> Logger => LoggerFactory
        .Create(b => b.SetMinimumLevel(LogLevel.Debug))
        .CreateLogger<AgentHttpClient>();

    private sealed class FakeHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Responder { get; set; } =
            _ => new HttpResponseMessage(HttpStatusCode.OK);

        public HttpRequestMessage? LastRequest { get; private set; }
        public string? LastRequestBody { get; private set; }
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastRequest = request;
            CallCount++;
            if (request.Content is not null)
            {
                LastRequestBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }
            var response = Responder(request);
            response.RequestMessage = request;
            return response;
        }
    }

    [Fact]
    public async Task PingAsync_UsesConfiguredBaseUrl()
    {
        // Arrange
        using var handler = new FakeHandler();
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var result = await client.PingAsync();

        // Assert - outbound GET to https://test.example.com/health
        result.Should().BeTrue();
        handler.CallCount.Should().Be(1);
        handler.LastRequest!.RequestUri!.Scheme.Should().Be("https");
        handler.LastRequest.RequestUri.Host.Should().Be("test.example.com");
        handler.LastRequest.RequestUri.AbsolutePath.Should().Be("/health");
        handler.LastRequest.Method.Should().Be(HttpMethod.Get);
    }

    [Fact]
    public async Task PingAsync_ReturnsFalse_OnServerError()
    {
        // Arrange
        using var handler = new FakeHandler { Responder = _ => new HttpResponseMessage(HttpStatusCode.InternalServerError) };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var result = await client.PingAsync();

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_ReturnsFalse_OnNetworkFailure()
    {
        // Arrange
        using var handler = new FakeHandler
        {
            Responder = _ => throw new HttpRequestException("connection refused")
        };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var result = await client.PingAsync();

        // Assert - never throws, never crashes the service loop
        result.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_ReturnsFalse_WhenCancelled()
    {
        // Arrange
        using var handler = new FakeHandler();
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act
        var result = await client.PingAsync(cts.Token);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void Client_SetsUserAgentAndAcceptsJson()
    {
        // Arrange
        using var handler = new FakeHandler();
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Assert
        httpClient.DefaultRequestHeaders.UserAgent.ToString().Should().Contain("VickyVM.Agent");
        httpClient.DefaultRequestHeaders.Accept.ToString().Should().Contain("application/json");
    }

    [Fact]
    public void Client_AppliesTimeout_FromConfiguration()
    {
        // Arrange
        using var handler = new FakeHandler();
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Assert - RequestTimeoutSeconds=10 from appsettings.Test.json
        httpClient.Timeout.Should().Be(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public void BaseUrl_NormalizesTrailingSlash()
    {
        // Arrange
        using var handler = new FakeHandler();
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        client.BaseUrl = "https://other.example.com/";

        // Assert
        client.BaseUrl.Should().Be("https://other.example.com/");
        httpClient.BaseAddress!.ToString().Should().Be("https://other.example.com/");
    }

    [Fact]
    public async Task EnrollAsync_SendsTokenAndParsesCredential()
    {
        // Arrange
        using var handler = new FakeHandler
        {
            Responder = _ => JsonResponse(new
            {
                agent_id = "ag_issued",
                credential = "dv-secret-issued-000000000000000000000000",
                poll_interval_seconds = 45,
            })
        };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var outcome = await client.EnrollAsync("tok-single-use-123", new AgentEnrollmentInfo("machine-1", "host-1", "1.2.3"));

        // Assert - the token is sent as a dedicated header and the credential parsed
        outcome.IsSuccess.Should().BeTrue();
        outcome.Result!.AgentId.Should().Be("ag_issued");
        outcome.Result.Credential.Should().Be("dv-secret-issued-000000000000000000000000");
        outcome.Result.PollIntervalSeconds.Should().Be(45);

        handler.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/agent/enroll");
        handler.LastRequest.Method.Should().Be(HttpMethod.Post);
        handler.LastRequest.Headers.GetValues("X-VickyVM-Enrollment-Token").Should().ContainSingle(t => t == "tok-single-use-123");
    }

    [Fact]
    public async Task EnrollAsync_ReturnsUnauthorized_On401()
    {
        // Arrange
        using var handler = new FakeHandler { Responder = _ => new HttpResponseMessage(HttpStatusCode.Unauthorized) };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var outcome = await client.EnrollAsync("bad-token", new AgentEnrollmentInfo("m", "h", "1.0"));

        // Assert - invalid/expired token is surfaced so the agent can re-enroll
        outcome.IsUnauthorized.Should().BeTrue();
        outcome.Result.Should().BeNull();
    }

    [Fact]
    public async Task EnrollAsync_ReturnsNetwork_OnFailure()
    {
        // Arrange
        using var handler = new FakeHandler { Responder = _ => throw new HttpRequestException("offline") };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var outcome = await client.EnrollAsync("tok", new AgentEnrollmentInfo("m", "h", "1.0"));

        // Assert - never throws; classifies as a network failure
        outcome.Failure.Should().Be(AgentHttpFailure.Network);
        outcome.Result.Should().BeNull();
    }

    [Fact]
    public async Task PollAsync_SendsAuthAndEventsAndParsesCommands()
    {
        // Arrange
        using var handler = new FakeHandler
        {
            Responder = _ => JsonResponse(new
            {
                commands = new[]
                {
                    new { id = "cmd-1", command = "restart", created_at = "2026-09-19T10:00:00Z" },
                    new { id = "cmd-2", command = "shutdown", created_at = "2026-09-19T10:01:00Z" },
                },
                poll_interval_seconds = 60,
            })
        };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);
        var credential = new StoredAgentCredential("ag_polling", "dv-secret-polling-00000000000000000000");
        var events = new[] { new Models.AgentEvent("heartbeat"), new Models.AgentEvent("command_acknowledged", CommandId: "cmd-0") };

        // Act
        var outcome = await client.PollAsync(credential, events);

        // Assert - auth header carries id:credential; body carried the compact events
        outcome.IsSuccess.Should().BeTrue();
        outcome.Result!.Commands.Should().HaveCount(2);
        outcome.Result.Commands[0].Id.Should().Be("cmd-1");
        outcome.Result.Commands[1].Command.Should().Be("shutdown");
        outcome.Result.PollIntervalSeconds.Should().Be(60);

        handler.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/agent/poll");
        handler.LastRequest.Headers.Authorization!.Scheme.Should().Be("Bearer");
        handler.LastRequest.Headers.Authorization.Parameter!.Should().Be("ag_polling:dv-secret-polling-00000000000000000000");

        // The body must contain the reported event types as JSON.
        var body = handler.LastRequestBody;
        body.Should().NotBeNull();
        body!.Should().Contain("heartbeat");
        body.Should().Contain("command_acknowledged");
        body.Should().Contain("cmd-0");
    }

    [Fact]
    public async Task PollAsync_ReturnsUnauthorized_On401()
    {
        // Arrange
        using var handler = new FakeHandler { Responder = _ => new HttpResponseMessage(HttpStatusCode.Unauthorized) };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var outcome = await client.PollAsync(new StoredAgentCredential("ag_x", "secret"), Array.Empty<Models.AgentEvent>());

        // Assert - a rejected credential must be surfaced for re-enrollment
        outcome.IsUnauthorized.Should().BeTrue();
    }

    [Fact]
    public async Task PollAsync_ReturnsNetwork_OnFailure()
    {
        // Arrange
        using var handler = new FakeHandler { Responder = _ => throw new HttpRequestException("timeout") };
        using var httpClient = new HttpClient(handler);
        using var client = new AgentHttpClient(httpClient, Logger, TestConfig);

        // Act
        var outcome = await client.PollAsync(new StoredAgentCredential("ag_x", "secret"), Array.Empty<Models.AgentEvent>());

        // Assert - never throws; classifies as a network failure
        outcome.Failure.Should().Be(AgentHttpFailure.Network);
    }

    private static HttpResponseMessage JsonResponse(object payload)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };
    }
}