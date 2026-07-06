param(
    [ValidateSet("major", "minor", "patch")]
    [string] $Bump = "patch",
    [string] $Version = "",
    [int] $VersionCode = 0,
    [string] $Repo = "",
    [string] $AssetUrl = "",
    [string] $AndroidAssetUrl = "",
    [string] $JavaHome = "",
    [string] $Notes = "",
    [switch] $Clean,
    [switch] $IncludeAndroid,
    [switch] $DesktopOnly,
    [switch] $SkipAndroidBuild,
    [switch] $NoVersionBump,
    [switch] $Publish,
    [switch] $NoPublish,
    [switch] $PublishOnly,
    [switch] $Draft,
    [switch] $Prerelease,
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Help {
    Write-Host "Usage:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Repo OWNER/REPO"
    Write-Host ""
    Write-Host "What it does:"
    Write-Host "  1. Bumps version by patch/minor/major unless -NoVersionBump is used."
    Write-Host "  2. Updates pwdmg_core/version.py, front package versions, Android versionName/versionCode, and front manifest version."
    Write-Host "  3. Runs scripts\package_desktop.ps1."
    Write-Host "  4. Builds the Android release APK unless -DesktopOnly is used."
    Write-Host "  5. Generates release\update-manifest.json for GitHub Releases."
    Write-Host "  6. Publishes the GitHub Release unless -NoPublish is used."
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Repo suzikuo/mypwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Bump minor -Repo suzikuo/mypwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Version 2.1.0 -Repo suzikuo/mypwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -NoVersionBump -NoPublish"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -NoVersionBump -PublishOnly"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Bump major|minor|patch  Version bump kind. Default: patch."
    Write-Host "  -Version VERSION         Explicit version, for example 2.1.0."
    Write-Host "  -VersionCode NUMBER      Explicit Android/front manifest build code. Default: Android versionCode + 1."
    Write-Host "  -Repo OWNER/REPO         GitHub repository. Inferred from git remote when possible."
    Write-Host "  -AssetUrl URL            Explicit release zip URL. Overrides -Repo URL generation."
    Write-Host "  -AndroidAssetUrl URL     Explicit Android APK URL. Overrides -Repo URL generation."
    Write-Host "  -JavaHome PATH           Optional JDK/JBR path for Android Gradle."
    Write-Host "  -Notes TEXT              Release notes for manifest and optional GitHub release."
    Write-Host "  -Clean                   Pass -Clean to package_desktop.ps1."
    Write-Host "  -IncludeAndroid          Legacy alias; Android is included by default."
    Write-Host "  -DesktopOnly             Build/publish only the Windows desktop package."
    Write-Host "  -SkipAndroidBuild        Use the existing Android APK output instead of running Gradle."
    Write-Host "  -NoVersionBump           Rebuild current version without editing version files."
    Write-Host "  -Publish                 Legacy alias; publish is enabled by default."
    Write-Host "  -NoPublish               Build packages and manifest only, without creating a GitHub Release."
    Write-Host "  -PublishOnly             Publish existing release files without rebuilding or rewriting versions."
    Write-Host "  -Draft                   Publish GitHub Release as draft."
    Write-Host "  -Prerelease              Mark GitHub Release as prerelease."
    Write-Host "  -Help                    Show this help."
}

if ($Help) {
    Show-Help
    exit 0
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootPath = $Root.Path.TrimEnd("\")
$VersionFile = Join-Path $RootPath "pwdmg_core\version.py"
$FrontDir = Join-Path $RootPath "front"
$FrontManifest = Join-Path $RootPath "front\manifest.json"
$AndroidGradle = Join-Path $RootPath "android\app\build.gradle"
$PackageScript = Join-Path $RootPath "scripts\package_desktop.ps1"
$ManifestScript = Join-Path $RootPath "scripts\write_update_manifest.ps1"
$ArchivePath = Join-Path $RootPath "release\MyPasswordDesktop-windows.zip"
$AndroidArchivePath = Join-Path $RootPath "release\MyPasswordAndroid-release.apk"
$AndroidReleaseOutput = Join-Path $RootPath "android\app\build\outputs\apk\release\app-release.apk"
$ManifestPath = Join-Path $RootPath "release\update-manifest.json"
$ShouldIncludeAndroid = -not $DesktopOnly
$ShouldPublish = $PublishOnly -or -not $NoPublish

function Read-Text {
    param([string] $Path)
    return [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($Path), [System.Text.Encoding]::UTF8)
}

function Write-Text {
    param([string] $Path, [string] $Value)
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Path), $Value, $Utf8NoBom)
}

function Assert-LastExitCode {
    param([string] $Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

function Require-ReleaseFile {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Release file was not found: $Path"
    }
}

function Get-CurrentVersion {
    $Text = Read-Text $VersionFile
    $Match = [regex]::Match($Text, 'APP_VERSION\s*=\s*"(?<version>\d+\.\d+\.\d+)"')
    if (-not $Match.Success) {
        throw "Could not read APP_VERSION from $VersionFile"
    }
    return $Match.Groups["version"].Value
}

function Get-NextVersion {
    param([string] $Current, [string] $Kind)
    $Parts = $Current.Split(".") | ForEach-Object { [int] $_ }
    if ($Parts.Count -ne 3) {
        throw "Version must be MAJOR.MINOR.PATCH: $Current"
    }
    if ($Kind -eq "major") {
        $Parts[0] += 1
        $Parts[1] = 0
        $Parts[2] = 0
    }
    elseif ($Kind -eq "minor") {
        $Parts[1] += 1
        $Parts[2] = 0
    }
    else {
        $Parts[2] += 1
    }
    return "$($Parts[0]).$($Parts[1]).$($Parts[2])"
}

function Get-AndroidVersionCode {
    $Text = Read-Text $AndroidGradle
    $Match = [regex]::Match($Text, 'versionCode\s+(?<code>\d+)')
    if (-not $Match.Success) {
        throw "Could not read Android versionCode from $AndroidGradle"
    }
    return [int] $Match.Groups["code"].Value
}

function Get-ManifestVersionCode {
    $Text = Read-Text $FrontManifest
    $Match = [regex]::Match($Text, '"code"\s*:\s*(?<code>\d+)')
    if ($Match.Success) {
        return [int] $Match.Groups["code"].Value
    }
    return 0
}

function Update-RegexFile {
    param([string] $Path, [string] $Pattern, [string] $Replacement)
    $Text = Read-Text $Path
    $Next = [regex]::Replace($Text, $Pattern, $Replacement, 1)
    if ($Next -eq $Text) {
        throw "No match while updating $Path with pattern: $Pattern"
    }
    Write-Text $Path $Next
}

function Infer-GitHubRepo {
    Push-Location $RootPath
    try {
        $Remote = (git config --get remote.origin.url 2>$null)
    }
    finally {
        Pop-Location
    }
    if (-not $Remote) {
        return ""
    }
    $Remote = $Remote.Trim()
    $Match = [regex]::Match($Remote, 'github\.com[:/](?<repo>[^/]+/[^/.]+)(?:\.git)?$')
    if ($Match.Success) {
        return $Match.Groups["repo"].Value
    }
    return ""
}

function Build-AssetUrl {
    param([string] $Repository, [string] $ReleaseVersion)
    if (-not $Repository) {
        throw "Repo is required to generate the GitHub Release asset URL. Pass -Repo OWNER/REPO or -AssetUrl URL."
    }
    return "https://github.com/$Repository/releases/download/v$ReleaseVersion/MyPasswordDesktop-windows.zip"
}

function Build-AndroidAssetUrl {
    param([string] $Repository, [string] $ReleaseVersion)
    if (-not $Repository) {
        throw "Repo is required to generate the Android APK asset URL. Pass -Repo OWNER/REPO or -AndroidAssetUrl URL."
    }
    return "https://github.com/$Repository/releases/download/v$ReleaseVersion/MyPasswordAndroid-release.apk"
}

function Resolve-JavaHome {
    if ($JavaHome.Trim()) {
        return $JavaHome.Trim()
    }
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\java.exe") -PathType Leaf)) {
        return $env:JAVA_HOME
    }
    $Candidates = @(
        "D:\android studio\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Android\Android Studio\jre"
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath (Join-Path $Candidate "bin\java.exe") -PathType Leaf) {
            return $Candidate
        }
    }
    return ""
}

