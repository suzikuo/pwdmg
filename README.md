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

## Browser Extension

1. Load `browser-extension/` as an unpacked Chrome/Edge extension.
2. Copy the extension ID.
3. Open the desktop app, go to `设置 -> 插件监听`, paste the extension ID, and click `开启插件监听`.

The desktop app writes the Native Messaging manifest under `~/mypwdmg/native-host/` and registers it for the current Windows user. Chrome/Edge will start the host on demand; you do not need to manually run a background script.
Turning plugin listening off removes the browser registration and writes a local disabled flag. Already-running native host connections check that flag before every request, so they stop returning fill data immediately.

When packaging the desktop app as a single exe, keep the console subsystem enabled so Native Messaging has working stdio. The app hides the console window during normal GUI startup, while `My Password.exe --native-host` keeps stdio for Chrome/Edge.

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
