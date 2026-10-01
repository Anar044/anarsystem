$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host ""
Write-Host "SmartHoreca Local Document AI" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI ne nayden. Zapustite Docker Desktop i povtorite."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop ne zapushen ili Docker Engine nedostupen."
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Sozdan .env iz .env.example" -ForegroundColor Yellow
}

Write-Host "Sobiraem obraz. Perviy zapusk mozhet zanyat neskolko minut..." -ForegroundColor Yellow
docker compose build
if ($LASTEXITCODE -ne 0) { throw "Docker build zavershilsya s oshibkoy." }

docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "Ne udalos zapustit container." }

Write-Host "Zhdyom gotovnost OCR..." -ForegroundColor Yellow
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8789/health" -TimeoutSec 5
        if ($health.ok) {
            $ok = $true
            break
        }
    } catch {}
    Write-Host "." -NoNewline
}
Write-Host ""

if (-not $ok) {
    Write-Host "Servis poka ne otvetil. Pokazivayu logi:" -ForegroundColor Red
    docker compose logs --tail=120 local-document-ai
    exit 1
}

Write-Host ""
Write-Host "LOCAL AI GOTOV" -ForegroundColor Green
Write-Host "Health:  http://127.0.0.1:8789/health"
Write-Host "Process: http://127.0.0.1:8789/process"
Write-Host ""
Write-Host "Pervaya zagruzka modeli PaddleOCR proizoydet pri pervom dokumente i mozhet zanyat vremya." -ForegroundColor Yellow