function Resolve-GitHubCli {
    $Command = Get-Command gh -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }
    $Candidates = @(
        "$env:ProgramFiles\GitHub CLI\gh.exe",
        "$env:LocalAppData\Programs\GitHub CLI\gh.exe",
        "$env:LocalAppData\Microsoft\WinGet\Links\gh.exe"
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
            return $Candidate
        }
    }
    return ""
}

function Update-VersionFiles {
    param([string] $NextVersion, [int] $NextVersionCode)

    Update-RegexFile $VersionFile 'APP_VERSION\s*=\s*"\d+\.\d+\.\d+"' "APP_VERSION = `"$NextVersion`""

    Push-Location $FrontDir
    try {
        npm version $NextVersion --no-git-tag-version --allow-same-version | Out-Host
        Assert-LastExitCode "npm version"
    }
    finally {
        Pop-Location
    }

    Update-RegexFile $AndroidGradle 'versionCode\s+\d+' "versionCode $NextVersionCode"
    Update-RegexFile $AndroidGradle 'versionName\s+"\d+\.\d+\.\d+"' "versionName `"$NextVersion`""

    if (Test-Path -LiteralPath $FrontManifest) {
        Update-RegexFile $FrontManifest '"name"\s*:\s*"\d+(?:\.\d+){1,2}"' "`"name`" : `"$NextVersion`""
        Update-RegexFile $FrontManifest '"code"\s*:\s*\d+' "`"code`" : $NextVersionCode"
    }
}

function Invoke-DesktopPackage {
    $PackageArgs = @()
    if ($Clean) {
        $PackageArgs += "-Clean"
    }
    & $PackageScript @PackageArgs
    Assert-LastExitCode "Desktop package script"
}

function Invoke-AndroidPackage {
    if (-not $ShouldIncludeAndroid) {
        return
    }

    if (-not $SkipAndroidBuild) {
        Push-Location (Join-Path $RootPath "android")
        try {
            $ResolvedJavaHome = Resolve-JavaHome
            if ($ResolvedJavaHome) {
                $env:JAVA_HOME = $ResolvedJavaHome
            }
            .\gradlew.bat :app:assembleRelease
            Assert-LastExitCode "Android release build"
        }
        finally {
            Pop-Location
        }
    }

    if (-not (Test-Path -LiteralPath $AndroidReleaseOutput -PathType Leaf)) {
        throw "Android release APK was not found: $AndroidReleaseOutput"
    }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $AndroidArchivePath))) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $AndroidArchivePath) | Out-Null
    }
    Copy-Item -LiteralPath $AndroidReleaseOutput -Destination $AndroidArchivePath -Force
}

function Invoke-Manifest {
    param([string] $ReleaseVersion, [string] $Url)
    if ($ShouldIncludeAndroid) {
        & $ManifestScript `
            -Version $ReleaseVersion `
            -AssetUrl $Url `
            -PackagePath $ArchivePath `
            -AndroidPackagePath $AndroidArchivePath `
            -AndroidAssetUrl $AndroidAssetUrl `
            -AndroidVersionCode $NextVersionCode `
            -OutPath $ManifestPath `
            -Notes $Notes
    }
    else {
        & $ManifestScript `
            -Version $ReleaseVersion `
            -AssetUrl $Url `
            -PackagePath $ArchivePath `
            -OutPath $ManifestPath `
            -Notes $Notes
    }
    Assert-LastExitCode "Update manifest script"
}

