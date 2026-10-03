namespace SmartHoreca.ZKTeco.Tray;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var dataDir = ResolveDataDirectory(args);
        Application.Run(new TrayApplicationContext(dataDir));
    }

    private static string ResolveDataDirectory(string[] args)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--data-dir", StringComparison.OrdinalIgnoreCase))
                return Path.GetFullPath(args[i + 1]);
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "SmartHoreca",
            "ZKTecoConnector");
    }
}
