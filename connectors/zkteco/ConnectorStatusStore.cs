using System.Text.Json;
using SmartHoreca.ZKTeco.Status;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class ConnectorStatusStore
{
    public const string ConnectorVersion = "1.3.0";

    private readonly object _gate = new();
    private readonly string _statusPath;
    private readonly string _startedAt = DateTimeOffset.UtcNow.ToString("O");
    private readonly Dictionary<string, DeviceRuntimeStatus> _devices = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, int> _freshSeconds = new(StringComparer.OrdinalIgnoreCase);
    private bool _serviceRunning = true;
    private bool _cloudOnline;
    private string _lastCloudSuccessAt = "";
    private string _lastCloudError = "";
    private long _pendingEvents;

    public ConnectorStatusStore(ConnectorConfig config)
    {
        _statusPath = Path.Combine(config.DataDirectory, "runtime-status.json");
        foreach (var device in config.Devices.Where(x => x.Enabled))
        {
            _devices[device.Key] = new DeviceRuntimeStatus
            {
                Key = device.Key,
                Name = device.Name,
                Model = device.Model,
                Adapter = device.Adapter,
                IpAddress = device.IpAddress,
                Port = device.Port,
                SerialNumber = device.SerialNumber
            };

            _freshSeconds[device.Key] = device.Adapter == "ZKEMKEEPER"
                ? Math.Clamp(device.PollSeconds * 3, 45, 600)
                : 180;
        }
    }

    public void MarkCloudSuccess()
    {
        lock (_gate)
        {
            _cloudOnline = true;
            _lastCloudSuccessAt = DateTimeOffset.UtcNow.ToString("O");
            _lastCloudError = "";
        }
    }

    public void MarkCloudFailure(string? error)
    {
        lock (_gate)
        {
            _cloudOnline = false;
            _lastCloudError = Trim(error, 500);
        }
    }

    public void MarkDeviceSeen(string key)
    {
        lock (_gate)
        {
            if (!_devices.TryGetValue(key, out var device)) return;
            device.LastSeenAt = DateTimeOffset.UtcNow.ToString("O");
            device.LastError = "";
        }
    }

    public void MarkDeviceEvent(string key)
    {
        lock (_gate)
        {
            if (!_devices.TryGetValue(key, out var device)) return;
            var now = DateTimeOffset.UtcNow.ToString("O");
            device.LastSeenAt = now;
            device.LastEventAt = now;
            device.LastError = "";
        }
    }

    public void MarkDeviceError(string key, string? error)
    {
        lock (_gate)
        {
            if (!_devices.TryGetValue(key, out var device)) return;
            device.LastError = Trim(error, 500);
        }
    }

    public void UpdatePending(long count)
    {
        lock (_gate) _pendingEvents = Math.Max(0, count);
    }

    public void MarkStopped()
    {
        lock (_gate) _serviceRunning = false;
    }

    public ConnectorRuntimeStatus Snapshot()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            var devices = _devices.Values.Select(x =>
            {
                var copy = new DeviceRuntimeStatus
                {
                    Key = x.Key,
                    Name = x.Name,
                    Model = x.Model,
                    Adapter = x.Adapter,
                    IpAddress = x.IpAddress,
                    Port = x.Port,
                    SerialNumber = x.SerialNumber,
                    LastSeenAt = x.LastSeenAt,
                    LastEventAt = x.LastEventAt,
                    LastError = x.LastError
                };

                copy.Online = DateTimeOffset.TryParse(x.LastSeenAt, out var seen) &&
                              (now - seen) <= TimeSpan.FromSeconds(_freshSeconds.TryGetValue(x.Key, out var seconds) ? seconds : 180);
                return copy;
            }).OrderBy(x => x.Name).ToList();

            return new ConnectorRuntimeStatus
            {
                ConnectorVersion = ConnectorVersion,
                ServiceRunning = _serviceRunning,
                GeneratedAt = now.ToString("O"),
                ServiceStartedAt = _startedAt,
                CloudOnline = _cloudOnline,
                LastCloudSuccessAt = _lastCloudSuccessAt,
                LastCloudError = _lastCloudError,
                PendingEvents = _pendingEvents,
                Devices = devices
            };
        }
    }

    public async Task WriteAsync(CancellationToken ct)
    {
        var status = Snapshot();
        var json = JsonSerializer.Serialize(status, new JsonSerializerOptions { WriteIndented = true });
        Directory.CreateDirectory(Path.GetDirectoryName(_statusPath)!);
        var temp = _statusPath + ".tmp";
        await File.WriteAllTextAsync(temp, json, ct);
        File.Move(temp, _statusPath, overwrite: true);
    }

    private static string Trim(string? value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length <= max ? text : text[..max];
    }
}