function Publish-GitHubRelease {
    param([string] $Repository, [string] $ReleaseVersion)
    $Gh = Resolve-GitHubCli
    if (-not $Gh) {
        throw "GitHub CLI (gh) was not found. Restart PowerShell after installing GitHub CLI, then run: .\scripts\release_desktop.ps1 -NoVersionBump -PublishOnly. Or rerun with -NoPublish and upload the files manually."
    }
    $Tag = "v$ReleaseVersion"
    $Title = "v$ReleaseVersion"
    $ReleaseNotes = if ($Notes) { $Notes } else { "My Password $Tag" }
    $ReleaseFiles = @($ArchivePath, $ManifestPath)
    if ($ShouldIncludeAndroid) {
        $ReleaseFiles += $AndroidArchivePath
    }
    $GhArgs = @("release", "create", $Tag) + $ReleaseFiles + @("--title", $Title, "--notes", $ReleaseNotes)
    if ($Repository) {
        $GhArgs += @("--repo", $Repository)
    }
    if ($Draft) {
        $GhArgs += "--draft"
    }
    if ($Prerelease) {
        $GhArgs += "--prerelease"
    }
    & $Gh @GhArgs
    Assert-LastExitCode "GitHub release publish"
}

$CurrentVersion = Get-CurrentVersion
$NextVersion = if ($Version.Trim()) { $Version.Trim().TrimStart("v") } elseif ($NoVersionBump) { $CurrentVersion } else { Get-NextVersion $CurrentVersion $Bump }
if (-not ($NextVersion -match '^\d+\.\d+\.\d+$')) {
    throw "Version must be MAJOR.MINOR.PATCH: $NextVersion"
}

