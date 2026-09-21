param(
    [switch] $Clean,
    [switch] $SkipFrontend,
    [switch] $NoNativeHost,
    [switch] $NoExtension,
    [switch] $NoZip,
    [switch] $NoSetup,
    [switch] $Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Show-Help {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\build\package_desktop.ps1 [options]"
    Write-Host ""
    Write-Host "Builds the Rust + Tauri v2 desktop package, native host, browser extension, and NSIS setup."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Clean         Clean cargo target and release staging directories before building."
    Write-Host "  -SkipFrontend  Skip running npm build:desktop."
    Write-Host "  -NoNativeHost  Skip including My Password Host.exe in the package."
    Write-Host "  -NoExtension   Skip bundling browser extension in the package."
    Write-Host "  -NoZip         Skip creating the release zip archive."
    Write-Host "  -NoSetup       Skip creating the NSIS setup installer."
    Write-Host "  -Help          Show this help message."
}

if ($Help) {
    Show-Help
    exit 0
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RootPath = $Root.Path.TrimEnd("\")
$FrontDir = Join-Path $RootPath "front"
$SrcTauriDir = Join-Path $RootPath "src-tauri"
$ReleaseRoot = Join-Path $RootPath "release"
$StageDir = Join-Path $ReleaseRoot "desktop"
$ArchivePath = Join-Path $ReleaseRoot "MyPasswordDesktop-windows.zip"

$CargoToml = Get-Content (Join-Path $SrcTauriDir "Cargo.toml") -Raw
$Version = "2.0.56"
if ($CargoToml -match 'version\s*=\s*"([^"]+)"') {
    $Version = $matches[1]
}

Write-Host "==> Packaging My Password Manager v$Version (Rust + Tauri v2)" -ForegroundColor Cyan

if ($Clean) {
    Write-Host "Cleaning release and target directories..." -ForegroundColor Yellow
    if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
    if (Test-Path $ArchivePath) { Remove-Item $ArchivePath -Force }
    Push-Location $SrcTauriDir
    try {
        cargo clean
    } finally {
        Pop-Location
    }
}

# 1. Frontend Build
if (-not $SkipFrontend) {
    Write-Host "==> Building frontend assets..." -ForegroundColor Cyan
    Push-Location $FrontDir
    try {
        npm run build:desktop
    } finally {
        Pop-Location
    }
}

# 2. Rust Build
Write-Host "==> Compiling Rust binaries (Release mode)..." -ForegroundColor Cyan
Push-Location $SrcTauriDir
try {
    cargo build --release --workspace
} finally {
    Pop-Location
}

$ReleaseTargetDir = Join-Path $SrcTauriDir "target\release"
$GuiSrc = Join-Path $ReleaseTargetDir "my-password.exe"
$HostSrc = Join-Path $ReleaseTargetDir "my-password-host.exe"

if (-not (Test-Path $GuiSrc)) {
    throw "GUI binary not found at $GuiSrc"
}
if (-not $NoNativeHost -and -not (Test-Path $HostSrc)) {
    throw "Host binary not found at $HostSrc"
}

# 3. Stage files
Write-Host "==> Staging desktop binaries..." -ForegroundColor Cyan
Get-Process -Name "My Password", "My Password Host", "my-password", "my-password-host" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
if (Test-Path $StageDir) {
    Remove-Item $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

$GuiDest = Join-Path $StageDir "My Password.exe"
Copy-Item $GuiSrc -Destination $GuiDest -Force
$GuiSize = (Get-Item $GuiDest).Length
$TotalUnpackedSize = $GuiSize

Write-Host ""
Write-Host ("  My Password.exe:      {0:N2} MB" -f ($GuiSize / 1MB)) -ForegroundColor Green

if (-not $NoNativeHost) {
    $HostDest = Join-Path $StageDir "My Password Host.exe"
    Copy-Item $HostSrc -Destination $HostDest -Force
    $HostSize = (Get-Item $HostDest).Length
    $TotalUnpackedSize += $HostSize
    Write-Host ("  My Password Host.exe: {0:N2} MB" -f ($HostSize / 1MB)) -ForegroundColor Green
}

if (-not $NoExtension) {
    $ExtSrcDir = Join-Path $RootPath "browser-extension"
    $ExtDestDir = Join-Path $StageDir "browser-extension"
    New-Item -ItemType Directory -Path $ExtDestDir -Force | Out-Null

    Get-ChildItem -Path $ExtSrcDir -File | Where-Object {
        $_.Name -ne "tests" -and -not $_.Name.StartsWith(".") -and -not $_.Name.EndsWith(".test.mjs")
    } | ForEach-Object {
        Copy-Item $_.FullName -Destination $ExtDestDir -Force
    }

    $ExtZipDest = Join-Path $StageDir "browser-extension.zip"
    if (Test-Path $ExtZipDest) { Remove-Item $ExtZipDest -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($ExtDestDir, $ExtZipDest, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Copy-Item $ExtZipDest -Destination (Join-Path $ReleaseRoot "browser-extension.zip") -Force

    $ExtZipSize = (Get-Item $ExtZipDest).Length
    $ExtFilesSum = (Get-ChildItem $ExtDestDir -Recurse | Measure-Object -Property Length -Sum).Sum
    $TotalUnpackedSize += $ExtFilesSum
    Write-Host ("  browser-extension/:   {0} files ({1:N2} KB)" -f (Get-ChildItem $ExtDestDir).Count, ($ExtFilesSum / 1KB)) -ForegroundColor Green
    Write-Host ("  browser-extension.zip:{0:N2} MB" -f ($ExtZipSize / 1MB)) -ForegroundColor Green
}

Write-Host ("  Total Unpacked Size:  {0:N2} MB" -f ($TotalUnpackedSize / 1MB)) -ForegroundColor Green

# 4. Create ZIP Archive
if (-not $NoZip) {
    Write-Host "==> Creating release archive: $ArchivePath..." -ForegroundColor Cyan
    if (Test-Path $ArchivePath) {
        Remove-Item $ArchivePath -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($StageDir, $ArchivePath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $ZipSize = (Get-Item $ArchivePath).Length
    $ZipHash = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLower()

    Write-Host ""
    Write-Host ("  Release ZIP Archive:  {0:N2} MB" -f ($ZipSize / 1MB)) -ForegroundColor Green
    Write-Host ("  SHA256:               {0}" -f $ZipHash) -ForegroundColor Yellow
}

# 5. Build NSIS Setup Installer
if (-not $NoSetup) {
    $MakeNsis = ""
    if (Get-Command "makensis" -ErrorAction SilentlyContinue) {
        $MakeNsis = (Get-Command "makensis").Source
    }
    elseif (Test-Path "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe") {
        $MakeNsis = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe"
    }
    elseif (Test-Path "C:\Program Files (x86)\NSIS\makensis.exe") {
        $MakeNsis = "C:\Program Files (x86)\NSIS\makensis.exe"
    }
    elseif (Test-Path "C:\Program Files\NSIS\makensis.exe") {
        $MakeNsis = "C:\Program Files\NSIS\makensis.exe"
    }

    if ($MakeNsis) {
        Write-Host "==> Creating NSIS setup installer..." -ForegroundColor Cyan
        $NsiScript = Join-Path $PSScriptRoot "installer.nsi"
        $SetupDest = Join-Path $ReleaseRoot "My Password-Setup.exe"
        if (Test-Path $SetupDest) { Remove-Item $SetupDest -Force }
        & $MakeNsis /DVERSION="$Version" /DSRCDIR="$StageDir" /DOUTFILE="$SetupDest" "$NsiScript" | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $SetupDest)) {
            $SetupSize = (Get-Item $SetupDest).Length
            $SetupHash = (Get-FileHash $SetupDest -Algorithm SHA256).Hash.ToLower()
            Write-Host ""
            Write-Host ("  NSIS Setup Installer: {0:N2} MB" -f ($SetupSize / 1MB)) -ForegroundColor Green
            Write-Host ("  Setup Path:           $SetupDest") -ForegroundColor Green
            Write-Host ("  SHA256:               {0}" -f $SetupHash) -ForegroundColor Yellow
        } else {
            Write-Host "Warning: makensis compilation failed with exit code $LASTEXITCODE" -ForegroundColor Yellow
        }
    } else {
        Write-Host "==> makensis not found, skipping NSIS setup generation." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "==> Packaging complete!" -ForegroundColor Cyan
