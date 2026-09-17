namespace SmartHoreca.ZKTeco.Status;

public sealed class ConnectorRuntimeStatus
{
    public string ConnectorVersion { get; set; } = "";
    public bool ServiceRunning { get; set; }
    public string GeneratedAt { get; set; } = "";
    public string ServiceStartedAt { get; set; } = "";
    public bool CloudOnline { get; set; }
    public string LastCloudSuccessAt { get; set; } = "";
    public string LastCloudError { get; set; } = "";
    public long PendingEvents { get; set; }
    public List<DeviceRuntimeStatus> Devices { get; set; } = new();
}

public sealed class DeviceRuntimeStatus
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Model { get; set; } = "";
    public string Adapter { get; set; } = "";
    public string IpAddress { get; set; } = "";
    public int Port { get; set; }
    public string SerialNumber { get; set; } = "";
    public bool Online { get; set; }
    public string LastSeenAt { get; set; } = "";
    public string LastEventAt { get; set; } = "";
    public string LastError { get; set; } = "";
}
