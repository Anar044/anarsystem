param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [string]$ConfigPath = "$env:ProgramData\SmartHoreca\ZKTecoConnector\connector.json",
  [int]$TaPushPort = 8088
)

$ErrorActionPreference = 'Stop'
$serviceName = 'SmartHorecaZKTecoConnector'
$firewallName = 'SmartHoreca ZKTeco TA Push'
$exe = (Resolve-Path $ExePath).Path
$installDir = Split-Path -Parent $exe
$trayExe = Join-Path $installDir 'SmartHoreca.ZKTeco.Tray.exe'
$configDir = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$createdConfig = $false
if (-not (Test-Path $ConfigPath)) {
  & $exe --init --config $ConfigPath
  $createdConfig = $true
  Write-Host "Configuration template created: $ConfigPath"
  Write-Host 'Edit the configuration before starting the service.'
}

& sc.exe stop $serviceName 2>$null | Out-Null
& sc.exe delete $serviceName 2>$null | Out-Null
Start-Sleep -Seconds 1

$binPath = '"' + $exe + '" --config "' + $ConfigPath + '"'
& sc.exe create $serviceName binPath= $binPath start= auto DisplayName= 'SmartHoreca ZKTeco Connector' | Out-Host
& sc.exe description $serviceName 'Local offline-first ZKTeco attendance connector for SmartHoreca.' | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

& netsh http delete urlacl url="http://+:$TaPushPort/" 2>$null | Out-Null
& netsh http add urlacl url="http://+:$TaPushPort/" user="NT AUTHORITY\SYSTEM" | Out-Host

& netsh advfirewall firewall delete rule name="$firewallName" 2>$null | Out-Null
& netsh advfirewall firewall add rule name="$firewallName" dir=in action=allow protocol=TCP localport=$TaPushPort remoteip=localsubnet profile=private,domain | Out-Host

if (Test-Path $trayExe) {
  New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force | Out-Null
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'SmartHorecaZKTecoTray' -Value ('"' + $trayExe + '"')
  Start-Process $trayExe
  Write-Host "Tray monitor installed for current Windows user: $trayExe"
}

Write-Host "Service installed: $serviceName"
Write-Host "Config: $ConfigPath"
Write-Host "TA Push listener port: $TaPushPort"

if (-not $createdConfig) {
  & sc.exe start $serviceName | Out-Host
  Write-Host 'Service started.'
} else {
  Write-Host 'After editing connector.json, run:'
  Write-Host "  sc.exe start $serviceName"
}
