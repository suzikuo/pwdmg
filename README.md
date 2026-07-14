# My Password Manager

Three entry points share one encrypted local vault:

- `front/`: Vue 3 + Vite + Vant management UI.
- `main.py`: Windows pywebview shell that displays the built Vue UI and exposes local vault APIs.
- `browser-extension/`: Chrome/Edge extension for web login detection and filling.
- `android/`: Android WebView shell, shared vault bridge, and Autofill Service.

## Develop

```powershell
.\.env\Scripts\python.exe -m unittest discover tests
cd front
npm install
npm run build
cd ..
.\.env\Scripts\python.exe main.py
```

Running `npm run build` in `front/` builds all three frontend targets:

- `front/dist/android/` for the Android WebView shell.
- `front/dist/desktop/` for the pywebview desktop shell.
- `front/dist/web/` for the standalone browser frontend.

## Desktop Packaging

The packaged Windows desktop release is a multi-file windowed app:

- `My Password.exe`: the desktop GUI app.
- `_internal/`: Python runtime, dependencies, and built frontend assets.

The GUI build does not use the console subsystem, so double-clicking `My Password.exe` should not flash a black console window. It is also built as an onedir package instead of a onefile package, so Windows can start it without PyInstaller extracting the full app into a temporary directory on every launch.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1
```

Useful options:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 -Clean
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 -SkipFrontend
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 -NoNativeHost
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1 -NoZip
```

The desktop package includes `My Password Host.exe` by default, built from `native_host.spec` and staged next to `My Password.exe`. Use `-NoNativeHost` only when you intentionally want a GUI-only package.

## Desktop Updates

App updates use a small GitHub Release manifest. The default release command bumps the patch version, builds Windows + Android, writes the update manifest, and publishes a GitHub Release through GitHub CLI:

```powershell
.\scripts\release_desktop.ps1
```

Before the first publish, make sure GitHub CLI is installed/logged in and `origin` points to the GitHub repo:

```powershell
gh auth login
git remote -v
```

That command updates these version locations together:

- `pwdmg_core/version.py`
- `front/package.json`
- `front/package-lock.json`
- `android/app/build.gradle`
- `front/manifest.json`

It produces:

- `release\MyPasswordDesktop-windows.zip`
- `release\update-manifest.json`
- `release\MyPasswordAndroid-release.apk`

The script creates a GitHub Release with tag `vX.Y.Z` and uploads all release files. The generated manifest points to the ghproxy URL:

```text
https://ghproxy.net/https://github.com/OWNER/REPO/releases/download/vX.Y.Z/MyPasswordDesktop-windows.zip
```

Android reads `assets.android` from the same `update-manifest.json`, downloads the APK, verifies SHA256, and opens the system installer. Android does not allow silent self-replacement; the user must confirm installation in the system installer. On Android 8+, the app may first ask for the "install unknown apps" permission for this app.

Useful release variants:

```powershell
.\scripts\release_desktop.ps1 -Bump minor
.\scripts\release_desktop.ps1 -Version 2.1.0
.\scripts\release_desktop.ps1 -NoVersionBump
.\scripts\release_desktop.ps1 -DesktopOnly
.\scripts\release_desktop.ps1 -NoPublish
.\scripts\release_desktop.ps1 -NoVersionBump -PublishOnly
.\scripts\release_desktop.ps1 -JavaHome "D:\android studio\jbr"
```

If the repo cannot be inferred from `git remote`, pass it explicitly with `-Repo OWNER/REPO`.

If packaging succeeded but publishing failed because GitHub CLI was missing, install/log in to GitHub CLI and publish the existing files without rebuilding:

```powershell
gh auth login
.\scripts\release_desktop.ps1 -NoVersionBump -PublishOnly
```

The lower-level manual steps are still available:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_desktop.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\write_update_manifest.ps1 `
  -Version 2.0.1 `
  -AssetUrl "https://ghproxy.net/https://github.com/OWNER/REPO/releases/download/v2.0.1/MyPasswordDesktop-windows.zip"
```

In the desktop app, open `更新` and check/download/install. The manifest URL defaults to `https://ghproxy.net/https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json`, so a published release can be discovered without typing a version-specific URL. The app verifies the desktop zip SHA256 from the manifest before it can be installed. Auto install is only enabled in packaged Windows builds; development mode can still check/download.

