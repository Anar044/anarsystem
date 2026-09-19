using System.Text.Json;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class ConnectorRuntime
{
    public ConnectorRuntime(string configPath) => ConfigPath = configPath;
    public string ConfigPath { get; }
}

public static class AppPaths
{
    public static string DefaultDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "SmartHoreca",
        "ZKTecoConnector");

    public static string ResolveConfigPath(string[] args)
    {
        var env = Environment.GetEnvironmentVariable("SH_ZK_CONFIG");
        if (!string.IsNullOrWhiteSpace(env)) return Path.GetFullPath(env);

        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--config", StringComparison.OrdinalIgnoreCase))
                return Path.GetFullPath(args[i + 1]);
        }

        return Path.Combine(DefaultDataDirectory, "connector.json");
    }
}

public sealed class ConnectorConfig
{
    public ServerOptions Server { get; set; } = new();
    public QueueOptions Queue { get; set; } = new();
    public int TaPushListenPort { get; set; } = 8088;
    public int UtcOffsetMinutes { get; set; } = 240;
    public string DataDirectory { get; set; } = "";
    public List<DeviceOptions> Devices { get; set; } = new();

    public void NormalizeAndValidate()
    {
        if (string.IsNullOrWhiteSpace(DataDirectory)) DataDirectory = AppPaths.DefaultDataDirectory;
        DataDirectory = Path.GetFullPath(DataDirectory);
        Directory.CreateDirectory(DataDirectory);

        Server.BaseUrl = (Server.BaseUrl ?? "").Trim().TrimEnd('/');
        Server.IngestPath = string.IsNullOrWhiteSpace(Server.IngestPath)
            ? "/api/hr/device-ingest"
            : "/" + Server.IngestPath.Trim().TrimStart('/');

        if (!Uri.TryCreate(Server.BaseUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Server.BaseUrl must be an absolute http/https URL.");

        if (TaPushListenPort is < 1 or > 65535)
            throw new InvalidOperationException("TaPushListenPort must be between 1 and 65535.");

        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var serials = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var device in Devices)
        {
            device.Key = (device.Key ?? "").Trim();
            device.Name = (device.Name ?? "").Trim();
            device.Model = (device.Model ?? "").Trim();
            device.Adapter = (device.Adapter ?? "").Trim().ToUpperInvariant();
            device.IpAddress = (device.IpAddress ?? "").Trim();
            device.SerialNumber = (device.SerialNumber ?? "").Trim();
            device.DeviceToken = (device.DeviceToken ?? "").Trim();

            if (!device.Enabled) continue;
            if (string.IsNullOrWhiteSpace(device.Key)) throw new InvalidOperationException("Every enabled device needs Key.");
            if (!keys.Add(device.Key)) throw new InvalidOperationException($"Duplicate device Key: {device.Key}");
            if (string.IsNullOrWhiteSpace(device.DeviceToken)) throw new InvalidOperationException($"Device {device.Key} has no DeviceToken.");

            if (device.Adapter == "ZKEMKEEPER")
            {
                if (string.IsNullOrWhiteSpace(device.IpAddress)) throw new InvalidOperationException($"Device {device.Key} has no IpAddress.");
                if (device.Port is < 1 or > 65535) throw new InvalidOperationException($"Device {device.Key} has invalid Port.");
            }
            else if (device.Adapter == "TA_PUSH")
            {
                if (string.IsNullOrWhiteSpace(device.SerialNumber)) throw new InvalidOperationException($"TA_PUSH device {device.Key} needs SerialNumber.");
                if (!serials.Add(device.SerialNumber)) throw new InvalidOperationException($"Duplicate SerialNumber: {device.SerialNumber}");
            }
            else
            {
                throw new InvalidOperationException($"Unsupported Adapter '{device.Adapter}' for device {device.Key}. Use ZKEMKEEPER or TA_PUSH.");
            }
        }
    }
}

public sealed class ServerOptions
{
    public string BaseUrl { get; set; } = "https://YOUR-SMARTHORECA-DOMAIN";
    public string IngestPath { get; set; } = "/api/hr/device-ingest";
    public int TimeoutSeconds { get; set; } = 30;
    public int SyncIntervalSeconds { get; set; } = 5;
}

public sealed class QueueOptions
{
    public int BatchSize { get; set; } = 200;
    public int RetentionDays { get; set; } = 90;
}

public sealed class DeviceOptions
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Model { get; set; } = "";
    public string Adapter { get; set; } = "TA_PUSH";
    public string IpAddress { get; set; } = "";
    public int Port { get; set; } = 4370;
    public string SerialNumber { get; set; } = "";
    public int MachineNumber { get; set; } = 1;
    public int PollSeconds { get; set; } = 60;
    public int LookbackDays { get; set; } = 90;
    public string DeviceToken { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public static class ConfigFile
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public static ConnectorConfig Load(string path)
    {
        var json = File.ReadAllText(path);
        var config = JsonSerializer.Deserialize<ConnectorConfig>(json, JsonOptions)
                     ?? throw new InvalidOperationException("Configuration is empty.");
        config.NormalizeAndValidate();
        return config;
    }

    public static void WriteTemplate(string path, bool overwrite)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? AppPaths.DefaultDataDirectory);
        if (File.Exists(path) && !overwrite) return;

        var template = new ConnectorConfig
        {
            Server = new ServerOptions
            {
                BaseUrl = "https://YOUR-SMARTHORECA-DOMAIN",
                IngestPath = "/api/hr/device-ingest",
                TimeoutSeconds = 30,
                SyncIntervalSeconds = 5
            },
            Queue = new QueueOptions { BatchSize = 200, RetentionDays = 90 },
            TaPushListenPort = 8088,
            UtcOffsetMinutes = 240,
            Devices = new List<DeviceOptions>
            {
                new()
                {
                    Key = "main-entrance",
                    Name = "Main entrance",
                    Model = "SenseFace 3A",
                    Adapter = "TA_PUSH",
                    SerialNumber = "PUT_DEVICE_SERIAL_HERE",
                    IpAddress = "192.168.1.150",
                    Port = 4370,
                    DeviceToken = "PUT_SMARTHORECA_DEVICE_TOKEN_HERE"
                }
            }
        };

        File.WriteAllText(path, JsonSerializer.Serialize(template, JsonOptions));
    }
}
