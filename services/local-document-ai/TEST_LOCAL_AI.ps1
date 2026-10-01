param(
    [Parameter(Mandatory=$true)]
    [string]$File
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path $File)) { throw "Fayl ne nayden: $File" }
$fullPath = (Resolve-Path $File).Path

$token = ""
if (Test-Path ".env") {
    $line = Get-Content ".env" | Where-Object { $_ -match '^LOCAL_AI_TOKEN=' } | Select-Object -First 1
    if ($line) { $token = ($line -replace '^LOCAL_AI_TOKEN=', '').Trim() }
}

Write-Host "Otpravlyaem dokument v lokalniy OCR..." -ForegroundColor Cyan

$args = @("-sS", "-X", "POST", "http://127.0.0.1:8789/process", "-F", "file=@$fullPath", "-F", "prompt=Extract restaurant supplier invoice data. Do not invent missing values.", "-F", "schema={}")
if ($token) { $args += @("-H", "Authorization: Bearer $token") }

& curl.exe @args
if ($LASTEXITCODE -ne 0) { throw "curl zavershilsya s oshibkoy." }
