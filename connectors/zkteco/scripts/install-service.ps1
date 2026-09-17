param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [string]$ConfigPath = "$env:ProgramData\SmartHoreca\ZKTecoConnector\connector.json",
  [int]$TaPushPort = 8088
)

$ErrorActionPreference = 'Stop'
$serviceName = 'SmartHorecaZKTecoConnector'
$exe = (Resolve-Path $ExePath).Path
$configDir = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

if (-not (Test-Path $ConfigPath)) {
  & $exe --init --config $ConfigPath
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

# LocalSystem is allowed to bind the listener. Ignore an already-existing reservation.
& netsh http delete urlacl url="http://+:$TaPushPort/" 2>$null | Out-Null
& netsh http add urlacl url="http://+:$TaPushPort/" user="NT AUTHORITY\SYSTEM" | Out-Host

Write-Host "Service installed: $serviceName"
Write-Host "Config: $ConfigPath"
Write-Host "TA Push listener port: $TaPushPort"
Write-Host 'After editing connector.json, run:'
Write-Host "  sc.exe start $serviceName"
