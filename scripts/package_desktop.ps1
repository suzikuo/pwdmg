param(
    [switch] $Clean,
    [switch] $SkipFrontend,
    [Alias("WithSeparateHost")]
    [switch] $IncludeNativeHost,
    [Alias("SkipHost")]
    [switch] $NoNativeHost,
    [switch] $NoZip,
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Help {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 [options]"
    Write-Host ""
    Write-Host "Builds a multi-file Windows desktop GUI package, and includes Native Host by default."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Clean             Remove PyInstaller build outputs before packaging."
    Write-Host "  -SkipFrontend      Do not run npm build before PyInstaller."
    Write-Host "  -IncludeNativeHost  Build My Password Host.exe from native_host.spec."
    Write-Host "  -NoNativeHost       Skip building My Password Host.exe."
    Write-Host "  -NoZip             Do not create release\MyPasswordDesktop-windows.zip."
    Write-Host "  -Help              Show this help."
}

if ($Help) {
    Show-Help
    exit 0
}

if ($NoNativeHost) {
    $IncludeNativeHost = $false
}
elseif (-not $PSBoundParameters.ContainsKey('IncludeNativeHost')) {
    $IncludeNativeHost = $true
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootPath = $Root.Path.TrimEnd("\")
$FrontDir = Join-Path $RootPath "front"
$DistDir = Join-Path $RootPath "dist"
$BuildDir = Join-Path $RootPath "build"
$ReleaseRoot = Join-Path $RootPath "release"
$StageDir = Join-Path $ReleaseRoot "desktop"
$ArchivePath = Join-Path $ReleaseRoot "MyPasswordDesktop-windows.zip"
$NativeHostSpec = Join-Path $RootPath "native_host.spec"
$GuiDistDir = Join-Path $DistDir "My Password"
$GuiExe = Join-Path $GuiDistDir "My Password.exe"
$LegacyGuiExe = Join-Path $DistDir "My Password.exe"
$OptionalHostExe = Join-Path $DistDir "My Password Host.exe"

function Assert-InRepo {
    param([string] $Path)
    $Full = [System.IO.Path]::GetFullPath($Path)
    if ($Full -ne $RootPath -and -not $Full.StartsWith($RootPath + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside repo: $Full"
    }
    return $Full
}

function Remove-InRepo {
    param([string] $Path)
    $Full = Assert-InRepo $Path
    if (Test-Path -LiteralPath $Full) {
        Remove-Item -LiteralPath $Full -Recurse -Force
    }
}

function Require-File {
    param([string] $Path, [string] $Message)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw $Message
    }
}

function Require-Directory {
    param([string] $Path, [string] $Message)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw $Message
    }
}

function Invoke-Step {
    param([string] $Title, [scriptblock] $Action)
    Write-Host ""
    Write-Host "==> $Title"
    & $Action
}

function Assert-LastExitCode {
    param([string] $Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

function Test-Executable {
    param([string] $Path, [string[]] $Arguments)
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Path @Arguments > $null 2>&1
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}

function Resolve-PyInstaller {
    $Candidates = @(
        (Join-Path $RootPath ".env\Scripts\pyinstaller.exe"),
        (Join-Path $RootPath ".venv\Scripts\pyinstaller.exe")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            if (Test-Executable $Candidate @("--version")) {
                return $Candidate
            }
        }
    }
    $PathCommand = Get-Command pyinstaller -ErrorAction SilentlyContinue
    if ($PathCommand -and $PathCommand.Source -and (Test-Executable $PathCommand.Source @("--version"))) {
        return $PathCommand.Source
    }
    throw "A working PyInstaller was not found. Recreate .env or .venv with Python 3.11 and install requirements.txt first."
}

Require-File (Join-Path $RootPath "main.spec") "main.spec was not found."
if ($IncludeNativeHost) {
    Require-File $NativeHostSpec "native_host.spec was not found."
}

$PyInstaller = Resolve-PyInstaller

if ($Clean) {
    Invoke-Step "Cleaning build outputs" {
        Remove-InRepo $BuildDir
        Remove-InRepo $StageDir
        Remove-InRepo $GuiDistDir
        if (Test-Path -LiteralPath $LegacyGuiExe) {
            Remove-Item -LiteralPath $LegacyGuiExe -Force
        }
        if (Test-Path -LiteralPath $OptionalHostExe) {
            Remove-Item -LiteralPath $OptionalHostExe -Force
        }
        if (Test-Path -LiteralPath $GuiExe) {
            Remove-Item -LiteralPath $GuiExe -Force
        }
        if (Test-Path -LiteralPath $ArchivePath) {
            Remove-Item -LiteralPath $ArchivePath -Force
        }
    }
}

if (-not $SkipFrontend) {
    Invoke-Step "Building frontend assets" {
        Push-Location $FrontDir
        try {
            npm run build
        }
        finally {
            Pop-Location
        }
    }
}

Invoke-Step "Building desktop GUI executable" {
    Remove-InRepo $GuiDistDir
    if (Test-Path -LiteralPath $LegacyGuiExe) {
        Remove-Item -LiteralPath $LegacyGuiExe -Force
    }
    Push-Location $RootPath
    try {
        & $PyInstaller --noconfirm main.spec
        Assert-LastExitCode "Desktop GUI build"
    }
    finally {
        Pop-Location
    }
}

if ($IncludeNativeHost) {
    Invoke-Step "Building browser Native Messaging host executable" {
        Push-Location $RootPath
        try {
            & $PyInstaller --noconfirm native_host.spec
            Assert-LastExitCode "Native host build"
        }
        finally {
            Pop-Location
        }
    }
}

Require-Directory $GuiDistDir "Desktop GUI directory was not produced: $GuiDistDir"
Require-File $GuiExe "Desktop GUI exe was not produced: $GuiExe"
if ($IncludeNativeHost) {
    Require-File $OptionalHostExe "Native host exe was not produced: $OptionalHostExe"
}

Invoke-Step "Staging desktop release" {
    Remove-InRepo $StageDir
    if (-not (Test-Path -LiteralPath $ReleaseRoot)) {
        New-Item -ItemType Directory -Path $ReleaseRoot | Out-Null
    }
    New-Item -ItemType Directory -Path $StageDir | Out-Null
    Copy-Item -Path (Join-Path $GuiDistDir "*") -Destination $StageDir -Recurse -Force
    $IncludesHostExe = $IncludeNativeHost -and (Test-Path -LiteralPath $OptionalHostExe -PathType Leaf)
    if ($IncludesHostExe) {
        Copy-Item -LiteralPath $OptionalHostExe -Destination $StageDir -Force
    }
    Copy-Item -LiteralPath (Join-Path $RootPath "browser-extension") -Destination (Join-Path $StageDir "browser-extension") -Recurse
    Copy-Item -LiteralPath (Join-Path $RootPath "README.md") -Destination $StageDir
    $Notes = @(
        "My Password desktop package",
        "",
        "Files:",
        "- My Password.exe: desktop GUI app",
        "- _internal/: Python runtime, dependencies, and frontend assets used by the GUI",
        "- browser-extension/: unpacked browser extension",
        "",
        "This is a multi-file package. Keep My Password.exe and _internal together."
    )
    if ($IncludesHostExe) {
        $Notes = $Notes + @(
            "",
            "Native Messaging:",
            "- My Password Host.exe: standalone browser Native Messaging host."
        )
    }
    Set-Content -LiteralPath (Join-Path $StageDir "PACKAGE_README.txt") -Value $Notes -Encoding UTF8
}

if (-not $NoZip) {
    Invoke-Step "Creating release archive" {
        if (-not (Test-Path -LiteralPath $ReleaseRoot)) {
            New-Item -ItemType Directory -Path $ReleaseRoot | Out-Null
        }
        if (Test-Path -LiteralPath $ArchivePath) {
            Remove-Item -LiteralPath $ArchivePath -Force
        }
        Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ArchivePath -Force
        Require-File $ArchivePath "Release archive was not produced: $ArchivePath"
    }
}

Write-Host ""
Write-Host "Desktop package is ready:"
Write-Host "  $StageDir"
if (-not $NoZip) {
    Write-Host "  $ArchivePath"
    Write-Host ""
    Write-Host "Next update-manifest step:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\write_update_manifest.ps1 -Version <version> -AssetUrl <github-release-zip-url>"
}
