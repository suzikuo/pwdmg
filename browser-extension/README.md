# Browser Extension

1. Build/run the desktop app once and create the vault.
2. Open Chrome or Edge extension management.
3. Enable developer mode and load this `browser-extension` folder as an unpacked extension.
4. Copy the generated extension ID.
5. Open the desktop app, go to `设置 -> 插件监听`, paste the extension ID, and click `开启插件监听`.

The app registers a Native Messaging host for the current Windows user. Chrome/Edge starts that host on demand, so do not manually run `mypwdmg_native_host.cmd` in a terminal.
When plugin listening is turned off in the desktop app, existing native host connections stop returning fill data immediately. Reloading the browser extension is only needed to clear any old extension UI state.

Manual development fallback:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_native_host.ps1 -ExtensionId YOUR_EXTENSION_ID
```

The extension only detects and fills web forms. Password data stays in the encrypted local vault and is read through the native host. If the vault has an empty master password, the popup will try an empty-password unlock automatically. If the vault has a password, click the toolbar icon and unlock it first.

## Troubleshooting

If Chrome/Edge shows `Error when communicating with the native messaging host`, check:

1. The extension ID used by `install_native_host.ps1` is the current unpacked extension ID.
2. `.env\Scripts\python.exe` can start and import dependencies:

```powershell
.\.env\Scripts\python.exe -c "import cryptography; import webview; import pwdmg_core.native_host"
```

3. Native host startup errors are written to:

```text
native-host\native-host-error.log
```

Native Messaging uses stdout for framed JSON messages. Do not add `echo`, `print`, or other stdout output to the native host launcher or Python host.
