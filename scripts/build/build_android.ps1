param(
    [string] $JavaHome = "",
    [switch] $Debug,
    [string] $KeystorePassword = "",
    [string] $KeyAlias = "mypwdmg",
    [string] $KeyPassword = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$AndroidDir = Join-Path $Root "android"
$ReleaseDir = Join-Path $Root "release"

if (-not $JavaHome.Trim()) {
    $Candidates = @(
        $env:JAVA_HOME,
        "D:\android studio\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Android\Android Studio\jre"
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path -LiteralPath (Join-Path $Candidate "bin\java.exe") -PathType Leaf)) {
            $JavaHome = $Candidate
            break
        }
    }
}

if ($JavaHome.Trim()) {
    $env:JAVA_HOME = $JavaHome.Trim()
}

Push-Location $AndroidDir
try {
    if ($Debug) {
        Write-Host "==> Building Android Debug APK..." -ForegroundColor Cyan
        cmd.exe /c ".\gradlew.bat :app:assembleDebug"
        if ($LASTEXITCODE -ne 0) {
            throw "Android debug build failed with exit code $LASTEXITCODE"
        }
        $DebugApk = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
        if (Test-Path $DebugApk) {
            if (-not (Test-Path $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir | Out-Null }
            Copy-Item $DebugApk -Destination (Join-Path $ReleaseDir "MyPasswordAndroid-debug.apk") -Force
            Write-Host "==> Debug APK copied to release/MyPasswordAndroid-debug.apk" -ForegroundColor Green
        }
    } else {
        if ($KeystorePassword) {
            $env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD = $KeystorePassword
            $env:MYPWDMG_ANDROID_KEY_ALIAS = $KeyAlias
            $env:MYPWDMG_ANDROID_KEY_PASSWORD = if ($KeyPassword) { $KeyPassword } else { $KeystorePassword }
        }
        $DefaultKeystore = Join-Path $Root "pwdmg-release.jks"
        if (-not $env:MYPWDMG_ANDROID_KEYSTORE) {
            $env:MYPWDMG_ANDROID_KEYSTORE = $DefaultKeystore
        }

        Write-Host "==> Building Android Release APK..." -ForegroundColor Cyan
        cmd.exe /c ".\gradlew.bat :app:assembleRelease"
        if ($LASTEXITCODE -ne 0) {
            throw "Android release build failed with exit code $LASTEXITCODE"
        }
        $ReleaseApk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
        if (Test-Path $ReleaseApk) {
            if (-not (Test-Path $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir | Out-Null }
            Copy-Item $ReleaseApk -Destination (Join-Path $ReleaseDir "MyPasswordAndroid-release.apk") -Force
            Write-Host "==> Release APK copied to release/MyPasswordAndroid-release.apk" -ForegroundColor Green
        }
    }
    Write-Host "==> Android build completed successfully!" -ForegroundColor Green
} finally {
    Pop-Location
}
