param(
    [switch] $Clean,
    [switch] $SkipFrontend,
    [switch] $WithSeparateHost,
    [switch] $SkipHost,
    [switch] $NoZip,
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Help {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Clean             Remove PyInstaller build outputs before packaging."
    Write-Host "  -SkipFrontend      Do not run npm build before PyInstaller."
    Write-Host "  -WithSeparateHost  Also build My Password Host.exe from native_host.spec."
    Write-Host "  -SkipHost          Legacy alias: do not build a separate Host exe."
    Write-Host "  -NoZip             Do not create release\MyPasswordDesktop-windows.zip."
    Write-Host "  -Help              Show this help."
}

if ($Help) {
    Show-Help
    exit 0
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootPath = $Root.Path.TrimEnd("\")
$FrontDir = Join-Path $RootPath "front"
$DistDir = Join-Path $RootPath "dist"
$BuildDir = Join-Path $RootPath "build"
$ReleaseRoot = Join-Path $RootPath "release"
$StageDir = Join-Path $ReleaseRoot "desktop"
$ArchivePath = Join-Path $ReleaseRoot "MyPasswordDesktop-windows.zip"
$GuiExe = Join-Path $DistDir "My Password.exe"
$HostExe = Join-Path $DistDir "My Password Host.exe"
$BuildSeparateHost = $WithSeparateHost -and -not $SkipHost

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

function Invoke-Step {
    param([string] $Title, [scriptblock] $Action)
    Write-Host ""
    Write-Host "==> $Title"
    & $Action
}

function Resolve-PyInstaller {
    $Candidates = @(
        (Join-Path $RootPath ".env\Scripts\pyinstaller.exe"),
        (Join-Path $RootPath ".venv\Scripts\pyinstaller.exe")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }
    throw "PyInstaller was not found. Install dependencies into .env or .venv first."
}

Require-File (Join-Path $RootPath "main.spec") "main.spec was not found."
if ($BuildSeparateHost) {
    Require-File (Join-Path $RootPath "native_host.spec") "native_host.spec was not found."
}

$PyInstaller = Resolve-PyInstaller

if ($Clean) {
    Invoke-Step "Cleaning build outputs" {
        Remove-InRepo $BuildDir
        Remove-InRepo $StageDir
        if (Test-Path -LiteralPath $GuiExe) {
            Remove-Item -LiteralPath $GuiExe -Force
        }
        if (Test-Path -LiteralPath $HostExe) {
            Remove-Item -LiteralPath $HostExe -Force
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
    Push-Location $RootPath
    try {
        & $PyInstaller --noconfirm main.spec
    }
    finally {
        Pop-Location
    }
}

if ($BuildSeparateHost) {
    Invoke-Step "Building browser Native Messaging host executable" {
        Push-Location $RootPath
        try {
            & $PyInstaller --noconfirm native_host.spec
        }
        finally {
            Pop-Location
        }
    }
}

Require-File $GuiExe "Desktop GUI exe was not produced: $GuiExe"
if ($BuildSeparateHost) {
    Require-File $HostExe "Native Host exe was not produced: $HostExe"
}

Invoke-Step "Staging desktop release" {
    Remove-InRepo $StageDir
    if (-not (Test-Path -LiteralPath $ReleaseRoot)) {
        New-Item -ItemType Directory -Path $ReleaseRoot | Out-Null
    }
    New-Item -ItemType Directory -Path $StageDir | Out-Null
    Copy-Item -LiteralPath $GuiExe -Destination $StageDir
    if ($BuildSeparateHost) {
        Copy-Item -LiteralPath $HostExe -Destination $StageDir
    }
    Copy-Item -LiteralPath (Join-Path $RootPath "browser-extension") -Destination (Join-Path $StageDir "browser-extension") -Recurse
    Copy-Item -LiteralPath (Join-Path $RootPath "README.md") -Destination $StageDir
    $Notes = @(
        "My Password desktop package",
        "",
        "Files:",
        "- My Password.exe: desktop app and Chrome/Edge Native Messaging host (`--native-host`)",
        "- browser-extension/: unpacked browser extension",
        "",
        "The desktop app registers a launcher that runs `My Password.exe --native-host` when plugin listening is enabled."
    )
    if ($BuildSeparateHost) {
        $Notes = $Notes + @(
            "",
            "Optional separate-host build:",
            "- My Password Host.exe: standalone Native Messaging host built from native_host.spec."
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
