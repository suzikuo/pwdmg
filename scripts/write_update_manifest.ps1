param(
    [string] $Version = "",
    [string] $AssetUrl = "",
    [string] $AssetMirrorUrls = "",

    [string] $PackagePath = ".\release\MyPasswordDesktop-windows.zip",
    [string] $AndroidPackagePath = "",
    [string] $AndroidAssetUrl = "",
    [string] $AndroidAssetMirrorUrls = "",
    [int] $AndroidVersionCode = 0,
    [string] $OutPath = ".\release\update-manifest.json",
    [string] $Notes = "",
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Help {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\write_update_manifest.ps1 -Version 2.0.1 -AssetUrl https://github.com/OWNER/REPO/releases/download/v2.0.1/MyPasswordDesktop-windows.zip"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Version      Release version. Example: 2.0.1"
    Write-Host "  -AssetUrl     HTTPS URL for the desktop zip release asset."
    Write-Host "  -AssetMirrorUrls  Optional desktop mirror URLs, separated by comma/semicolon/space."
    Write-Host "  -PackagePath  Local zip to hash. Default: .\release\MyPasswordDesktop-windows.zip"
    Write-Host "  -AndroidPackagePath  Optional Android release APK to hash."
    Write-Host "  -AndroidAssetUrl     Optional HTTPS URL for the Android APK release asset."
    Write-Host "  -AndroidAssetMirrorUrls  Optional Android mirror URLs, separated by comma/semicolon/space."
    Write-Host "  -AndroidVersionCode  Optional Android versionCode."
    Write-Host "  -OutPath      Manifest output path. Default: .\release\update-manifest.json"
    Write-Host "  -Notes        Optional release notes text."
    Write-Host "  -Help         Show this help."
}

if ($Help) {
    Show-Help
    exit 0
}

if (-not $Version.Trim()) {
    throw "Version is required."
}

if (-not $AssetUrl.Trim()) {
    throw "AssetUrl is required."
}

if (-not ($AssetUrl -match '^https://')) {
    throw "AssetUrl must be an HTTPS GitHub Release asset URL."
}

function Get-UrlCandidates {
    param([string] $MirrorUrls, [string] $PrimaryUrl)

    $Result = New-Object System.Collections.Generic.List[string]
    foreach ($Raw in ($MirrorUrls -split '[\s,;]+')) {
        $Value = $Raw.Trim()
        if ($Value -and -not $Result.Contains($Value)) {
            $Result.Add($Value)
        }
    }
    $Primary = $PrimaryUrl.Trim()
    if ($Primary -and -not $Result.Contains($Primary)) {
        $Result.Add($Primary)
    }
    return @($Result.ToArray())
}

function Assert-HttpsUrls {
    param([string[]] $Urls, [string] $Label)

    foreach ($Url in $Urls) {
        if (-not ($Url -match '^https://')) {
            throw "$Label must contain only HTTPS URLs: $Url"
        }
    }
}

$WindowsUrls = Get-UrlCandidates -MirrorUrls $AssetMirrorUrls -PrimaryUrl $AssetUrl
Assert-HttpsUrls -Urls $WindowsUrls -Label "AssetMirrorUrls"

if ($AndroidPackagePath.Trim() -or $AndroidAssetUrl.Trim()) {
    if (-not $AndroidPackagePath.Trim()) {
        throw "AndroidPackagePath is required when AndroidAssetUrl is set."
    }
    if (-not $AndroidAssetUrl.Trim()) {
        throw "AndroidAssetUrl is required when AndroidPackagePath is set."
    }
    if (-not ($AndroidAssetUrl -match '^https://')) {
        throw "AndroidAssetUrl must be an HTTPS GitHub Release asset URL."
    }
    $AndroidUrls = Get-UrlCandidates -MirrorUrls $AndroidAssetMirrorUrls -PrimaryUrl $AndroidAssetUrl
    Assert-HttpsUrls -Urls $AndroidUrls -Label "AndroidAssetMirrorUrls"
}

if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
    throw "Desktop package zip was not found: $PackagePath. Run scripts\package_desktop.ps1 first, or pass -PackagePath to an existing zip."
}

$PackageFull = Resolve-Path $PackagePath
$OutFull = [System.IO.Path]::GetFullPath($OutPath)
$OutDir = Split-Path -Parent $OutFull

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$Hash = Get-FileHash -LiteralPath $PackageFull -Algorithm SHA256
$Item = Get-Item -LiteralPath $PackageFull

$Assets = [ordered]@{
    windows = [ordered]@{
        url = $AssetUrl
        fileName = $Item.Name
        size = $Item.Length
        sha256 = $Hash.Hash.ToLowerInvariant()
    }
}
if ($AssetMirrorUrls.Trim()) {
    $Assets.windows.urls = $WindowsUrls
}

if ($AndroidPackagePath.Trim()) {
    if (-not (Test-Path -LiteralPath $AndroidPackagePath -PathType Leaf)) {
        throw "Android package APK was not found: $AndroidPackagePath. Build Android first, or omit Android update fields."
    }
    $AndroidPackageFull = Resolve-Path $AndroidPackagePath
    $AndroidHash = Get-FileHash -LiteralPath $AndroidPackageFull -Algorithm SHA256
    $AndroidItem = Get-Item -LiteralPath $AndroidPackageFull
    $AndroidAsset = [ordered]@{
        url = $AndroidAssetUrl
        fileName = $AndroidItem.Name
        size = $AndroidItem.Length
        sha256 = $AndroidHash.Hash.ToLowerInvariant()
    }
    if ($AndroidAssetMirrorUrls.Trim()) {
        $AndroidAsset.urls = $AndroidUrls
    }
    if ($AndroidVersionCode -gt 0) {
        $AndroidAsset.versionCode = $AndroidVersionCode
    }
    $Assets.android = $AndroidAsset
}

$Manifest = [ordered]@{
    version = $Version.TrimStart("v")
    versionCode = if ($AndroidVersionCode -gt 0) { $AndroidVersionCode } else { $null }
    publishedAt = (Get-Date).ToUniversalTime().ToString("o")
    notes = $Notes
    assets = $Assets
}

$ManifestJson = $Manifest | ConvertTo-Json -Depth 8
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFull, $ManifestJson, $Utf8NoBom)

Write-Host "Update manifest written:"
Write-Host "  $OutFull"
Write-Host "SHA256:"
Write-Host "  $($Hash.Hash.ToLowerInvariant())"
