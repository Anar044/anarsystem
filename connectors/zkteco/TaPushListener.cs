using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class TaPushListener : BackgroundService
{
    private readonly ConnectorConfig _config;
    private readonly EventQueue _queue;
    private readonly ILogger<TaPushListener> _logger;
    private readonly Dictionary<string, DeviceOptions> _bySerial;
    private HttpListener? _listener;

    public TaPushListener(ConnectorConfig config, EventQueue queue, ILogger<TaPushListener> logger)
    {
        _config = config;
        _queue = queue;
        _logger = logger;
        _bySerial = config.Devices
            .Where(x => x.Enabled && x.Adapter == "TA_PUSH")
            .ToDictionary(x => x.SerialNumber, x => x, StringComparer.OrdinalIgnoreCase);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_bySerial.Count == 0) return;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://+:{_config.TaPushListenPort}/");
                _listener.Start();
                _logger.LogInformation("Local ZKTeco TA Push listener started on port {Port} for {Count} device(s).",
                    _config.TaPushListenPort, _bySerial.Count);

                while (!stoppingToken.IsCancellationRequested && _listener.IsListening)
                {
                    var context = await _listener.GetContextAsync().WaitAsync(stoppingToken);
                    _ = Task.Run(() => HandleAsync(context, stoppingToken), CancellationToken.None);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "TA Push listener failed. It will retry in 30 seconds. Check URL ACL/firewall settings for port {Port}.", _config.TaPushListenPort);
                try { _listener?.Close(); } catch { }
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        try { _listener?.Close(); } catch { }
        return base.StopAsync(cancellationToken);
    }

    private async Task HandleAsync(HttpListenerContext context, CancellationToken ct)
    {
        try
        {
            var request = context.Request;
            var path = request.Url?.AbsolutePath?.TrimEnd('/').ToLowerInvariant() ?? "";
            var serial = (request.QueryString["SN"] ?? request.QueryString["sn"] ?? "").Trim();

            if (string.IsNullOrWhiteSpace(serial) || !_bySerial.TryGetValue(serial, out var device))
            {
                _logger.LogWarning("TA Push request from unknown serial '{Serial}' ({Remote}).", serial, request.RemoteEndPoint);
                await WriteAsync(context.Response, 403, "UNKNOWN DEVICE");
                return;
            }

            if (!IsExpectedLanAddress(device, request.RemoteEndPoint?.Address))
            {
                _logger.LogWarning("TA Push request for {Device} rejected from unexpected IP {Remote}.", device.Name, request.RemoteEndPoint?.Address);
                await WriteAsync(context.Response, 403, "UNEXPECTED SOURCE");
                return;
            }

            if (path.EndsWith("/iclock/cdata", StringComparison.Ordinal))
            {
                if (string.Equals(request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(request.QueryString["options"], "all", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteAsync(context.Response, 200, BuildOptions(serial));
                    return;
                }

                var table = (request.QueryString["table"] ?? "").Trim().ToUpperInvariant();
                string body;
                using (var reader = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8, true, 4096, leaveOpen: false))
                    body = await reader.ReadToEndAsync(ct);

                var accepted = 0;
                if (table == "ATTLOG" || string.IsNullOrWhiteSpace(table))
                    accepted = await ParseAttendanceAsync(device, serial, table, body, request.Url?.Query ?? "", ct);

                await WriteAsync(context.Response, 200, $"OK: {accepted}");
                return;
            }

            await WriteAsync(context.Response, 200, "OK");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TA Push request processing failed.");
            try { await WriteAsync(context.Response, 500, "ERROR"); } catch { }
        }
    }

    private static bool IsExpectedLanAddress(DeviceOptions device, IPAddress? remote)
    {
        if (remote is null || string.IsNullOrWhiteSpace(device.IpAddress)) return true;
        if (!IPAddress.TryParse(device.IpAddress, out var expected)) return true;
        if (expected.AddressFamily != remote.AddressFamily)
        {
            try { return expected.MapToIPv4().Equals(remote.MapToIPv4()); } catch { return false; }
        }
        return expected.Equals(remote);
    }

    private async Task<int> ParseAttendanceAsync(DeviceOptions device, string serial, string table, string body, string query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body)) return 0;
        var accepted = 0;
        var lines = body.Replace("\r\n", "\n").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var line in lines)
        {
            var parts = line.Split('\t');
            if (parts.Length < 2) continue;
            var pin = parts[0].Trim();
            var localTime = parts[1].Trim();
            if (string.IsNullOrWhiteSpace(pin) || !EventTools.TryParseDeviceLocalTime(localTime, _config.UtcOffsetMinutes, out var eventTime))
            {
                _logger.LogWarning("{Device}: cannot parse TA Push ATTLOG line: {Line}", device.Name, line);
                continue;
            }

            var status = parts.Length > 2 ? parts[2].Trim() : "";
            var verify = parts.Length > 3 ? parts[3].Trim() : "";
            var workCode = parts.Length > 4 ? parts[4].Trim() : "";
            var eventType = EventTools.NormalizeDirection(status);
            var sourceId = EventTools.StableSourceId(serial, pin, eventTime, status, verify, workCode, line);
            var raw = JsonSerializer.Serialize(new
            {
                source = "TA_PUSH",
                device.Model,
                serialNumber = serial,
                table,
                pin,
                localTime,
                status,
                verify,
                workCode,
                rawLine = line,
                query
            });

            if (await _queue.EnqueueAsync(new AttendanceEvent(
                    sourceId, device.Key, pin, eventTime, eventType,
                    string.IsNullOrWhiteSpace(verify) ? "" : $"VERIFY_MODE_{verify}", raw), ct))
                accepted++;
        }

        if (accepted > 0)
            _logger.LogInformation("{Device}: received {Accepted} new attendance event(s) over local TA Push.", device.Name, accepted);
        return accepted;
    }

    private static string BuildOptions(string serial) => string.Join("\r\n", new[]
    {
        $"GET OPTION FROM: {serial}",
        "Stamp=0",
        "OpStamp=0",
        "PhotoStamp=0",
        "ErrorDelay=60",
        "Delay=10",
        "TransTimes=00:00;14:05",
        "TransInterval=1",
        "TransFlag=1111000000",
        "Realtime=1",
        "Encrypt=0",
        ""
    });

    private static async Task WriteAsync(HttpListenerResponse response, int statusCode, string text)
    {
        if (response.OutputStream.CanWrite)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            response.StatusCode = statusCode;
            response.ContentType = "text/plain; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            await response.OutputStream.WriteAsync(bytes);
        }
        response.Close();
    }
}