$CurrentAndroidCode = Get-AndroidVersionCode
$CurrentManifestCode = Get-ManifestVersionCode
$NextVersionCode = if ($VersionCode -gt 0) { $VersionCode } else { [Math]::Max($CurrentAndroidCode, $CurrentManifestCode) + 1 }

if (-not $Repo.Trim()) {
    $Repo = Infer-GitHubRepo
}
$Repo = $Repo.Trim()

if (-not $AssetUrl.Trim()) {
    $AssetUrl = Build-AssetUrl $Repo $NextVersion
}
$AssetUrl = $AssetUrl.Trim()
if (-not ($AssetUrl -match '^https://')) {
    throw "AssetUrl must be HTTPS: $AssetUrl"
}

if ($ShouldIncludeAndroid -and -not $AndroidAssetUrl.Trim()) {
    $AndroidAssetUrl = Build-AndroidAssetUrl $Repo $NextVersion
}
$AndroidAssetUrl = $AndroidAssetUrl.Trim()
if ($ShouldIncludeAndroid -and -not ($AndroidAssetUrl -match '^https://')) {
    throw "AndroidAssetUrl must be HTTPS: $AndroidAssetUrl"
}

Write-Host "Release version: $CurrentVersion -> $NextVersion"
Write-Host "Version code: $CurrentAndroidCode -> $NextVersionCode"
Write-Host "GitHub repo: $(if ($Repo) { $Repo } else { '(not set)' })"
Write-Host "Asset URL: $AssetUrl"
if ($ShouldIncludeAndroid) {
    Write-Host "Android asset URL: $AndroidAssetUrl"
}
Write-Host "Android package: $(if ($ShouldIncludeAndroid) { 'enabled' } else { 'desktop only' })"
Write-Host "Publish GitHub Release: $(if ($ShouldPublish) { 'enabled' } else { 'disabled' })"

if ($PublishOnly) {
    Write-Host ""
    Write-Host "==> Publish only mode"
    Require-ReleaseFile $ArchivePath
    Require-ReleaseFile $ManifestPath
    if ($ShouldIncludeAndroid) {
        Require-ReleaseFile $AndroidArchivePath
    }
    Publish-GitHubRelease $Repo $NextVersion
    exit 0
}

if (-not $NoVersionBump -or $Version.Trim()) {
    Write-Host ""
    Write-Host "==> Updating version files"
    Update-VersionFiles $NextVersion $NextVersionCode
}

Write-Host ""
Write-Host "==> Packaging desktop app"
Invoke-DesktopPackage

if ($ShouldIncludeAndroid) {
    Write-Host ""
    Write-Host "==> Packaging Android app"
    Invoke-AndroidPackage
}

Write-Host ""
Write-Host "==> Writing update manifest"
Invoke-Manifest $NextVersion $AssetUrl

if ($ShouldPublish) {
    Write-Host ""
    Write-Host "==> Publishing GitHub Release"
    Publish-GitHubRelease $Repo $NextVersion
}
else {
    Write-Host ""
    Write-Host "Release files are ready:"
    Write-Host "  $ArchivePath"
    if ($ShouldIncludeAndroid) {
        Write-Host "  $AndroidArchivePath"
    }
    Write-Host "  $ManifestPath"
    Write-Host ""
    Write-Host "Create GitHub Release tag v$NextVersion and upload both files."
    Write-Host "Or rerun with -Publish after installing/logging in to GitHub CLI."
}
