#define MyAppName "SmartHoreca ZKTeco Connector"
#define MyAppVersion "1.3.0"

#ifndef Runtime
  #define Runtime "win-x64"
#endif

#ifndef SourceDir
  #define SourceDir "..\\..\\..\\artifacts\\win-x64"
#endif

[Setup]
AppId={{9BC15D16-B85D-4B84-B72A-6D9D1D1E4A37}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=SmartHoreca
DefaultDirName={commonappdata}\\SmartHoreca\\ZKTecoConnector\\App
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=output
OutputBaseFilename=SmartHoreca-ZKTeco-Setup-{#Runtime}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\\SmartHoreca.ZKTeco.Tray.exe
VersionInfoVersion=1.3.0.0
VersionInfoCompany=SmartHoreca
VersionInfoDescription=SmartHoreca ZKTeco Connector Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

#if Runtime == "win-x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"

[Files]
Source: "{#SourceDir}\\SmartHoreca.ZKTeco.Connector.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\\SmartHoreca.ZKTeco.Tray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\\connector.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\SmartHoreca ZKTeco Monitor"; Filename: "{app}\\SmartHoreca.ZKTeco.Tray.exe"
Name: "{group}\\Папка данных SmartHoreca ZKTeco"; Filename: "{sys}\\explorer.exe"; Parameters: """{commonappdata}\\SmartHoreca\\ZKTecoConnector"""

[Registry]
; Remove the old per-user startup entry created by v1.2 PowerShell installer.
Root: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueName: "SmartHorecaZKTecoTray"; Flags: deletevalue
; Machine-wide startup makes the tray available for the interactive Windows user.
Root: HKLM; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "SmartHorecaZKTecoTray"; ValueData: """{app}\\SmartHoreca.ZKTeco.Tray.exe"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\\SmartHoreca.ZKTeco.Tray.exe"; Description: "Запустить монитор SmartHoreca ZKTeco"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\\sc.exe"; Parameters: "stop SmartHorecaZKTecoConnector"; Flags: runhidden; RunOnceId: "StopService"
Filename: "{sys}\\sc.exe"; Parameters: "delete SmartHorecaZKTecoConnector"; Flags: runhidden; RunOnceId: "DeleteService"
Filename: "{sys}\\netsh.exe"; Parameters: "http delete urlacl url=http://+:8088/"; Flags: runhidden; RunOnceId: "DeleteUrlAcl"
Filename: "{sys}\\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""SmartHoreca ZKTeco TA Push"""; Flags: runhidden; RunOnceId: "DeleteFirewall"

[Code]
const
  ServiceName = 'SmartHorecaZKTecoConnector';
  FirewallName = 'SmartHoreca ZKTeco TA Push';
  TaPushPort = '8088';

function RunHidden(const FileName, Params, StepName: string; IgnoreFailure: Boolean): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result and (ResultCode = 0) then
    exit;

  Result := False;
  if not IgnoreFailure then
  begin
    MsgBox(
      'Не удалось выполнить этап установки: ' + StepName + #13#10 +
      'Код ошибки: ' + IntToStr(ResultCode) + #13#10#13#10 +
      'Установщик запущен с правами администратора, поэтому повторите установку или отправьте этот код в поддержку.',
      mbError, MB_OK);
  end;
end;

procedure StopOldConnector;
begin
  RunHidden(ExpandConstant('{sys}\\sc.exe'), 'stop ' + ServiceName, 'Остановка старой службы', True);
  RunHidden(ExpandConstant('{sys}\\taskkill.exe'), '/F /IM SmartHoreca.ZKTeco.Connector.exe', 'Остановка старого Connector', True);
  RunHidden(ExpandConstant('{sys}\\taskkill.exe'), '/F /IM SmartHoreca.ZKTeco.Tray.exe', 'Остановка старого Tray', True);
  Sleep(700);
  RunHidden(ExpandConstant('{sys}\\sc.exe'), 'delete ' + ServiceName, 'Удаление старой службы', True);
  Sleep(700);
end;

procedure CreateInitialConfig;
var
  ConfigDir, ConfigFile: string;
begin
  ConfigDir := ExpandConstant('{commonappdata}\\SmartHoreca\\ZKTecoConnector');
  ConfigFile := ConfigDir + '\\connector.json';
  ForceDirectories(ConfigDir);

  if not FileExists(ConfigFile) then
  begin
    if not RunHidden(
      ExpandConstant('{app}\\SmartHoreca.ZKTeco.Connector.exe'),
      '--init',
      'Создание connector.json',
      False) then
      RaiseException('Не удалось создать первоначальную конфигурацию Connector.');
  end;
end;

procedure ConfigureHttpAndFirewall;
begin
  RunHidden(
    ExpandConstant('{sys}\\netsh.exe'),
    'http delete urlacl url=http://+:' + TaPushPort + '/',
    'Очистка старого URL ACL',
    True);

  if not RunHidden(
    ExpandConstant('{sys}\\netsh.exe'),
    'http add urlacl url=http://+:' + TaPushPort + '/ sddl=D:(A;;GX;;;SY)',
    'Разрешение локального TA Push порта ' + TaPushPort,
    False) then
    RaiseException('Не удалось настроить URL ACL.');

  RunHidden(
    ExpandConstant('{sys}\\netsh.exe'),
    'advfirewall firewall delete rule name="' + FirewallName + '"',
    'Очистка старого правила Firewall',
    True);

  if not RunHidden(
    ExpandConstant('{sys}\\netsh.exe'),
    'advfirewall firewall add rule name="' + FirewallName + '" dir=in action=allow protocol=TCP localport=' + TaPushPort + ' remoteip=localsubnet profile=private,domain',
    'Настройка Windows Firewall',
    False) then
    RaiseException('Не удалось настроить Windows Firewall.');
end;

procedure InstallAndStartService;
var
  ServiceExe, Params: string;
begin
  ServiceExe := ExpandConstant('{app}\\SmartHoreca.ZKTeco.Connector.exe');

  ; The installer path is fixed under ProgramData and contains no spaces,
  ; which keeps the Windows service ImagePath simple and reliable.
  Params :=
    'create ' + ServiceName +
    ' binPath= ' + ServiceExe +
    ' start= auto DisplayName= "SmartHoreca ZKTeco Connector"';

  if not RunHidden(
    ExpandConstant('{sys}\\sc.exe'),
    Params,
    'Создание Windows Service',
    False) then
    RaiseException('Не удалось создать Windows Service.');

  RunHidden(
    ExpandConstant('{sys}\\sc.exe'),
    'description ' + ServiceName + ' "Local offline-first ZKTeco attendance connector for SmartHoreca."',
    'Описание службы',
    True);

  RunHidden(
    ExpandConstant('{sys}\\sc.exe'),
    'failure ' + ServiceName + ' reset= 86400 actions= restart/5000/restart/15000/restart/60000',
    'Политика перезапуска службы',
    True);

  if not RunHidden(
    ExpandConstant('{sys}\\sc.exe'),
    'start ' + ServiceName,
    'Запуск SmartHoreca ZKTeco Connector',
    False) then
    RaiseException('Служба установлена, но не смогла запуститься.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopOldConnector;

  if CurStep = ssPostInstall then
  begin
    CreateInitialConfig;
    ConfigureHttpAndFirewall;
    InstallAndStartService;
  end;
end;
