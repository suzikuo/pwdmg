param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,
    [string]$HostExePath = "",
    [switch]$EdgeOnly,
    [switch]$ChromeOnly
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$hostName = "com.suzikuo.mypwdmg"
$manifestDir = Join-Path $repo "native-host"
$manifestPath = Join-Path $manifestDir "$hostName.json"

if (-not $HostExePath) {
    $candidate1 = Join-Path $repo "release\desktop\My Password Host.exe"
    $candidate2 = Join-Path $repo "src-tauri\target\release\my-password-host.exe"
    $candidate3 = Join-Path $repo "src-tauri\target\debug\my-password-host.exe"

    if (Test-Path $candidate1) {
        $HostExePath = $candidate1
    }
    elseif (Test-Path $candidate2) {
        $HostExePath = $candidate2
    }
    elseif (Test-Path $candidate3) {
        $HostExePath = $candidate3
    }
    else {
        throw "Could not find My Password Host.exe. Please build it first via: powershell .\scripts\build\package_desktop.ps1 (or cargo build --release)"
    }
}

$HostExePath = (Resolve-Path $HostExePath).Path
New-Item -ItemType Directory -Force $manifestDir | Out-Null

$manifest = @{
    name = $hostName
    description = "My Password native messaging host"
    path = $HostExePath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $manifestPath

if (-not $EdgeOnly) {
    New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -Force | Out-Null
    Set-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -Value $manifestPath
}

if (-not $ChromeOnly) {
    New-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -Force | Out-Null
    Set-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -Value $manifestPath
}

Write-Host "Native host installed successfully!" -ForegroundColor Green
Write-Host "  Manifest: $manifestPath"
Write-Host "  Target:   $HostExePath"
