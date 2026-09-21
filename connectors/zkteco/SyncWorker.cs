using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class SyncWorker : BackgroundService
{
    private readonly ConnectorConfig _config;
    private readonly EventQueue _queue;
    private readonly SmartHorecaClient _client;
    private readonly ConnectorStatusStore _status;
    private readonly ILogger<SyncWorker> _logger;
    private readonly Dictionary<string, int> _failures = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _nextAttempt = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _nextHeartbeat = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _nextPrune = DateTimeOffset.MinValue;

    public SyncWorker(ConnectorConfig config, EventQueue queue, SmartHorecaClient client, ConnectorStatusStore status, ILogger<SyncWorker> logger)
    {
        _config = config;
        _queue = queue;
        _client = client;
        _status = status;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("SmartHoreca cloud sync worker started. Data directory: {DataDirectory}", _config.DataDirectory);
        var devices = _config.Devices.Where(x => x.Enabled).ToList();

        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var device in devices)
            {
                if (!_nextHeartbeat.TryGetValue(device.Key, out var heartbeatAt) || heartbeatAt <= DateTimeOffset.UtcNow)
                {
                    var heartbeat = await _client.HeartbeatAsync(device, stoppingToken);
                    _nextHeartbeat[device.Key] = DateTimeOffset.UtcNow.AddSeconds(30);
                    if (heartbeat.Success) _status.MarkCloudSuccess();
                    else
                    {
                        _status.MarkCloudFailure(heartbeat.Error);
                        _logger.LogDebug("{Device}: heartbeat failed: {Error}", device.Name, heartbeat.Error);
                    }
                }

                if (_nextAttempt.TryGetValue(device.Key, out var next) && next > DateTimeOffset.UtcNow) continue;
                var batch = await _queue.GetPendingAsync(device.Key, _config.Queue.BatchSize, stoppingToken);
                if (batch.Count == 0) continue;

                var result = await _client.SendAsync(device, batch, stoppingToken);
                if (result.Success)
                {
                    _status.MarkCloudSuccess();
                    await _queue.MarkSentAsync(batch.Select(x => x.QueueId), stoppingToken);
                    _failures.Remove(device.Key);
                    _nextAttempt.Remove(device.Key);
                    _nextHeartbeat[device.Key] = DateTimeOffset.UtcNow.AddSeconds(30);
                    var remaining = await _queue.CountPendingAsync(stoppingToken);
                    _status.UpdatePending(remaining);
                    _logger.LogInformation("{Device}: uploaded {Count} event(s) to SmartHoreca. Pending locally: {Pending}.", device.Name, batch.Count, remaining);
                }
                else
                {
                    _status.MarkCloudFailure(result.Error);
                    await _queue.MarkFailureAsync(batch.Select(x => x.QueueId), result.Error, stoppingToken);
                    var failures = _failures.TryGetValue(device.Key, out var f) ? f + 1 : 1;
                    _failures[device.Key] = failures;
                    var delaySeconds = Math.Min(300, Math.Max(5, (int)Math.Pow(2, Math.Min(failures, 8))));
                    _nextAttempt[device.Key] = DateTimeOffset.UtcNow.AddSeconds(delaySeconds);
                    _logger.LogWarning("{Device}: cloud sync failed; local queue is preserved. Retry in {Delay}s. {Error}", device.Name, delaySeconds, result.Error);
                }
            }

            if (DateTimeOffset.UtcNow >= _nextPrune)
            {
                await _queue.PruneSentAsync(_config.Queue.RetentionDays, stoppingToken);
                _nextPrune = DateTimeOffset.UtcNow.AddHours(24);
            }

            await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_config.Server.SyncIntervalSeconds, 1, 60)), stoppingToken);
        }
    }
}
