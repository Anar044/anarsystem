using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SmartHoreca.ZKTeco.Connector;

var configPath = AppPaths.ResolveConfigPath(args);

if (args.Any(x => string.Equals(x, "--init", StringComparison.OrdinalIgnoreCase)))
{
    ConfigFile.WriteTemplate(configPath, overwrite: false);
    Console.WriteLine($"Configuration template: {configPath}");
    return;
}

if (!File.Exists(configPath))
{
    ConfigFile.WriteTemplate(configPath, overwrite: false);
    Console.Error.WriteLine($"Connector configuration was not found. A template was created at: {configPath}");
    Console.Error.WriteLine("Edit the file and start the connector again.");
    Environment.ExitCode = 2;
    return;
}

ConnectorConfig config;
try
{
    config = ConfigFile.Load(configPath);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Invalid connector configuration: {ex.Message}");
    Environment.ExitCode = 3;
    return;
}

var logPath = Path.Combine(config.DataDirectory, "connector.log");
var builder = Host.CreateDefaultBuilder(args)
    .UseWindowsService(options => options.ServiceName = "SmartHoreca ZKTeco Connector")
    .ConfigureLogging(logging =>
    {
        logging.SetMinimumLevel(LogLevel.Information);
        logging.AddProvider(new SimpleFileLoggerProvider(logPath));
    })
    .ConfigureServices(services =>
    {
        services.AddSingleton(config);
        services.AddSingleton(new ConnectorRuntime(configPath));
        services.AddSingleton<EventQueue>();
        services.AddSingleton<ConnectorStatusStore>();
        services.AddSingleton(new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(Math.Clamp(config.Server.TimeoutSeconds, 5, 120))
        });
        services.AddSingleton<SmartHorecaClient>();
        services.AddHostedService<ZkemkeeperPoller>();
        services.AddHostedService<TaPushListener>();
        services.AddHostedService<SyncWorker>();
        services.AddHostedService<ConnectorStatusWorker>();
    });

await builder.Build().RunAsync();
