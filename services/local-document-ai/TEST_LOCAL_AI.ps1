param(
    [Parameter(Mandatory=$true)]
    [string]$File
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path $File)) { throw "Fayl ne nayden: $File" }

$token = ""
if (Test-Path ".env") {
    $line = Get-Content ".env" | Where-Object { $_ -match '^LOCAL_AI_TOKEN=' } | Select-Object -First 1
    if ($line) { $token = ($line -replace '^LOCAL_AI_TOKEN=', '').Trim() }
}

$headers = @{}
if ($token) { $headers["Authorization"] = "Bearer $token" }

Write-Host "Otpravlyaem dokument v lokalniy OCR..." -ForegroundColor Cyan

$form = @{
    file = Get-Item $File
    prompt = "Extract restaurant supplier invoice data. Do not invent missing values."
    schema = "{}"
}

$result = Invoke-RestMethod -Uri "http://127.0.0.1:8789/process" -Method Post -Headers $headers -Form $form -TimeoutSec 300

$result | ConvertTo-Json -Depth 20
