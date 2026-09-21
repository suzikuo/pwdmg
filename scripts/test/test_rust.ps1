$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location (Join-Path $Root "src-tauri")
try {
    cargo test --workspace
} finally {
    Pop-Location
}
