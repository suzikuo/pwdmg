$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location (Join-Path $Root "browser-extension")
try {
    node --test tests/*.test.js
} finally {
    Pop-Location
}
