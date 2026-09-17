param([int]$TaPushPort = 8088)

$serviceName = 'SmartHorecaZKTecoConnector'
& sc.exe stop $serviceName 2>$null | Out-Null
Start-Sleep -Seconds 1
& sc.exe delete $serviceName 2>$null | Out-Host
& netsh http delete urlacl url="http://+:$TaPushPort/" 2>$null | Out-Null
Write-Host 'SmartHoreca ZKTeco Connector service removed. Local queue/config files were not deleted.'
