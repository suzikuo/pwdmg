$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location (Join-Path $Root "front")
try {
    npm test
} finally {
    Pop-Location
}
