# My Password Manager

Three entry points share one encrypted local vault:

- `front/`: Vue 3 + Vite + Vant management UI.
- `src-tauri/`: Windows Rust + Tauri v2 shell and high-performance native host.
- `browser-extension/`: Chrome/Edge extension for web login detection and filling.
- `android/`: Android WebView shell, shared vault bridge, and Autofill Service.

## Quick Start (统一控制中心)

项目根目录提供了全能交互式控制脚本 `run.ps1`，支持一键选择开发、打包、测试与发布：

```powershell
# 启动交互式控制菜单
.\run.ps1
```

你也可以通过命令行参数直接执行对应任务：

```powershell
.\run.ps1 -Task test       # 运行全套测试 (Frontend + Extension + Rust)
.\run.ps1 -Task package    # 构建并打包桌面端绿色包与 ZIP
.\run.ps1 -Task dev        # 启动桌面端调试
.\run.ps1 -Task clean      # 清理项目编译缓存
```

## Develop

### Prerequisites
- Node.js 18+ (tested on Node v20+)
- Rust 1.80+ (tested on Rust 1.98+)

```powershell
# 1. 安装前端依赖并构建资源
cd front
npm install
npm run build
cd ..

# 2. 运行 Rust 核心测试
cargo test --workspace --manifest-path src-tauri/Cargo.toml

# 3. 运行前端测试
npm --prefix front test

# 4. 运行浏览器扩展测试
node --test browser-extension/tests/*.test.js

# 5. 启动桌面端开发模式
cargo run --manifest-path src-tauri/Cargo.toml
```

Running `npm run build` in `front/` builds all three frontend targets:

- `front/dist/android/` for the Android WebView shell.
- `front/dist/desktop/` for the Tauri desktop shell.
- `front/dist/web/` for the standalone browser frontend.

## Desktop Packaging

The Windows desktop app is built with Rust and Tauri v2:

- `My Password.exe`: Native Windows GUI application (~7.1 MB).
- `My Password Host.exe`: Native Messaging stdio host for Chrome and Edge (~1.4 MB).
- **Total unpacked package size**: ~8.55 MB (down from ~50 MB in previous Python/PyInstaller builds, an 83% reduction).
- **Total compressed zip size**: ~3.59 MB.

Package both binaries and generate the distribution zip archive with:

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

The desktop package includes `My Password Host.exe` by default. Use `-NoNativeHost` only when you intentionally want a GUI-only package.

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

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/crates/core/Cargo.toml`
- `src-tauri/crates/native_host/Cargo.toml`
- `front/package.json`
- `front/package-lock.json`
- `android/app/build.gradle`
- `front/manifest.json`

It produces:

- `release\MyPasswordDesktop-windows.zip`
- `release\update-manifest.json`
- `release\MyPasswordAndroid-release.apk`

The script creates a GitHub Release with tag `vX.Y.Z` and uploads all release files. The generated manifest points to the release URL:

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

## Browser Extension

1. Load `browser-extension/` as an unpacked Chrome/Edge extension.
2. Copy the extension ID.
3. Open the desktop app, go to `设置 -> 插件监听`, paste the extension ID, and click `开启插件监听`.

The desktop app writes the Native Messaging manifest under `~/mypwdmg/native-host/` and registers it for the current Windows user. Chrome/Edge will start `My Password Host.exe` on demand; you do not need to manually run a background script.
Turning plugin listening off removes the browser registration and writes a local disabled flag. Already-running native host connections check that flag before every request, so they stop returning fill data immediately.

The PowerShell registration script is also available as a development fallback:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_native_host.ps1 -ExtensionId YOUR_EXTENSION_ID
```

The extension popup unlocks the native host separately from the desktop window. This keeps the page content script from ever collecting the master password.

When automatic saving is enabled, a detected login appears as a compact icon in the page's upper-right corner instead of opening the full panel. Click the icon to review/save or update the login; use the minus button or `Escape` to collapse it again. The capture state and filled-password suppression records expire automatically and are cleared when the page is left.

## Android

Run `npm run build` in `front/`, then open `android/` in Android Studio. The WebView loads `front/dist/android/` and talks to `AndroidPasswordBridge`; Autofill reads the same encrypted `vault.json` envelope from the app private directory.

On Android 14+, Passkey Provider is disabled by default. After unlocking the vault, open Settings > Android Passkey, turn on the provider switch, then choose `My Password` in the Android Credential Provider settings page. The app reports component availability separately from system selection: `待系统授权` means the component is on but Android has not selected it yet. Turning the switch off disables the provider component and clears pending in-process ceremony tickets; saved passkeys remain in the encrypted vault. The browser extension's WebAuthn proxy remains a developer-only probe and is not enabled by this setting.

Android stores encrypted attachment objects in the app-private directory, supports individual attachment export through the system document picker, and exposes reference-aware cleanup in Settings. The Backup page can export the current encrypted vault JSON, explicitly without attachment objects. The desktop complete backup package remains the attachment-inclusive backup/restore format.

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
