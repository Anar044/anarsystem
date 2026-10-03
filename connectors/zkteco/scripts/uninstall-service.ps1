param([int]$TaPushPort = 8088)

$serviceName = 'SmartHorecaZKTecoConnector'
$firewallName = 'SmartHoreca ZKTeco TA Push'

Get-Process 'SmartHoreca.ZKTeco.Tray' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'SmartHorecaZKTecoTray' -ErrorAction SilentlyContinue

& sc.exe stop $serviceName 2>$null | Out-Null
Start-Sleep -Seconds 1
& sc.exe delete $serviceName 2>$null | Out-Host
& netsh http delete urlacl url="http://+:$TaPushPort/" 2>$null | Out-Null
& netsh advfirewall firewall delete rule name="$firewallName" 2>$null | Out-Null
Write-Host 'SmartHoreca ZKTeco Connector service and tray autostart removed. Local queue/config/log files were not deleted.'
