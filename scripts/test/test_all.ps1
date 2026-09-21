param(
    [switch] $Quick
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RootPath = $Root.Path.TrimEnd("\")

$PassCount = 0
$FailCount = 0
$Results = @()

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "         Running Full Test Suite                 " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Front tests
Write-Host "`n[1/3] Running Frontend Unit & Contract Tests (Vue 3)..." -ForegroundColor Yellow
Push-Location (Join-Path $RootPath "front")
try {
    npm test
    if ($LASTEXITCODE -eq 0) {
        $Results += [PSCustomObject]@{ Suite = "Frontend (front)"; Status = "PASS"; ExitCode = 0 }
        $PassCount++
    } else {
        $Results += [PSCustomObject]@{ Suite = "Frontend (front)"; Status = "FAIL"; ExitCode = $LASTEXITCODE }
        $FailCount++
    }
} catch {
    $Results += [PSCustomObject]@{ Suite = "Frontend (front)"; Status = "ERROR"; ExitCode = 1 }
    $FailCount++
} finally {
    Pop-Location
}

# 2. Browser Extension tests
Write-Host "`n[2/3] Running Browser Extension Tests (Node.js test runner)..." -ForegroundColor Yellow
Push-Location (Join-Path $RootPath "browser-extension")
try {
    node --test tests/*.test.js
    if ($LASTEXITCODE -eq 0) {
        $Results += [PSCustomObject]@{ Suite = "Browser Extension"; Status = "PASS"; ExitCode = 0 }
        $PassCount++
    } else {
        $Results += [PSCustomObject]@{ Suite = "Browser Extension"; Status = "FAIL"; ExitCode = $LASTEXITCODE }
        $FailCount++
    }
} catch {
    $Results += [PSCustomObject]@{ Suite = "Browser Extension"; Status = "ERROR"; ExitCode = 1 }
    $FailCount++
} finally {
    Pop-Location
}

# 3. Rust Core & Native Host tests
Write-Host "`n[3/3] Running Rust Workspace Tests (pwdmg-core & native-host)..." -ForegroundColor Yellow
Push-Location (Join-Path $RootPath "src-tauri")
try {
    cargo test --workspace
    if ($LASTEXITCODE -eq 0) {
        $Results += [PSCustomObject]@{ Suite = "Rust Workspace"; Status = "PASS"; ExitCode = 0 }
        $PassCount++
    } else {
        $Results += [PSCustomObject]@{ Suite = "Rust Workspace"; Status = "FAIL"; ExitCode = $LASTEXITCODE }
        $FailCount++
    }
} catch {
    $Results += [PSCustomObject]@{ Suite = "Rust Workspace"; Status = "ERROR"; ExitCode = 1 }
    $FailCount++
} finally {
    Pop-Location
}

# Summary
Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "                Test Summary                     " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
foreach ($r in $Results) {
    $color = if ($r.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("  {0,-25} : [{1}]" -f $r.Suite, $r.Status) -ForegroundColor $color
}
Write-Host "-------------------------------------------------" -ForegroundColor Cyan
Write-Host ("  Total: {0} passed, {1} failed" -f $PassCount, $FailCount) -ForegroundColor $(if ($FailCount -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================" -ForegroundColor Cyan

if ($FailCount -gt 0) {
    exit 1
}
