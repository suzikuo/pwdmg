param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,
    [switch]$EdgeOnly,
    [switch]$ChromeOnly
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$hostName = "com.suzikuo.mypwdmg"
$manifestDir = Join-Path $repo "native-host"
$manifestPath = Join-Path $manifestDir "$hostName.json"
$hostPath = Join-Path $repo "scripts\mypwdmg_native_host.cmd"
$pythonPath = Join-Path $repo ".env\Scripts\python.exe"

if (-not (Test-Path $pythonPath)) {
    throw "Python not found in .env. Please recreate .env and install requirements.txt first."
}

& $pythonPath -c "import cryptography; import webview; import pwdmg_core.native_host" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw ".env Python cannot import required modules. Please recreate .env and run: pip install -r requirements.txt"
}

New-Item -ItemType Directory -Force $manifestDir | Out-Null

$manifest = @{
    name = $hostName
    description = "My Password native messaging host"
    path = $hostPath
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

Write-Host "Native host installed: $manifestPath"