If GitHub release downloads are slow in your network, you can still pass additional mirror URLs when writing the manifest. New clients read `urls` first and fall back to `url`; old clients keep using `url`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\write_update_manifest.ps1 `
  -Version 2.0.1 `
  -AssetUrl "https://github.com/OWNER/REPO/releases/download/v2.0.1/MyPasswordDesktop-windows.zip" `
  -AssetMirrorUrls "https://cdn.example.com/MyPasswordDesktop-windows.zip" `
  -AndroidPackagePath ".\release\MyPasswordAndroid-release.apk" `
  -AndroidAssetUrl "https://github.com/OWNER/REPO/releases/download/v2.0.1/MyPasswordAndroid-release.apk" `
  -AndroidAssetMirrorUrls "https://cdn.example.com/MyPasswordAndroid-release.apk"
```

The update package is still verified by SHA256, so mirrors may serve the bytes while GitHub remains the canonical release location. The manifest URL field in the app can also contain multiple manifest candidates separated by commas, semicolons, or whitespace.

For Windows desktop, the update zip contains the multi-file app contents. During install, the app exits, the updater expands the zip, copies the unpacked files over the current install directory, and restarts `My Password.exe`.

In the Android app, use the same default `update-manifest.json` URL. The app verifies the APK SHA256 before opening the Android package installer.

## Browser Extension

1. Load `browser-extension/` as an unpacked Chrome/Edge extension.
2. Copy the extension ID.
3. Open the desktop app, go to `设置 -> 插件监听`, paste the extension ID, and click `开启插件监听`.

The desktop app writes the Native Messaging manifest under `~/mypwdmg/native-host/` and registers it for the current Windows user. Chrome/Edge will start the host on demand; you do not need to manually run a background script.
Turning plugin listening off removes the browser registration and writes a local disabled flag. Already-running native host connections check that flag before every request, so they stop returning fill data immediately.

For packaged releases, Native Messaging uses a separate `My Password Host.exe` next to `My Password.exe`. The default desktop package includes it automatically, while the desktop GUI no longer handles `--native-host`.

The old PowerShell registration script is still available as a development fallback:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_native_host.ps1 -ExtensionId YOUR_EXTENSION_ID
```

The extension popup unlocks the native host separately from the desktop window. This keeps the page content script from ever collecting the master password.

If the extension reports `Error when communicating with the native messaging host`, first verify the local Python environment:

```powershell
.\.env\Scripts\python.exe -c "import cryptography; import webview; import pwdmg_core.native_host"
```

Startup errors from Chrome/Edge are written to `native-host\native-host-error.log`.

## Android

Run `npm run build` in `front/`, then open `android/` in Android Studio. The WebView loads `front/dist/android/` and talks to `AndroidPasswordBridge`; Autofill reads the same encrypted `vault.json` envelope from the app private directory.

For public releases, keep `pwdmg-release.jks` in the project root or override the path with `MYPWDMG_ANDROID_KEYSTORE`. Set the signing passwords and alias before building:

```powershell
$env:MYPWDMG_ANDROID_KEYSTORE_PASSWORD="..."
$env:MYPWDMG_ANDROID_KEY_ALIAS="mypwdmg"
$env:MYPWDMG_ANDROID_KEY_PASSWORD="..."
```

## Vault

The vault is stored at:

```text
~/mypwdmg/vault.json
```

It uses PBKDF2-HMAC-SHA256 and AES-256-GCM. Legacy data from `~/mypwdmg/localStorage_data.json` is migrated on first vault creation when selected.

## Cloud Backup

The backup page uploads/downloads the encrypted `vault.json` envelope through a small frontend OSS client. It does not use a Python or Node OSS SDK, so the same Vue code can be reused by the desktop shell and Android WebView shell.

For Aliyun OSS, configure Bucket, AccessKey, AccessKey Secret, Region, and the object name in the app. The bucket must allow browser CORS requests for `GET`, `PUT`, `HEAD` and the `Authorization`, `Content-Type`, `x-oss-date` headers.

Downloading a backup overwrites the local vault, but the app first saves a local safety copy under `~/mypwdmg/backups/`. Only the latest 5 safety copies are kept.

## Public Repository Safety

The source repository can be public, but do not commit personal runtime data or signing secrets:

- real `vault.json`, `localStorage_data.json`, local backups, or `~/mypwdmg` files
- Aliyun OSS AccessKey / AccessKey Secret values
- Android release keystores (`*.jks`, `*.keystore`) or store passwords
- GitHub tokens, CI secrets, or generated release archives

The checked-in `android/app/debug.keystore` is only for local debug/development. Do not use it as the signing identity for APKs you distribute.
