$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20+ не найден. Установите Node.js и повторите запуск.'
}

if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Создан .env из шаблона.' -ForegroundColor Yellow
}

if (-not (Test-Path 'devices.json')) {
    Copy-Item 'devices.json.example' 'devices.json'
    Write-Host 'Создан devices.json из шаблона.' -ForegroundColor Yellow
}

Write-Host 'SmartHoreca ZKTeco Connector' -ForegroundColor Cyan
Write-Host ('Node: ' + (node --version))
Write-Host 'Health после запуска: http://127.0.0.1:8081/health'
Write-Host 'Status: http://127.0.0.1:8081/api/status'
Write-Host ''

npm start
