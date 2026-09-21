using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class SmartHorecaClient
{
    private const string ConnectorVersion = ConnectorStatusStore.ConnectorVersion;
    private readonly ConnectorConfig _config;
    private readonly HttpClient _http;
    private readonly ILogger<SmartHorecaClient> _logger;

    public SmartHorecaClient(ConnectorConfig config, HttpClient http, ILogger<SmartHorecaClient> logger)
    {
        _config = config;
        _http = http;
        _logger = logger;
    }

    public async Task<SendResult> HeartbeatAsync(DeviceOptions device, CancellationToken ct)
    {
        var payload = new
        {
            heartbeat = true,
            connectorVersion = ConnectorVersion,
            device = new
            {
                key = device.Key,
                name = device.Name,
                model = device.Model,
                adapter = device.Adapter,
                ipAddress = device.IpAddress,
                port = device.Port,
                serialNumber = device.SerialNumber
            }
        };
        return await PostAsync(device, payload, ct, expectEventCounts: false);
    }

    public async Task<SendResult> SendAsync(DeviceOptions device, IReadOnlyCollection<QueuedAttendanceEvent> batch, CancellationToken ct)
    {
        if (batch.Count == 0) return new SendResult(true, "");

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
                connectorVersion = ConnectorVersion,
                rawDevicePayload = x.RawJson
            })
        };
        return await PostAsync(device, payload, ct, expectEventCounts: true, fallbackReceived: batch.Count);
    }

    private async Task<SendResult> PostAsync(DeviceOptions device, object payload, CancellationToken ct, bool expectEventCounts, int fallbackReceived = 0)
    {
        var endpoint = new Uri(new Uri(_config.Server.BaseUrl.TrimEnd('/') + "/"), _config.Server.IngestPath.TrimStart('/'));
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", device.DeviceToken);
        request.Headers.TryAddWithoutValidation("X-SH-Connector-Version", ConnectorVersion);
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
            if (!success) return new SendResult(false, $"Server rejected the request: {text}");
            if (!expectEventCounts) return new SendResult(true, "");

            var invalid = root.TryGetProperty("invalid", out var invalidNode) && invalidNode.TryGetInt32(out var i) ? i : 0;
            var received = root.TryGetProperty("received", out var receivedNode) && receivedNode.TryGetInt32(out var r) ? r : fallbackReceived;
            if (invalid > 0) return new SendResult(false, $"Server marked {invalid} event(s) invalid: {text}", received, invalid);
            return new SendResult(true, "", received, invalid);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new SendResult(false, "SmartHoreca request timed out.");
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "SmartHoreca request failed for {DeviceKey}", device.Key);
            return new SendResult(false, ex.Message);
        }
    }
}
