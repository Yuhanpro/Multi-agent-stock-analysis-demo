# Build a minimal deploy archive for a Linux VPS.
#
# Why this exists:
# - The GitHub repo intentionally ignores backend/vendor/TradingAgents.
# - The server still needs that vendored copy at runtime.
# - A raw `scp -r stock-web` would also upload .venv/node_modules/.next, which is huge.
#
# This script packages source + vendored TradingAgents, excluding reproducible
# dependencies and caches. Upload the resulting dist/stock-web-deploy.tar.gz.
#
# Usage from repo root:
#   powershell -ExecutionPolicy Bypass -File deploy/package.ps1

$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

if (-not (Test-Path "backend\vendor\TradingAgents\tradingagents")) {
    throw "backend\vendor\TradingAgents is missing. Refresh it from E:\code\projects\TradingAgents first."
}

New-Item -ItemType Directory -Path "dist" -Force | Out-Null
$out = "dist\stock-web-deploy.tar.gz"
if (Test-Path $out) { Remove-Item $out -Force }

$excludes = @(
    "--exclude=.git",
    "--exclude=.env",
    "--exclude=.env.local",
    "--exclude=dist",
    "--exclude=backend/.venv",
    "--exclude=backend/**/__pycache__",
    "--exclude=frontend/node_modules",
    "--exclude=frontend/.next",
    "--exclude=frontend/out",
    "--exclude=frontend/.vercel",
    "--exclude=*.pyc",
    "--exclude=_smoke_*",
    "--exclude=_probe_*",
    "--exclude=backend/vendor/TradingAgents/.git",
    "--exclude=backend/vendor/TradingAgents/.venv",
    "--exclude=backend/vendor/TradingAgents/**/__pycache__",
    "--exclude=backend/vendor/TradingAgents/Y"
)

Write-Host "Creating $out ..."
& tar.exe @excludes -czf $out -C $repo .

if ($LASTEXITCODE -ne 0) {
    throw "tar failed with exit code $LASTEXITCODE"
}

$size = (Get-Item $out).Length / 1MB
Write-Host ("Done: {0} ({1:N1} MB)" -f (Resolve-Path $out), $size)
Write-Host "Upload example:"
Write-Host "  scp $out root@<your-ip>:/tmp/stock-web-deploy.tar.gz"
