param(
    [ValidateSet("major", "minor", "patch")]
    [string] $Bump = "patch",
    [string] $Version = "",
    [int] $VersionCode = 0,
    [string] $Repo = "",
    [string] $AssetUrl = "",
    [string] $AssetMirrorUrls = "",
    [string] $AndroidAssetUrl = "",
    [string] $AndroidAssetMirrorUrls = "",
    [string] $JavaHome = "",
    [string] $Notes = "",
    [string] $Mode = "",
    [string] $PrivateKeyPath = ".\.update-signing\mypwdmg-update-private-key.pem",
    [string] $PublicKeyPath = ".\.update-signing\mypwdmg-update-public-key.pem",
    [string] $PythonExe = "",
    [switch] $Clean,
    [switch] $SkipFrontend,
    [switch] $IncludeAndroid,
    [switch] $NoNativeHost,
    [switch] $SkipDesktopBuild,
    [switch] $DesktopOnly,
    [switch] $SkipAndroidBuild,
    [switch] $NoVersionBump,
    [switch] $Publish,
    [switch] $NoPublish,
    [switch] $PublishOnly,
    [switch] $Draft,
    [switch] $Prerelease,
    [switch] $GenerateSigningKey,
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ReleaseModeSelectedInteractively = $false
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Show-Help {
    Write-Host "Usage:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Repo OWNER/REPO"
    Write-Host ""
    Write-Host "What it does:"
    Write-Host "  1. Bumps version by patch/minor/major unless -NoVersionBump is used."
    Write-Host "  2. Updates pwdmg_core/version.py, front package versions, Android versionName/versionCode, and front manifest version."
    Write-Host "  3. Runs scripts\package_desktop.ps1."
    Write-Host "  4. Builds the Android release APK unless -DesktopOnly is used."
    Write-Host "  5. Generates and Ed25519-signs release\update-manifest.json for GitHub Releases."
    Write-Host "  6. Publishes the GitHub Release unless -NoPublish is used."
    Write-Host "  If no flow option is provided in an interactive shell, a release mode menu is shown."
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Repo suzikuo/pwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Mode build"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Mode build -DesktopOnly -NoNativeHost"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Mode publish"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Mode full -Repo suzikuo/pwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Bump minor -Repo suzikuo/pwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -Version 2.1.0 -Repo suzikuo/pwdmg"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -NoVersionBump -NoPublish"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\release_desktop.ps1 -NoVersionBump -PublishOnly"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Bump major|minor|patch  Version bump kind. Default: patch."
    Write-Host "  -Version VERSION         Explicit version, for example 2.1.0."
    Write-Host "  -VersionCode NUMBER      Explicit Android/front manifest build code. Default: +1 when version changes."
    Write-Host "  -Repo OWNER/REPO         GitHub repository. Inferred from git remote when possible."
    Write-Host "  -AssetUrl URL            Explicit release zip URL. Overrides -Repo URL generation."
    Write-Host "  -AssetMirrorUrls URLS    Optional desktop mirror URLs, separated by comma/semicolon/space."
    Write-Host "  -AndroidAssetUrl URL     Explicit Android APK URL. Overrides -Repo URL generation."
    Write-Host "  -AndroidAssetMirrorUrls URLS  Optional Android mirror URLs, separated by comma/semicolon/space."
    Write-Host "  -JavaHome PATH           Optional JDK/JBR path for Android Gradle."
    Write-Host "  -Notes TEXT              Release notes for manifest and optional GitHub release."
    Write-Host "  -PrivateKeyPath PATH     Gitignored Ed25519 manifest signing key."
    Write-Host "  -PythonExe PATH          Python executable with requirements.txt installed."
    Write-Host "  -GenerateSigningKey      Generate the one-time workspace signing key, then exit."
    Write-Host "  -Mode MODE               Release flow: full, build, publish, or menu."
    Write-Host "  -Clean                   Pass -Clean to package_desktop.ps1."
    Write-Host "  -SkipFrontend            Pass -SkipFrontend to package_desktop.ps1."
    Write-Host "  -IncludeAndroid          Legacy alias; Android is included by default."
    Write-Host "  -NoNativeHost            Build desktop package without My Password Host.exe."
    Write-Host "  -SkipDesktopBuild        Use existing release desktop zip instead of rebuilding desktop."
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

function Select-ReleaseMode {
    Write-Host ""
    Write-Host "Select release flow:" -ForegroundColor Cyan
    Write-Host "  [1] Full flow    Version -> build -> manifest -> publish"
    Write-Host "  [2] Build only   Build packages and manifest, do not publish or bump by default"
    Write-Host "  [3] Publish only Publish existing files from release\"
    Write-Host ""

    while ($true) {
        $Choice = (Read-Host "Enter 1/2/3").Trim().ToLowerInvariant()
        switch ($Choice) {
            "1" { $script:ReleaseModeSelectedInteractively = $true; return "full" }
            "full" { $script:ReleaseModeSelectedInteractively = $true; return "full" }
            "f" { $script:ReleaseModeSelectedInteractively = $true; return "full" }
            "2" { $script:ReleaseModeSelectedInteractively = $true; return "build" }
            "build" { $script:ReleaseModeSelectedInteractively = $true; return "build" }
            "b" { $script:ReleaseModeSelectedInteractively = $true; return "build" }
            "3" { $script:ReleaseModeSelectedInteractively = $true; return "publish" }
            "publish" { $script:ReleaseModeSelectedInteractively = $true; return "publish" }
            "p" { $script:ReleaseModeSelectedInteractively = $true; return "publish" }
            default { Write-Host "Please choose 1, 2, or 3." -ForegroundColor Yellow }
        }
    }
}

function Select-BuildOptions {
    Write-Host ""
    Write-Host "Select build target:" -ForegroundColor Cyan
    Write-Host "  [1] Desktop + Host + Android"
    Write-Host "  [2] Desktop + Host only"
    Write-Host "  [3] Desktop without Host only"
    Write-Host "  [4] Desktop without Host + Android"
    Write-Host "  [5] Android only, use existing desktop zip for manifest"
    Write-Host ""

    while ($true) {
        $Choice = (Read-Host "Enter 1/2/3/4/5").Trim().ToLowerInvariant()
        switch ($Choice) {
            "1" {
                $script:SkipDesktopBuild = $false
                $script:NoNativeHost = $false
                $script:DesktopOnly = $false
                break
            }
            "2" {
                $script:SkipDesktopBuild = $false
                $script:NoNativeHost = $false
                $script:DesktopOnly = $true
                break
            }
            "3" {
                $script:SkipDesktopBuild = $false
                $script:NoNativeHost = $true
                $script:DesktopOnly = $true
                break
            }
            "4" {
                $script:SkipDesktopBuild = $false
                $script:NoNativeHost = $true
                $script:DesktopOnly = $false
                break
            }
            "5" {
                $script:SkipDesktopBuild = $true
                $script:DesktopOnly = $false
                break
            }
            default {
                Write-Host "Please choose 1, 2, 3, 4, or 5." -ForegroundColor Yellow
                continue
            }
        }
        break
    }

    if (-not $SkipDesktopBuild) {
        $CleanChoice = (Read-Host "Clean desktop build outputs first? y/N").Trim().ToLowerInvariant()
        if ($CleanChoice -eq "y" -or $CleanChoice -eq "yes") {
            $script:Clean = $true
        }

        $SkipFrontendChoice = (Read-Host "Skip frontend npm build? y/N").Trim().ToLowerInvariant()
        if ($SkipFrontendChoice -eq "y" -or $SkipFrontendChoice -eq "yes") {
            $script:SkipFrontend = $true
        }
    }

    if (-not $DesktopOnly) {
        $SkipAndroidChoice = (Read-Host "Skip Android Gradle build and reuse existing APK? y/N").Trim().ToLowerInvariant()
        if ($SkipAndroidChoice -eq "y" -or $SkipAndroidChoice -eq "yes") {
            $script:SkipAndroidBuild = $true
        }
    }
}

function Resolve-ReleaseMode {
    $NormalizedMode = $Mode.Trim().ToLowerInvariant()
    $AllowedModes = @("", "full", "build", "publish", "menu")
    if ($AllowedModes -notcontains $NormalizedMode) {
        throw "Mode must be one of: full, build, publish, menu."
    }

    if ($NormalizedMode -eq "menu") {
        return (Select-ReleaseMode)
    }
    if ($NormalizedMode) {
        return $NormalizedMode
    }

    $HasLegacyFlowFlag = $PSBoundParameters.ContainsKey("PublishOnly") -or
        $PSBoundParameters.ContainsKey("NoPublish") -or
        $PSBoundParameters.ContainsKey("Publish")
    if (-not $HasLegacyFlowFlag -and -not [Console]::IsInputRedirected) {
        return (Select-ReleaseMode)
    }

    if ($PublishOnly) {
        return "publish"
    }
    if ($NoPublish) {
        return "build"
    }
    return "full"
}

function Apply-ReleaseMode {
    param([string] $SelectedMode)

    switch ($SelectedMode) {
        "full" {
            $script:PublishOnly = $false
            $script:NoPublish = $false
        }
        "build" {
            $script:PublishOnly = $false
            $script:NoPublish = $true
            if (-not $PSBoundParameters.ContainsKey("NoVersionBump") -and
                -not $PSBoundParameters.ContainsKey("Version") -and
                -not $PSBoundParameters.ContainsKey("Bump") -and
                -not $PSBoundParameters.ContainsKey("NoPublish")) {
                $script:NoVersionBump = $true
            }
        }
        "publish" {
            $script:PublishOnly = $true
            $script:NoPublish = $false
            $script:NoVersionBump = $true
        }
    }
}

if ($Help) {
    Show-Help
    exit 0
}

$ReleaseMode = if ($GenerateSigningKey) { "build" } else { Resolve-ReleaseMode }
Apply-ReleaseMode $ReleaseMode
$HasExplicitBuildOption = $GenerateSigningKey -or
    $PSBoundParameters.ContainsKey("Clean") -or
    $PSBoundParameters.ContainsKey("SkipFrontend") -or
    $PSBoundParameters.ContainsKey("DesktopOnly") -or
    $PSBoundParameters.ContainsKey("SkipDesktopBuild") -or
    $PSBoundParameters.ContainsKey("NoNativeHost") -or
    $PSBoundParameters.ContainsKey("SkipAndroidBuild") -or
    $PSBoundParameters.ContainsKey("IncludeAndroid")
if ($ReleaseMode -eq "build" -and -not $HasExplicitBuildOption -and -not [Console]::IsInputRedirected) {
    Select-BuildOptions
}
if ($SkipDesktopBuild -and $DesktopOnly) {
    throw "-SkipDesktopBuild cannot be combined with -DesktopOnly because no package would be produced."
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
$AndroidBuildLog = Join-Path $RootPath "release\android-gradle-build.log"
$ManifestPath = Join-Path $RootPath "release\update-manifest.json"
$DefaultAndroidKeystore = Join-Path $RootPath "pwdmg-release.jks"
$SigningPrivateKeyPath = if ([System.IO.Path]::IsPathRooted($PrivateKeyPath)) { [System.IO.Path]::GetFullPath($PrivateKeyPath) } else { [System.IO.Path]::GetFullPath((Join-Path $RootPath $PrivateKeyPath)) }
$SigningPublicKeyPath = if ([System.IO.Path]::IsPathRooted($PublicKeyPath)) { [System.IO.Path]::GetFullPath($PublicKeyPath) } else { [System.IO.Path]::GetFullPath((Join-Path $RootPath $PublicKeyPath)) }
$ShouldIncludeAndroid = -not $DesktopOnly
$ShouldPublish = $PublishOnly -or -not $NoPublish
$WindowsDesktopExcludedRelativePaths = @(
    "_internal\webview\lib\pywebview-android.jar"
)

function Resolve-ProjectPython {
    $Candidates = New-Object System.Collections.Generic.List[string]
    if ($PythonExe.Trim()) {
        $Candidates.Add($PythonExe.Trim())
    }
    $Candidates.Add((Join-Path $RootPath ".env\Scripts\python.exe"))
    $Candidates.Add((Join-Path $RootPath ".venv\Scripts\python.exe"))
    $Candidates.Add("python")
    foreach ($Candidate in $Candidates) {
        try {
            & $Candidate -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey" *> $null
            if ($LASTEXITCODE -eq 0) {
                return $Candidate
            }
        }
        catch { }
    }
    throw "Python with the cryptography package was not found. Pass -PythonExe or install requirements.txt."
}

if ($GenerateSigningKey) {
    $SigningPython = Resolve-ProjectPython
    Push-Location $RootPath
    try {
        & $SigningPython -m pwdmg_core.updater generate-signing-key --private-key $SigningPrivateKeyPath --public-key $SigningPublicKeyPath
        if ($LASTEXITCODE -ne 0) {
            throw "Signing key generation failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
    Write-Host "Keep the private key offline and backed up securely. Never commit .update-signing."
    exit 0
}

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

function Assert-LastExitCodeWithLog {
    param([string] $Step, [string] $LogPath)
    if ($LASTEXITCODE -eq 0) {
        return
    }
    if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
        Write-Host ""
        Write-Host "$Step failed. Last Gradle log lines:" -ForegroundColor Red
        Get-Content -LiteralPath $LogPath -Tail 80 | ForEach-Object { Write-Host $_ }
        Write-Host ""
        Write-Host "Full Android Gradle log: $LogPath" -ForegroundColor Yellow
    }
    throw "$Step failed with exit code $LASTEXITCODE"
}

function Require-ReleaseFile {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Release file was not found: $Path"
    }
}

function New-ZipArchiveFromDirectory {
    param(
        [string] $SourceDir,
        [string] $DestinationPath,
        [string[]] $ExcludedRelativePaths = @()
    )

    $SourceFull = [System.IO.Path]::GetFullPath($SourceDir).TrimEnd("\")
    $DestinationFull = [System.IO.Path]::GetFullPath($DestinationPath)
    if ($DestinationFull.StartsWith($SourceFull + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination archive must not be inside source directory: $DestinationFull"
    }
    $DestinationParent = Split-Path -Parent $DestinationFull
    if (-not (Test-Path -LiteralPath $DestinationParent -PathType Container)) {
        New-Item -ItemType Directory -Path $DestinationParent | Out-Null
    }
    if (Test-Path -LiteralPath $DestinationFull) {
        Remove-Item -LiteralPath $DestinationFull -Force
    }

    $Archive = [System.IO.Compression.ZipFile]::Open(
        $DestinationFull,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        Get-ChildItem -LiteralPath $SourceFull -Recurse -File | ForEach-Object {
            $RelativePath = $_.FullName.Substring($SourceFull.Length).TrimStart("\")
            if ($ExcludedRelativePaths -notcontains $RelativePath) {
                $EntryName = $RelativePath -replace "\\", "/"
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $Archive,
                    $_.FullName,
                    $EntryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
    }
    finally {
        $Archive.Dispose()
    }
}

function Ensure-DesktopArchive {
    if (Test-Path -LiteralPath $ArchivePath -PathType Leaf) {
        return
    }

    $DesktopStageDir = Join-Path $RootPath "release\desktop"
    if (-not (Test-Path -LiteralPath $DesktopStageDir -PathType Container)) {
        throw "Desktop archive was not produced, and the staged desktop directory was not found: $DesktopStageDir"
    }

    $StageItems = @(Get-ChildItem -LiteralPath $DesktopStageDir -Force)
    if ($StageItems.Count -eq 0) {
        throw "Desktop archive was not produced, and the staged desktop directory is empty: $DesktopStageDir"
    }

    Write-Host "Desktop archive was not produced by package_desktop.ps1; creating it from staged files."
    New-ZipArchiveFromDirectory $DesktopStageDir $ArchivePath $WindowsDesktopExcludedRelativePaths
    Require-ReleaseFile $ArchivePath
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

function Read-SecretText {
    param([string] $Prompt)
    $SecureValue = Read-Host $Prompt -AsSecureString
    $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    }
    finally {
        if ($Bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
        }
    }
}

function Resolve-KeytoolPath {
    $ResolvedJavaHome = Resolve-JavaHome
    if ($ResolvedJavaHome) {
        $Keytool = Join-Path $ResolvedJavaHome "bin\keytool.exe"
        if (Test-Path -LiteralPath $Keytool -PathType Leaf) {
            return $Keytool
        }
    }
    $Command = Get-Command keytool -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }
    return ""
}

function Test-AndroidKeystorePassword {
    param([string] $StorePassword)

    if (-not $StorePassword) {
        return $false
    }

    $Keytool = Resolve-KeytoolPath
    if (-not $Keytool) {
        throw "keytool.exe was not found. Set JAVA_HOME to a JDK/JBR or install Java before building Android releases."
    }

    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Keytool -list -keystore $env:MYPWDMG_ANDROID_KEYSTORE -storepass $StorePassword > $null 2>&1
        return $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}

function Get-AndroidKeystoreAliases {
    if (-not $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD) {
        return @()
    }
    $Keytool = Resolve-KeytoolPath
    if (-not $Keytool) {
        return @()
    }
    $Output = & $Keytool -list -keystore $env:MYPWDMG_ANDROID_KEYSTORE -storepass $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not list Android keystore aliases with keytool:" -ForegroundColor Yellow
        $Output | ForEach-Object { Write-Host $_ }
        return @()
    }
    $Aliases = @()
    foreach ($Line in $Output) {
        $Text = [string] $Line
        if ($Text -match '^\s*([^,\s]+)\s*,\s*.+(PrivateKeyEntry|trustedCertEntry)') {
            $Aliases += $Matches[1]
        }
    }
    return @($Aliases | Select-Object -Unique)
}

function Ensure-AndroidKeyAlias {
    $Aliases = @(Get-AndroidKeystoreAliases)
    if ($env:MYPWDMG_ANDROID_KEY_ALIAS) {
        if ($Aliases.Count -gt 0 -and $Aliases -notcontains $env:MYPWDMG_ANDROID_KEY_ALIAS) {
            Write-Host "Android signing alias '$env:MYPWDMG_ANDROID_KEY_ALIAS' was not found in the keystore." -ForegroundColor Yellow
            $env:MYPWDMG_ANDROID_KEY_ALIAS = ""
        } else {
            Write-Host "Android signing key alias: $($env:MYPWDMG_ANDROID_KEY_ALIAS)"
            return
        }
    }
    if ($env:MYPWDMG_ANDROID_KEY_ALIAS) {
        return
    }
    if ($Aliases.Count -eq 1) {
        $env:MYPWDMG_ANDROID_KEY_ALIAS = $Aliases[0]
        Write-Host "Android signing key alias: $($env:MYPWDMG_ANDROID_KEY_ALIAS)"
        return
    }
    if ($Aliases.Count -gt 1 -and -not [Console]::IsInputRedirected) {
        Write-Host "Android signing aliases found:"
        for ($Index = 0; $Index -lt $Aliases.Count; $Index += 1) {
            Write-Host "  [$($Index + 1)] $($Aliases[$Index])"
        }
        $Choice = (Read-Host "Choose alias number or enter alias").Trim()
        $ChoiceIndex = 0
        if ([int]::TryParse($Choice, [ref] $ChoiceIndex) -and $ChoiceIndex -ge 1 -and $ChoiceIndex -le $Aliases.Count) {
            $env:MYPWDMG_ANDROID_KEY_ALIAS = $Aliases[$ChoiceIndex - 1]
            return
        }
        if ($Choice) {
            $env:MYPWDMG_ANDROID_KEY_ALIAS = $Choice
        }
        return
    }
    if (-not [Console]::IsInputRedirected) {
        $Alias = (Read-Host "Android signing key alias").Trim()
        if ($Alias) {
            $env:MYPWDMG_ANDROID_KEY_ALIAS = $Alias
        }
    }
}

function Ensure-AndroidSigningEnvironment {
    if (-not $ShouldIncludeAndroid -or $SkipAndroidBuild) {
        return
    }

    if (-not $env:MYPWDMG_ANDROID_KEYSTORE) {
        $env:MYPWDMG_ANDROID_KEYSTORE = $DefaultAndroidKeystore
    }
    if (-not (Test-Path -LiteralPath $env:MYPWDMG_ANDROID_KEYSTORE -PathType Leaf)) {
        throw "Android signing keystore was not found: $env:MYPWDMG_ANDROID_KEYSTORE"
    }

    if (-not $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD -and -not [Console]::IsInputRedirected) {
        $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD = Read-SecretText "Android keystore password"
    }
    if (-not (Test-AndroidKeystorePassword $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD)) {
        if ([Console]::IsInputRedirected) {
            throw "Android keystore password is incorrect for $env:MYPWDMG_ANDROID_KEYSTORE. Set MYPWDMG_ANDROID_KEYSTORE_PASSWORD to the correct value and try again."
        }

        Write-Host "Android keystore password was rejected by keytool." -ForegroundColor Yellow
        $RetryCount = 0
        while ($RetryCount -lt 2 -and -not (Test-AndroidKeystorePassword $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD)) {
            $RetryCount += 1
            $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD = Read-SecretText "Android keystore password"
        }
        if (-not (Test-AndroidKeystorePassword $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD)) {
            throw "Android keystore password is incorrect for $env:MYPWDMG_ANDROID_KEYSTORE."
        }
    }
    Ensure-AndroidKeyAlias
    if (-not $env:MYPWDMG_ANDROID_KEY_PASSWORD -and -not [Console]::IsInputRedirected) {
        $env:MYPWDMG_ANDROID_KEY_PASSWORD = Read-SecretText "Android key password (press Enter if same as keystore password)"
        if (-not $env:MYPWDMG_ANDROID_KEY_PASSWORD) {
            $env:MYPWDMG_ANDROID_KEY_PASSWORD = $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD
        }
    }

    $Missing = @()
    if (-not $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD) { $Missing += "MYPWDMG_ANDROID_KEYSTORE_PASSWORD" }
    if (-not $env:MYPWDMG_ANDROID_KEY_ALIAS) { $Missing += "MYPWDMG_ANDROID_KEY_ALIAS" }
    if (-not $env:MYPWDMG_ANDROID_KEY_PASSWORD) { $Missing += "MYPWDMG_ANDROID_KEY_PASSWORD" }
    if ($Missing.Count -gt 0) {
        throw "Android signing is missing: $($Missing -join ', '). Keystore is $env:MYPWDMG_ANDROID_KEYSTORE"
    }
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
    if ($SkipDesktopBuild) {
        Require-ReleaseFile $ArchivePath
        Write-Host "Skipping desktop build; using existing archive: $ArchivePath"
        return
    }

    $PackageArgs = @()
    if ($Clean) {
        $PackageArgs += "-Clean"
    }
    if ($SkipFrontend) {
        $PackageArgs += "-SkipFrontend"
    }
    if ($NoNativeHost) {
        $PackageArgs += "-NoNativeHost"
    }
    & $PackageScript @PackageArgs
    Assert-LastExitCode "Desktop package script"
    Ensure-DesktopArchive
}

function Invoke-AndroidPackage {
    if (-not $ShouldIncludeAndroid) {
        return
    }

    if (-not $SkipAndroidBuild) {
        Ensure-AndroidSigningEnvironment
        Push-Location (Join-Path $RootPath "android")
        try {
            $ResolvedJavaHome = Resolve-JavaHome
            if ($ResolvedJavaHome) {
                $env:JAVA_HOME = $ResolvedJavaHome
            }
            if (-not (Test-Path -LiteralPath (Split-Path -Parent $AndroidBuildLog) -PathType Container)) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $AndroidBuildLog) | Out-Null
            }
            & cmd.exe /c ".\gradlew.bat :app:assembleRelease --stacktrace --warning-mode all 2>&1" | Tee-Object -FilePath $AndroidBuildLog
            Assert-LastExitCodeWithLog "Android release build" $AndroidBuildLog
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
    Require-ReleaseFile $ArchivePath
    if ($ShouldIncludeAndroid) {
        Require-ReleaseFile $AndroidArchivePath
    }
    if ($ShouldIncludeAndroid) {
        & $ManifestScript `
            -Version $ReleaseVersion `
            -AssetUrl $Url `
            -AssetMirrorUrls $AssetMirrorUrls `
            -PackagePath $ArchivePath `
            -AndroidPackagePath $AndroidArchivePath `
            -AndroidAssetUrl $AndroidAssetUrl `
            -AndroidAssetMirrorUrls $AndroidAssetMirrorUrls `
            -AndroidVersionCode $NextVersionCode `
            -OutPath $ManifestPath `
            -Notes $Notes `
            -PrivateKeyPath $SigningPrivateKeyPath `
            -PythonExe $PythonExe
    }
    else {
        & $ManifestScript `
            -Version $ReleaseVersion `
            -AssetUrl $Url `
            -AssetMirrorUrls $AssetMirrorUrls `
            -PackagePath $ArchivePath `
            -OutPath $ManifestPath `
            -Notes $Notes `
            -PrivateKeyPath $SigningPrivateKeyPath `
            -PythonExe $PythonExe
    }
    Assert-LastExitCode "Update manifest script"
}

function Assert-SignedManifest {
    param([string] $Path)
    Require-ReleaseFile $Path
    $SigningPython = Resolve-ProjectPython
    Push-Location $RootPath
    try {
        & $SigningPython -m pwdmg_core.updater verify-manifest --input $Path
        Assert-LastExitCode "Update manifest signature verification"
    }
    finally {
        Pop-Location
    }
}

function Publish-GitHubRelease {
    param([string] $Repository, [string] $ReleaseVersion)
    Assert-SignedManifest $ManifestPath
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
$CurrentVersionCode = [Math]::Max($CurrentAndroidCode, $CurrentManifestCode)
$NextVersionCode = if ($VersionCode -gt 0) {
    $VersionCode
}
elseif ($NoVersionBump -and -not $Version.Trim()) {
    $CurrentVersionCode
}
else {
    $CurrentVersionCode + 1
}

if (-not $Repo.Trim()) {
    $Repo = Infer-GitHubRepo
}
$Repo = $Repo.Trim()

$AssetUrl = $AssetUrl.Trim()
$AssetMirrorUrls = $AssetMirrorUrls.Trim()
$AndroidAssetUrl = $AndroidAssetUrl.Trim()
$AndroidAssetMirrorUrls = $AndroidAssetMirrorUrls.Trim()
function Assert-GitHubReleaseUrlList {
    param([string] $Urls, [string] $Label)
    foreach ($Raw in ($Urls -split '[\s,;]+')) {
        $Value = $Raw.Trim()
        if ($Value -and -not ($Value -match '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[^/?#]+/[^/?#]+$')) {
            throw "$Label must contain only trusted GitHub Release asset URLs: $Value"
        }
    }
}
if (-not $PublishOnly) {
    if (-not $AssetUrl) {
        $AssetUrl = Build-AssetUrl $Repo $NextVersion
    }
    Assert-GitHubReleaseUrlList $AssetUrl "AssetUrl"
    Assert-GitHubReleaseUrlList $AssetMirrorUrls "AssetMirrorUrls"

    if ($ShouldIncludeAndroid -and -not $AndroidAssetUrl) {
        $AndroidAssetUrl = Build-AndroidAssetUrl $Repo $NextVersion
    }
    if ($ShouldIncludeAndroid) {
        Assert-GitHubReleaseUrlList $AndroidAssetUrl "AndroidAssetUrl"
        Assert-GitHubReleaseUrlList $AndroidAssetMirrorUrls "AndroidAssetMirrorUrls"
    }
}
if (-not $PublishOnly -and -not (Test-Path -LiteralPath $SigningPrivateKeyPath -PathType Leaf)) {
    throw "Update signing private key was not found: $SigningPrivateKeyPath. Generate it once with -GenerateSigningKey."
}

Write-Host "Release mode: $ReleaseMode"
Write-Host "Release version: $CurrentVersion -> $NextVersion"
Write-Host "Version code: $CurrentVersionCode -> $NextVersionCode"
Write-Host "GitHub repo: $(if ($Repo) { $Repo } else { '(not set)' })"
if ($AssetUrl) {
    Write-Host "Asset URL: $AssetUrl"
}
elseif ($PublishOnly) {
    Write-Host "Asset URL: existing manifest"
}
if ($AssetMirrorUrls) {
    Write-Host "Asset mirror URLs: $AssetMirrorUrls"
}
if ($ShouldIncludeAndroid -and $AndroidAssetUrl) {
    Write-Host "Android asset URL: $AndroidAssetUrl"
}
if ($ShouldIncludeAndroid -and $AndroidAssetMirrorUrls) {
    Write-Host "Android asset mirror URLs: $AndroidAssetMirrorUrls"
}
Write-Host "Desktop build: $(if ($SkipDesktopBuild) { 'skip, use existing zip' } else { 'enabled' })"
Write-Host "Native Host: $(if ($SkipDesktopBuild) { 'unchanged' } elseif ($NoNativeHost) { 'excluded' } else { 'included' })"
Write-Host "Clean desktop build: $(if ($Clean) { 'enabled' } else { 'disabled' })"
Write-Host "Frontend build: $(if ($SkipDesktopBuild) { 'unchanged' } elseif ($SkipFrontend) { 'skipped' } else { 'enabled' })"
Write-Host "Android package: $(if ($ShouldIncludeAndroid) { 'enabled' } else { 'desktop only' })"
if ($ShouldIncludeAndroid) {
    Write-Host "Android Gradle build: $(if ($SkipAndroidBuild) { 'skipped, use existing APK' } else { 'enabled' })"
    if (-not $SkipAndroidBuild) {
        $SummaryKeystore = if ($env:MYPWDMG_ANDROID_KEYSTORE) { $env:MYPWDMG_ANDROID_KEYSTORE } else { $DefaultAndroidKeystore }
        Write-Host "Android keystore: $SummaryKeystore"
    }
}
Write-Host "Publish GitHub Release: $(if ($ShouldPublish) { 'enabled' } else { 'disabled' })"
Write-Host "Manifest signing key: $(if ($PublishOnly) { 'verify existing manifest' } else { $SigningPrivateKeyPath })"

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
