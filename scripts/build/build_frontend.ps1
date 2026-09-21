param(
    [ValidateSet("all", "desktop", "android", "web")]
    [string] $Target = "all"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$FrontDir = Join-Path $Root "front"

Push-Location $FrontDir
try {
    Write-Host "==> Building frontend target: $Target..." -ForegroundColor Cyan
    switch ($Target) {
        "desktop" { npm run build:desktop }
        "android" { npm run build:android }
        "web"     { npm run build:web }
        "all"     { npm run build }
    }
    Write-Host "==> Frontend build completed successfully!" -ForegroundColor Green
} finally {
    Pop-Location
}
