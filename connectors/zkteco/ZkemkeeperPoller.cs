using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class ZkemkeeperPoller : BackgroundService
{
    private readonly ConnectorConfig _config;
    private readonly EventQueue _queue;
    private readonly ILogger<ZkemkeeperPoller> _logger;
    private readonly Dictionary<string, DateTimeOffset> _nextPoll = new(StringComparer.OrdinalIgnoreCase);

    public ZkemkeeperPoller(ConnectorConfig config, EventQueue queue, ILogger<ZkemkeeperPoller> logger)
    {
        _config = config;
        _queue = queue;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var devices = _config.Devices.Where(x => x.Enabled && x.Adapter == "ZKEMKEEPER").ToList();
        if (devices.Count == 0) return;

        if (!OperatingSystem.IsWindows())
        {
            _logger.LogError("ZKEMKEEPER adapter requires Windows.");
            return;
        }

        _logger.LogInformation("ZKEMKEEPER polling enabled for {Count} device(s).", devices.Count);
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var device in devices)
            {
                if (_nextPoll.TryGetValue(device.Key, out var next) && next > DateTimeOffset.UtcNow) continue;
                _nextPoll[device.Key] = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(device.PollSeconds, 10, 3600));

                try
                {
                    var imported = await PollDeviceAsync(device, stoppingToken);
                    _logger.LogInformation("{Device}: local SDK scan completed, {Imported} new event(s) queued.", device.Name, imported);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "{Device}: ZKTeco SDK poll failed.", device.Name);
                }
            }

            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }

    private async Task<int> PollDeviceAsync(DeviceOptions device, CancellationToken ct)
    {
        Type? comType = Type.GetTypeFromProgID("zkemkeeper.CZKEM") ?? Type.GetTypeFromProgID("zkemkeeper.CZKEMClass");
        if (comType is null)
            throw new InvalidOperationException("ZKTeco Standalone SDK (zkemkeeper) is not registered on this Windows PC. Install/register the vendor SDK or use TA_PUSH firmware.");

        dynamic? zk = null;
        var connected = false;
        var added = 0;
        try
        {
            zk = Activator.CreateInstance(comType) ?? throw new InvalidOperationException("Cannot create zkemkeeper COM object.");
            connected = zk.Connect_Net(device.IpAddress, device.Port);
            if (!connected) throw new InvalidOperationException($"Cannot connect to {device.IpAddress}:{device.Port}.");

            var machine = device.MachineNumber <= 0 ? 1 : device.MachineNumber;
            var serial = device.SerialNumber;
            try
            {
                string detectedSerial = "";
                if (zk.GetSerialNumber(machine, out detectedSerial) && !string.IsNullOrWhiteSpace(detectedSerial)) serial = detectedSerial.Trim();
            }
            catch { }
            if (string.IsNullOrWhiteSpace(serial)) serial = device.Key;

            if (!zk.ReadGeneralLogData(machine))
                throw new InvalidOperationException("ReadGeneralLogData returned false.");

            var minLocalTime = DateTime.Now.AddDays(-Math.Clamp(device.LookbackDays, 1, 3650));
            while (!ct.IsCancellationRequested)
            {
                string enrollNumber = "";
                int verifyMode = 0, inOutMode = 0, year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, workCode = 0;
                bool ok = zk.SSR_GetGeneralLogData(machine, out enrollNumber, out verifyMode, out inOutMode,
                    out year, out month, out day, out hour, out minute, out second, ref workCode);
                if (!ok) break;
                if (string.IsNullOrWhiteSpace(enrollNumber)) continue;

                DateTime local;
                try { local = new DateTime(year, month, day, hour, minute, second, DateTimeKind.Unspecified); }
                catch { continue; }
                if (local < minLocalTime) continue;

                var eventTime = EventTools.LocalTimestamp(local, _config.UtcOffsetMinutes);
                var eventType = EventTools.NormalizeDirection(inOutMode.ToString());
                var sourceId = EventTools.StableSourceId(serial, enrollNumber, eventTime, inOutMode.ToString(), verifyMode.ToString(), workCode.ToString());
                var raw = JsonSerializer.Serialize(new
                {
                    source = "ZKEMKEEPER",
                    device.Model,
                    serialNumber = serial,
                    device.IpAddress,
                    device.Port,
                    enrollNumber,
                    verifyMode,
                    inOutMode,
                    workCode,
                    localTime = local.ToString("yyyy-MM-dd HH:mm:ss")
                });

                if (await _queue.EnqueueAsync(new AttendanceEvent(
                        sourceId, device.Key, enrollNumber.Trim(), eventTime, eventType,
                        $"VERIFY_MODE_{verifyMode}", raw), ct))
                    added++;
            }

            return added;
        }
        finally
        {
            if (zk is not null)
            {
                if (connected)
                {
                    try { zk.Disconnect(); } catch { }
                }
                try
                {
                    if (Marshal.IsComObject(zk)) Marshal.FinalReleaseComObject(zk);
                }
                catch { }
            }
        }
    }
}
