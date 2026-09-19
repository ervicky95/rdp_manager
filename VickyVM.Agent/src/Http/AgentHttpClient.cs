using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;
using VickyVM.Agent.Models;
using VickyVM.Agent.Security;

namespace VickyVM.Agent.Http;

/// <summary>
/// Outbound HTTPS client for agent-server communication.
/// All traffic targets the configured management server. Enrollment tokens and
/// agent credentials are never written to logs. On 401 the caller is told the
/// credential/token is invalid so it can react (re-enroll) rather than retry.
/// </summary>
public sealed class AgentHttpClient : IAgentHttpClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _httpClient;
    private readonly ILogger<AgentHttpClient> _logger;
    private readonly AgentSettings _settings;
    private bool _disposed;

    public AgentHttpClient(
        HttpClient httpClient,
        ILogger<AgentHttpClient> logger,
        IOptions<AgentConfiguration> config)
    {
        _httpClient = httpClient;
        _logger = logger;
        _settings = config.Value.Agent;

        BaseUrl = _settings.ServerUrl;

        _httpClient.Timeout = TimeSpan.FromSeconds(_settings.RequestTimeoutSeconds);
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("VickyVM.Agent/1.0");
        _httpClient.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    }

    public string BaseUrl
    {
        get => _httpClient.BaseAddress?.ToString() ?? _settings.ServerUrl;
        set => _httpClient.BaseAddress = new Uri(value.TrimEnd('/') + "/");
    }

    public async Task<bool> PingAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _httpClient.GetAsync("health", cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Ping to server failed");
            return false;
        }
    }

    public async Task<AgentHttpResult<EnrollmentResult>> EnrollAsync(
        string enrollmentToken,
        AgentEnrollmentInfo info,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/agent/enroll");
        request.Headers.Add("X-VickyVM-Enrollment-Token", enrollmentToken);

        var body = JsonSerializer.SerializeToUtf8Bytes(new
        {
            machine_id = info.MachineId,
            hostname = info.Hostname,
            agent_version = info.AgentVersion,
        });
        request.Content = new ByteArrayContent(body);
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");

        try
        {
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var payload = await ReadJsonAsync<EnrollPayload>(response, cancellationToken);
                if (payload is null || string.IsNullOrEmpty(payload.AgentId) || string.IsNullOrEmpty(payload.Credential))
                {
                    _logger.LogWarning("Enrollment response was malformed");
                    return new AgentHttpResult<EnrollmentResult>(null, AgentHttpFailure.Server);
                }
                return new AgentHttpResult<EnrollmentResult>(
                    new EnrollmentResult(payload.AgentId, payload.Credential, Math.Max(1, payload.PollIntervalSeconds)),
                    AgentHttpFailure.None);
            }

            if ((int)response.StatusCode == 401)
                return new AgentHttpResult<EnrollmentResult>(null, AgentHttpFailure.Unauthorized);

            _logger.LogWarning("Enrollment failed with HTTP {Status}", (int)response.StatusCode);
            return new AgentHttpResult<EnrollmentResult>(null, AgentHttpFailure.Server);
        }
        catch (OperationCanceledException)
        {
            return new AgentHttpResult<EnrollmentResult>(null, cancellationToken.IsCancellationRequested
                ? AgentHttpFailure.Network
                : AgentHttpFailure.Network);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Enrollment request failed");
            return new AgentHttpResult<EnrollmentResult>(null, AgentHttpFailure.Network);
        }
    }

    public async Task<AgentHttpResult<PollResult>> PollAsync(
        StoredAgentCredential credential,
        IReadOnlyList<AgentEvent> events,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/agent/poll");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", $"{credential.AgentId}:{credential.Credential}");

        var body = JsonSerializer.SerializeToUtf8Bytes(new PollPayload(events));
        request.Content = new ByteArrayContent(body);
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");

        try
        {
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var payload = await ReadJsonAsync<PollResponsePayload>(response, cancellationToken);
                if (payload is null)
                {
                    _logger.LogWarning("Poll response was malformed");
                    return new AgentHttpResult<PollResult>(null, AgentHttpFailure.Server);
                }
                var commands = new List<AgentCommand>();
                if (payload.Commands is not null)
                {
                    foreach (var c in payload.Commands)
                    {
                        if (string.IsNullOrEmpty(c.Id) || string.IsNullOrEmpty(c.Command)) continue;
                        var created = ParseIso(c.CreatedAt) ?? DateTimeOffset.UtcNow;
                        commands.Add(new AgentCommand(c.Id, c.Command, created));
                    }
                }
                var poll = new PollResult(commands, Math.Max(1, payload.PollIntervalSeconds), DateTimeOffset.UtcNow);
                return new AgentHttpResult<PollResult>(poll, AgentHttpFailure.None);
            }

            if ((int)response.StatusCode == 401)
                return new AgentHttpResult<PollResult>(null, AgentHttpFailure.Unauthorized);

            _logger.LogWarning("Poll failed with HTTP {Status}", (int)response.StatusCode);
            return new AgentHttpResult<PollResult>(null, AgentHttpFailure.Server);
        }
        catch (OperationCanceledException)
        {
            return new AgentHttpResult<PollResult>(null, AgentHttpFailure.Network);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Poll request failed");
            return new AgentHttpResult<PollResult>(null, AgentHttpFailure.Network);
        }
    }

    private sealed class EnrollPayload
    {
        [System.Text.Json.Serialization.JsonPropertyName("agent_id")]
        public string? AgentId { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("credential")]
        public string? Credential { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("poll_interval_seconds")]
        public int PollIntervalSeconds { get; set; } = 60;
    }

    private sealed record PollPayload(IReadOnlyList<AgentEvent> Events);

    private sealed class PollResponsePayload
    {
        public List<PollCommandPayload>? Commands { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("poll_interval_seconds")]
        public int PollIntervalSeconds { get; set; } = 60;
    }

    private sealed class PollCommandPayload
    {
        public string? Id { get; set; }
        public string? Command { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("created_at")]
        public string? CreatedAt { get; set; }
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var stream = await response.Content.ReadAsStreamAsync(ct);
            return await JsonSerializer.DeserializeAsync<T>(stream, JsonOpts, ct);
        }
        catch (Exception ex)
        {
            // Malformed or empty body; caller decides how to classify.
            _ = ex;
            return default;
        }
    }

    private static DateTimeOffset? ParseIso(string? value)
        => DateTimeOffset.TryParse(value, out var dto) ? dto : null;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _httpClient.Dispose();
    }
}
