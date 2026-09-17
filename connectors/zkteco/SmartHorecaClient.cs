using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class SmartHorecaClient
{
    private readonly ConnectorConfig _config;
    private readonly HttpClient _http;
    private readonly ILogger<SmartHorecaClient> _logger;

    public SmartHorecaClient(ConnectorConfig config, HttpClient http, ILogger<SmartHorecaClient> logger)
    {
        _config = config;
        _http = http;
        _logger = logger;
    }

    public async Task<SendResult> SendAsync(DeviceOptions device, IReadOnlyCollection<QueuedAttendanceEvent> batch, CancellationToken ct)
    {
        if (batch.Count == 0) return new SendResult(true, "");

        var endpoint = new Uri(new Uri(_config.Server.BaseUrl.TrimEnd('/') + "/"), _config.Server.IngestPath.TrimStart('/'));
        var payload = new
        {
            events = batch.Select(x => new
            {
                externalEmployeeId = x.ExternalEmployeeId,
                eventTime = x.EventTime,
                eventType = x.EventType,
                sourceId = x.SourceId,
                verifyMethod = x.VerifyMethod,
                deviceModel = device.Model,
                deviceKey = device.Key,
                connector = "SmartHoreca.ZKTeco.Connector",
                rawDevicePayload = x.RawJson
            })
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", device.DeviceToken);
        request.Headers.TryAddWithoutValidation("X-SH-Connector-Version", "1.0.0");
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
                return new SendResult(false, $"HTTP {(int)response.StatusCode}: {text}");

            using var json = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
            var root = json.RootElement;
            var success = root.TryGetProperty("success", out var successNode) && successNode.ValueKind == JsonValueKind.True;
            var invalid = root.TryGetProperty("invalid", out var invalidNode) && invalidNode.TryGetInt32(out var i) ? i : 0;
            var received = root.TryGetProperty("received", out var receivedNode) && receivedNode.TryGetInt32(out var r) ? r : batch.Count;

            if (!success) return new SendResult(false, $"Server rejected the batch: {text}", received, invalid);
            if (invalid > 0) return new SendResult(false, $"Server marked {invalid} event(s) invalid: {text}", received, invalid);
            return new SendResult(true, "", received, invalid);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new SendResult(false, "SmartHoreca request timed out.");
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "SmartHoreca ingest request failed for {DeviceKey}", device.Key);
            return new SendResult(false, ex.Message);
        }
    }
}
