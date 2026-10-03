using System.Diagnostics;
using System.Text.Json;
using SmartHoreca.ZKTeco.Status;

namespace SmartHoreca.ZKTeco.Tray;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly string _dataDir;
    private readonly string _statusPath;
    private readonly NotifyIcon _notifyIcon;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ToolStripMenuItem _summaryItem;
    private StatusForm? _form;
    private TraySnapshot _snapshot = TraySnapshot.Empty;

    public TrayApplicationContext(string dataDir)
    {
        _dataDir = dataDir;
        _statusPath = Path.Combine(dataDir, "runtime-status.json");

        _summaryItem = new ToolStripMenuItem("Connector: ожидание данных") { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_summaryItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Открыть состояние", null, (_, _) => ShowStatus());
        menu.Items.Add("Открыть настройки", null, (_, _) => OpenFile(Path.Combine(_dataDir, "connector.json"), "notepad.exe"));
        menu.Items.Add("Открыть журнал", null, (_, _) => OpenFile(Path.Combine(_dataDir, "connector.log"), "notepad.exe"));
        menu.Items.Add("Открыть папку данных", null, (_, _) => OpenFolder());
        menu.Items.Add("Перезапустить службу", null, (_, _) => RestartService());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Закрыть значок", null, (_, _) => ExitTray());

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Warning,
            Text = "SmartHoreca ZKTeco",
            Visible = true,
            ContextMenuStrip = menu
        };
        _notifyIcon.DoubleClick += (_, _) => ShowStatus();

        _timer = new System.Windows.Forms.Timer { Interval = 2000 };
        _timer.Tick += (_, _) => RefreshState();
        _timer.Start();
        RefreshState();
    }

    private void RefreshState()
    {
        _snapshot = ReadSnapshot();
        var serviceOk = _snapshot.ServiceOnline;
        var cloudOk = serviceOk && _snapshot.Status?.CloudOnline == true;
        var devices = _snapshot.Status?.Devices ?? new List<DeviceRuntimeStatus>();
        var allDevicesOk = devices.Count == 0 || devices.All(x => x.Online);

        if (!serviceOk)
        {
            _notifyIcon.Icon = SystemIcons.Error;
            _summaryItem.Text = "Connector: служба не отвечает";
            _notifyIcon.Text = "SmartHoreca ZKTeco — Offline";
        }
        else if (!cloudOk || !allDevicesOk)
        {
            _notifyIcon.Icon = SystemIcons.Warning;
            _summaryItem.Text = $"Connector: внимание · очередь {_snapshot.Status!.PendingEvents}";
            _notifyIcon.Text = "SmartHoreca ZKTeco — требуется внимание";
        }
        else
        {
            _notifyIcon.Icon = SystemIcons.Information;
            _summaryItem.Text = $"Connector: работает · очередь {_snapshot.Status!.PendingEvents}";
            _notifyIcon.Text = "SmartHoreca ZKTeco — Online";
        }

        if (_form is { IsDisposed: false }) _form.UpdateState(_snapshot);
    }

    private TraySnapshot ReadSnapshot()
    {
        try
        {
            if (!File.Exists(_statusPath)) return new TraySnapshot(null, false, "Файл состояния ещё не создан.");
            var json = File.ReadAllText(_statusPath);
            var status = JsonSerializer.Deserialize<ConnectorRuntimeStatus>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (status is null) return new TraySnapshot(null, false, "Не удалось прочитать состояние Connector.");

            var fresh = DateTimeOffset.TryParse(status.GeneratedAt, out var generated) &&
                        DateTimeOffset.UtcNow - generated <= TimeSpan.FromSeconds(12);
            return new TraySnapshot(status, status.ServiceRunning && fresh, fresh ? "" : "Состояние устарело: служба, вероятно, остановлена.");
        }
        catch (Exception ex)
        {
            return new TraySnapshot(null, false, ex.Message);
        }
    }

    private void ShowStatus()
    {
        if (_form is null || _form.IsDisposed) _form = new StatusForm(_dataDir, RestartService);
        _form.UpdateState(_snapshot);
        _form.Show();
        _form.WindowState = FormWindowState.Normal;
        _form.BringToFront();
        _form.Activate();
    }

    private void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(_dataDir);
            Process.Start(new ProcessStartInfo("explorer.exe", _dataDir) { UseShellExecute = true });
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "SmartHoreca ZKTeco", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private static void OpenFile(string path, string editor)
    {
        try
        {
            if (!File.Exists(path))
            {
                MessageBox.Show($"Файл пока не создан:\n{path}", "SmartHoreca ZKTeco", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Process.Start(new ProcessStartInfo(editor, $"\"{path}\"") { UseShellExecute = true });
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "SmartHoreca ZKTeco", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private static void RestartService()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"Restart-Service -Name 'SmartHorecaZKTecoConnector' -Force\"",
                Verb = "runas",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch (System.ComponentModel.Win32Exception) { }
        catch (Exception ex) { MessageBox.Show(ex.Message, "SmartHoreca ZKTeco", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private void ExitTray()
    {
        _timer.Stop();
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _form?.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
            _notifyIcon.Dispose();
            _form?.Dispose();
        }
        base.Dispose(disposing);
    }
}

public sealed record TraySnapshot(ConnectorRuntimeStatus? Status, bool ServiceOnline, string Error)
{
    public static TraySnapshot Empty { get; } = new(null, false, "Ожидание состояния Connector.");
}
