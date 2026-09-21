using System.Diagnostics;
using SmartHoreca.ZKTeco.Status;

namespace SmartHoreca.ZKTeco.Tray;

public sealed class StatusForm : Form
{
    private readonly string _dataDir;
    private readonly Action _restartService;
    private readonly Label _service = new();
    private readonly Label _cloud = new();
    private readonly Label _queue = new();
    private readonly Label _version = new();
    private readonly Label _message = new();
    private readonly DataGridView _devices = new();

    public StatusForm(string dataDir, Action restartService)
    {
        _dataDir = dataDir;
        _restartService = restartService;

        Text = "SmartHoreca ZKTeco Connector";
        Width = 820;
        Height = 480;
        MinimumSize = new Size(700, 400);
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = true;

        var top = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 95,
            ColumnCount = 2,
            RowCount = 3,
            Padding = new Padding(12)
        };
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        ConfigureHeaderLabel(_service);
        ConfigureHeaderLabel(_cloud);
        ConfigureHeaderLabel(_queue);
        ConfigureHeaderLabel(_version);
        _message.AutoSize = true;
        _message.Dock = DockStyle.Fill;
        _message.ForeColor = SystemColors.GrayText;
        top.Controls.Add(_service, 0, 0);
        top.Controls.Add(_cloud, 1, 0);
        top.Controls.Add(_queue, 0, 1);
        top.Controls.Add(_version, 1, 1);
        top.Controls.Add(_message, 0, 2);
        top.SetColumnSpan(_message, 2);

        _devices.Dock = DockStyle.Fill;
        _devices.ReadOnly = true;
        _devices.AllowUserToAddRows = false;
        _devices.AllowUserToDeleteRows = false;
        _devices.AllowUserToResizeRows = false;
        _devices.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _devices.RowHeadersVisible = false;
        _devices.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _devices.Columns.Add("status", "Статус");
        _devices.Columns.Add("name", "Устройство");
        _devices.Columns.Add("model", "Модель");
        _devices.Columns.Add("connection", "Подключение");
        _devices.Columns.Add("lastSeen", "Последняя связь");
        _devices.Columns.Add("lastEvent", "Последняя отметка");

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 52,
            FlowDirection = FlowDirection.LeftToRight,
            Padding = new Padding(10)
        };
        buttons.Controls.Add(MakeButton("Папка данных", (_, _) => OpenFolder()));
        buttons.Controls.Add(MakeButton("Настройки", (_, _) => OpenFile("connector.json")));
        buttons.Controls.Add(MakeButton("Журнал", (_, _) => OpenFile("connector.log")));
        buttons.Controls.Add(MakeButton("Перезапустить службу", (_, _) => _restartService()));
        buttons.Controls.Add(MakeButton("Скрыть", (_, _) => Hide()));

        Controls.Add(_devices);
        Controls.Add(top);
        Controls.Add(buttons);

        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };
    }

    public void UpdateState(TraySnapshot snapshot)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => UpdateState(snapshot));
            return;
        }

        var status = snapshot.Status;
        _service.Text = snapshot.ServiceOnline ? "● Служба: работает" : "● Служба: offline";
        _cloud.Text = snapshot.ServiceOnline && status?.CloudOnline == true ? "● SmartHoreca Cloud: online" : "● SmartHoreca Cloud: offline";
        _queue.Text = $"Локальная очередь: {status?.PendingEvents ?? 0}";
        _version.Text = $"Версия Connector: {status?.ConnectorVersion ?? "—"}";
        _message.Text = !string.IsNullOrWhiteSpace(snapshot.Error)
            ? snapshot.Error
            : !string.IsNullOrWhiteSpace(status?.LastCloudError)
                ? "Cloud: " + status.LastCloudError
                : "Все события сначала сохраняются локально и затем синхронизируются с SmartHoreca.";

        _devices.Rows.Clear();
        if (status is null) return;

        foreach (var device in status.Devices)
        {
            var connection = device.Adapter == "TA_PUSH"
                ? $"TA Push · {device.IpAddress}:{device.Port}"
                : $"SDK · {device.IpAddress}:{device.Port}";
            var state = snapshot.ServiceOnline && device.Online ? "Online" : "Offline";
            if (!string.IsNullOrWhiteSpace(device.LastError)) state += " · ошибка";

            _devices.Rows.Add(
                state,
                device.Name,
                device.Model,
                connection,
                FormatTime(device.LastSeenAt),
                FormatTime(device.LastEventAt));
        }
    }

    private static void ConfigureHeaderLabel(Label label)
    {
        label.AutoSize = true;
        label.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 10, FontStyle.Bold);
        label.Dock = DockStyle.Fill;
    }

    private static Button MakeButton(string text, EventHandler click)
    {
        var button = new Button { Text = text, AutoSize = true, Height = 30 };
        button.Click += click;
        return button;
    }

    private void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(_dataDir);
            Process.Start(new ProcessStartInfo("explorer.exe", _dataDir) { UseShellExecute = true });
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private void OpenFile(string fileName)
    {
        var path = Path.Combine(_dataDir, fileName);
        if (!File.Exists(path))
        {
            MessageBox.Show($"Файл пока не создан:\n{path}", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        try { Process.Start(new ProcessStartInfo("notepad.exe", $"\"{path}\"") { UseShellExecute = true }); }
        catch (Exception ex) { MessageBox.Show(ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private static string FormatTime(string value)
    {
        return DateTimeOffset.TryParse(value, out var time) ? time.ToLocalTime().ToString("dd.MM.yyyy HH:mm:ss") : "—";
    }
}
