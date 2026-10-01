$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
docker compose down
Write-Host "SmartHoreca Local Document AI ostanovlen." -ForegroundColor Green
