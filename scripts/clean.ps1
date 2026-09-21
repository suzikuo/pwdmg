$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootPath = $Root.Path.TrimEnd("\")

Write-Host "==> Cleaning project build outputs and caches..." -ForegroundColor Cyan

# 1. Clean cargo
$SrcTauri = Join-Path $RootPath "src-tauri"
Push-Location $SrcTauri
try {
    cargo clean
    Write-Host "  [OK] Cleaned cargo target" -ForegroundColor Green
} catch {
    Write-Host "  [SKIP] cargo clean failed or not needed" -ForegroundColor Yellow
} finally {
    Pop-Location
}

# 2. Clean frontend dist
$FrontDist = Join-Path $RootPath "front\dist"
$FrontVite = Join-Path $RootPath "front\.vite"
if (Test-Path $FrontDist) {
    Remove-Item -Recurse -Force $FrontDist -ErrorAction SilentlyContinue
    Write-Host "  [OK] Removed front\dist" -ForegroundColor Green
}
if (Test-Path $FrontVite) {
    Remove-Item -Recurse -Force $FrontVite -ErrorAction SilentlyContinue
    Write-Host "  [OK] Removed front\.vite" -ForegroundColor Green
}

# 3. Clean release folder
$ReleaseDir = Join-Path $RootPath "release"
if (Test-Path $ReleaseDir) {
    Remove-Item -Recurse -Force $ReleaseDir -ErrorAction SilentlyContinue
    Write-Host "  [OK] Removed release output" -ForegroundColor Green
}

Write-Host "==> Project cleaned!" -ForegroundColor Cyan
