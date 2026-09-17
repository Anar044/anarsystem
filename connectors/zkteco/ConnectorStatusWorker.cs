using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class ConnectorStatusWorker : BackgroundService
{
    private readonly ConnectorStatusStore _status;
    private readonly EventQueue _queue;
    private readonly ILogger<ConnectorStatusWorker> _logger;

    public ConnectorStatusWorker(ConnectorStatusStore status, EventQueue queue, ILogger<ConnectorStatusWorker> logger)
    {
        _status = status;
        _queue = queue;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    _status.UpdatePending(await _queue.CountPendingAsync(stoppingToken));
                    await _status.WriteAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Cannot write connector runtime status.");
                }

                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }
        finally
        {
            _status.MarkStopped();
            try { await _status.WriteAsync(CancellationToken.None); } catch { }
        }
    }
}
