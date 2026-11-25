pub use crate::desktop_config::{
    configured_close_behavior, read_desktop_config, save_window_state, write_desktop_config,
};
use crate::desktop_update::{apply_desktop_update, download_desktop_update};
use crate::updater::VerifiedUpdate;
use pwdmg_core::api_error::api_error_code;
use pwdmg_core::attachment::AttachmentStore;
use pwdmg_core::clipboard::SecureClipboard;
use pwdmg_core::native_install::{
    disable_plugin_listener, enable_plugin_listener, plugin_listener_state,
};
use pwdmg_core::paths::{app_dir, attachment_dir, ensure_app_dir};
use pwdmg_core::portable::{
    export_portable_backup, import_portable_backup, inspect_portable_backup,
};
use pwdmg_core::vault::VaultService;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use url::Url;

pub const TRAY_ID: &str = "main-tray";
pub const DEFAULT_CLOSE_BEHAVIOR: &str = "exit";

pub struct DesktopState {
    pub vault: VaultService,
    pub attachments: AttachmentStore,
    pub clipboard: SecureClipboard,
    verified_update: Mutex<Option<VerifiedUpdate>>,
    pub portable_backup_selection: Mutex<Option<(String, PathBuf)>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        let _ = ensure_app_dir();
        Self {
            vault: VaultService::default(),
            attachments: AttachmentStore::new(attachment_dir()),
            clipboard: SecureClipboard::default(),
            verified_update: Mutex::new(None),
            portable_backup_selection: Mutex::new(None),
        }
    }
}

pub fn handle_api_call(state: &DesktopState, app: &AppHandle, method: &str, args: &[Value]) -> Value {
    let result = dispatch_api(state, app, method, args);
    match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(err) => json!({ "ok": false, "code": api_error_code(&err), "message": err }),
    }
}

fn parse_payload_arg(arg: Option<&Value>) -> Result<Value, String> {
    match arg {
        Some(v) if v.is_object() => Ok(v.clone()),
        Some(Value::String(s)) => {
            let parsed: Value = serde_json::from_str(s)
                .map_err(|_| "Invalid vault payload: expected an object".to_string())?;
            if !parsed.is_object() {
                return Err("Invalid vault payload: expected an object".to_string());
            }
            Ok(parsed)
        }
        _ => Err("Missing payload".to_string()),
    }
}

fn dispatch_api(
    state: &DesktopState,
    app: &AppHandle,
    method: &str,
    args: &[Value],
) -> Result<Value, String> {
    match method {
        "getAppInfo" => Ok(json!({
            "version": pwdmg_core::version(),
            "platform": "desktop",
            "packaged": true,
            "nativeVault": true,
        })),
        "getNativeDesktopCapabilities" => Ok(json!({
            "nativeVault": true,
            "trayLockEvent": "vault-locked",
            "quickUnlock": true,
            "secureClipboard": cfg!(windows),
        })),
        "copySensitiveText" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let clear_after_secs = args.get(1).and_then(|v| v.as_u64());
            let effective_secs = state.clipboard.copy_sensitive(text, clear_after_secs)?;
            Ok(json!({
                "copied": true,
                "clearAfterSeconds": effective_secs,
            }))
        }
        "clearSensitiveClipboard" => {
            let cleared = state.clipboard.clear_if_owned();
            Ok(json!({ "cleared": cleared }))
        }

        // Vault State & Storage
        "getState" => Ok(state.vault.state()),
        "getStorageState" => Ok(state.vault.storage_state()),
        "readVaultEnvelope" => state.vault.read_vault_envelope().map(Value::String),
        "writeVaultEnvelope" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let protect_backup = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            let expected_rev = args.get(2).and_then(|v| v.as_u64());
            state
                .vault
                .write_vault_envelope(text, protect_backup, expected_rev)
        }
        "readLegacyLocalStorage" => state.vault.read_legacy_local_storage().map(Value::String),
        "cleanupLegacyStorage" => {
            let expected_digest = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let expected_vault = args.get(1).and_then(|v| v.as_str());
            state
                .vault
                .cleanup_legacy_storage(expected_digest, expected_vault)
        }

        // Native Vault Operations (keys stay inside Rust memory)
        "createVault" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let import_legacy = args.get(1).and_then(|v| v.as_bool()).unwrap_or(true);
            state.vault.create_vault(password, import_legacy)
        }
        "unlock" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.unlock_with_payload(password)
        }
        "quickUnlock" => state.vault.quick_unlock_with_state(),
        "lock" => {
            state.clipboard.clear_if_owned();
            Ok(state.vault.lock())
        }
        "getVault" => state.vault.get_vault(),
        "saveVault" => {
            let payload = parse_payload_arg(args.first())?;
            let expected_rev = args.get(1).and_then(|v| v.as_u64());
            state.vault.save_vault(&payload, expected_rev)
        }
        "changePassword" => {
            if args.len() >= 2 {
                let current_password = args.first().and_then(|v| v.as_str()).unwrap_or("");
                let new_password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
                state
                    .vault
                    .change_password_verified(current_password, new_password)
            } else {
                let new_password = args.first().and_then(|v| v.as_str()).unwrap_or("");
                state.vault.change_password(new_password)
            }
        }
        "changePasswordVerified" => {
            let current_password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let new_password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            state
                .vault
                .change_password_verified(current_password, new_password)
        }
        "adoptEncryptionFromEnvelope" | "adoptVaultEncryptionFromEnvelope" => {
            let envelope_text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            state
                .vault
                .adopt_encryption_from_envelope(envelope_text, password)
        }
        "exportBackup" | "exportVaultBackup" => state.vault.export_backup(),
        "exportBackupForPayload" | "exportVaultBackupForPayload" => {
            let payload = parse_payload_arg(args.first())?;
            state.vault.export_backup_for_payload(&payload)
        }
        "previewBackup" | "previewVaultBackup" => {
            let envelope_text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.preview_backup(envelope_text)
        }
        "previewBackupWithPassword" | "previewVaultBackupWithPassword" => {
            let envelope_text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            state
                .vault
                .preview_backup_with_password(envelope_text, password)
        }
        "importBackup" | "importVaultBackup" => {
            let envelope_text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.import_backup_with_state(envelope_text)
        }

        // Attachment Store
        "getAttachmentStorageState" => Ok(serde_json::to_value(state.attachments.state()).unwrap()),
        "readAttachmentObject" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.attachments.read(id).map(Value::String)
        }
        "writeAttachmentObject" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let text = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            state.attachments.write(id, text)
        }
        "retainAttachmentObject" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let retained = state.attachments.retain(id)?;
            Ok(json!({ "attachmentId": id, "retained": retained }))
        }
        "collectAttachmentObjects" => {
            let referenced: Vec<String> = args
                .first()
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let (retained, deleted) = state.attachments.collect(&referenced)?;
            Ok(json!({ "retained": retained, "deleted": deleted }))
        }
        "saveAttachmentFile" => {
            let display_name = args
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or("attachment");
            let content_base64 = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            save_attachment_file_dialog(display_name, content_base64)
        }

        // Device Unlock (DPAPI)
        "getDeviceUnlockState" => Ok(state.vault.device_unlock_state()),
        "enableDeviceUnlock" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let reauth_seconds = args.get(1).and_then(|v| v.as_u64()).unwrap_or(0);
            state.vault.enable_device_unlock(password, reauth_seconds)
        }
        "disableDeviceUnlock" => state.vault.disable_device_unlock(),

        // Portable Backup
        "exportPortableBackupPackage" => {
            let default_name = format!(
                "mypwdmg-{}.mypwdmg-backup",
                chrono::Local::now().format("%Y%m%d-%H%M%S")
            );
            let downloads = directories::UserDirs::new()
                .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
                .unwrap_or_else(app_dir);
            let target_path = downloads.join(default_name);
            let res = export_portable_backup(&target_path)?;
            Ok(json!({ "saved": true, "path": res["path"] }))
        }
        "selectPortableBackupPackage" => {
            let downloads = directories::UserDirs::new()
                .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
                .unwrap_or_else(app_dir);

            let mut selection_guard = state.portable_backup_selection.lock().unwrap_or_else(|e| e.into_inner());
            *selection_guard = None;

            if let Some(path) = rfd::FileDialog::new()
                .add_filter("My Password Backup", &["mypwdmg-backup"])
                .set_directory(&downloads)
                .pick_file()
            {
                let inspected = inspect_portable_backup(&path)?;
                let token = uuid::Uuid::new_v4().to_string();
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy())
                    .unwrap_or_default();
                let package_bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
                let result = json!({
                    "selected": true,
                    "selectionToken": token,
                    "name": name,
                    "createdAt": inspected.get("createdAt").or_else(|| inspected.get("exportedAt")).and_then(Value::as_u64).unwrap_or_default(),
                    "attachmentCount": inspected.get("attachmentCount").and_then(Value::as_u64).unwrap_or_default(),
                    "packageBytes": package_bytes,
                    "manifest": inspected,
                });
                *selection_guard = Some((token, path));
                Ok(result)
            } else {
                Ok(json!({ "selected": false }))
            }
        }
        "importPortableBackupPackage" => {
            let selection_token = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let mut selection_guard = state.portable_backup_selection.lock().unwrap_or_else(|e| e.into_inner());
            match selection_guard.as_ref() {
                Some((token, path)) if token == selection_token => {
                    let mut result = import_portable_backup(path, password)?;
                    state.vault.lock();
                    result["state"] = state.vault.state();
                    *selection_guard = None;
                    Ok(result)
                }
                _ => Err("Portable backup selection has expired".to_string()),
            }
        }
        "discardPortableBackupSelection" => {
            let selection_token = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let mut selection_guard = state.portable_backup_selection.lock().unwrap_or_else(|e| e.into_inner());
            let discarded = match selection_guard.as_ref() {
                Some((token, _)) if token == selection_token => {
                    *selection_guard = None;
                    true
                }
                _ => false,
            };
            Ok(json!({ "discarded": discarded }))
        }

        // Plugin Listener
        "getPluginListenerState" => Ok(serde_json::to_value(plugin_listener_state()).unwrap()),
        "enablePluginListener" => {
            let extension_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let browsers: Option<Vec<String>> = args.get(1).and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(|str_val| str_val.to_string()))
                    .collect()
            });
            let state = enable_plugin_listener(extension_id, browsers.as_deref())?;
            Ok(serde_json::to_value(state).unwrap())
        }
        "disablePluginListener" => {
            let state = disable_plugin_listener()?;
            Ok(serde_json::to_value(state).unwrap())
        }

        // Desktop Tray Settings
        "getDesktopTraySettings" => {
            let cfg = read_desktop_config();
            let tray_enabled = cfg
                .get("tray_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let close_behavior = configured_close_behavior(&cfg);
            Ok(json!({
                "supported": true,
                "trayAvailable": app.tray_by_id(TRAY_ID).is_some(),
                "trayEnabled": tray_enabled,
                "closeBehavior": close_behavior
            }))
        }
        "setDesktopTraySettings" => {
            let tray_enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(true);
            let close_behavior = match args.get(1).and_then(|v| v.as_str()) {
                Some("minimize-to-tray") => "minimize-to-tray",
                _ => DEFAULT_CLOSE_BEHAVIOR,
            };
            let mut cfg = read_desktop_config();
            if let Some(obj) = cfg.as_object_mut() {
                obj.insert("tray_enabled".to_string(), json!(tray_enabled));
                obj.insert("close_behavior".to_string(), json!(close_behavior));
                obj.insert("close_behavior_user_set".to_string(), json!(true));
            }
            write_desktop_config(&cfg)?;
            Ok(json!({
                "supported": true,
                "trayAvailable": app.tray_by_id(TRAY_ID).is_some(),
                "trayEnabled": tray_enabled,
                "closeBehavior": close_behavior
            }))
        }

        // Updates
        "checkDesktopUpdate" => {
            let manifest_url = args.first().and_then(|v| v.as_str()).unwrap_or("");
            check_desktop_update(manifest_url)
        }
        "downloadDesktopUpdate" => {
            let manifest_url = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let mut verified = state
                .verified_update
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            download_desktop_update(manifest_url, &mut verified)
        }
        "applyDesktopUpdate" => {
            let package_path = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let mut verified = state
                .verified_update
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let result = apply_desktop_update(package_path, verified.as_ref())?;
            *verified = None;
            Ok(result)
        }

        // System actions
        "showWindow" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(json!(true))
        }
        "safeExit" => {
            state.clipboard.clear_if_owned();
            if let Some(w) = app.get_webview_window("main") {
                save_window_state(&w);
            }
            app.exit(0);
            Ok(json!(null))
        }
        "openExternalUrl" => {
            let url = args.first().and_then(|v| v.as_str()).unwrap_or("");
            open::that(external_url(url)?.as_str()).map_err(|e| e.to_string())?;
            Ok(json!(null))
        }

        _ => Err(format!("Invalid desktop API method: {}", method)),
    }
}

fn save_attachment_file_dialog(display_name: &str, content_base64: &str) -> Result<Value, String> {
    use base64::Engine;
    let data = base64::prelude::BASE64_STANDARD
        .decode(content_base64)
        .map_err(|e| format!("Invalid attachment content: {e}"))?;

    let file_name = Path::new(display_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment");
    if let Some(target) = rfd::FileDialog::new().set_file_name(file_name).save_file() {
        fs::write(&target, data).map_err(|e| e.to_string())?;
        Ok(json!({ "saved": true, "path": target.to_string_lossy() }))
    } else {
        Ok(json!({ "saved": false, "path": "" }))
    }
}

fn external_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid external URL")?;
    if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
        return Err("Invalid external URL: HTTP or HTTPS is required".to_string());
    }
    Ok(url)
}

fn check_desktop_update(manifest_url: &str) -> Result<Value, String> {
    crate::desktop_update::check_desktop_update(manifest_url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_update::compare_versions;
    use crate::updater::{confined_update_path, https_update_url, update_sha256};

    #[test]
    fn test_compare_versions() {
        assert_eq!(compare_versions("2.0.59", "2.0.56"), 1);
        assert_eq!(compare_versions("2.0.56", "2.0.59"), -1);
        assert_eq!(compare_versions("2.0.59", "2.0.59"), 0);
        assert_eq!(compare_versions("v2.1.0", "2.0.59"), 1);
    }

    #[test]
    fn close_behavior_defaults_to_exit_until_tray_stay_is_explicit() {
        assert_eq!(
            configured_close_behavior(&json!({
                "close_behavior": "minimize-to-tray"
            })),
            "exit"
        );
        assert_eq!(
            configured_close_behavior(&json!({
                "close_behavior": "minimize-to-tray",
                "close_behavior_user_set": true
            })),
            "minimize-to-tray"
        );
        assert_eq!(configured_close_behavior(&json!({})), "exit");
    }

    #[test]
    fn external_url_rejects_non_http_schemes() {
        assert!(external_url("https://example.com/login").is_ok());
        assert!(external_url("http://example.com").is_ok());
        assert!(external_url("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(external_url("cmd:/c calc").is_err());
        assert!(external_url(r"\\attacker\share\evil.exe").is_err());
        assert!(external_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn updater_enforces_https_sha256_and_directory_confinement() {
        assert!(
            https_update_url("https://github.com/owner/repo/releases/download/v1.0.0/app.zip")
                .is_ok()
        );
        assert!(
            https_update_url("http://github.com/owner/repo/releases/download/v1.0.0/app.zip")
                .is_err()
        );
        assert!(https_update_url("file:///C:/temp/app.zip").is_err());

        assert!(update_sha256("").is_err());
        assert!(update_sha256("abc123").is_err());
        assert!(update_sha256(&"a".repeat(64)).is_ok());

        let base = std::env::temp_dir().join(format!("pwdmg_upd_test_{}", uuid::Uuid::new_v4()));
        let updates = base.join("updates");
        let outside = base.join("outside.zip");
        let inside = updates.join("pkg.zip");
        fs::create_dir_all(&updates).unwrap();
        fs::write(&outside, b"outside").unwrap();
        fs::write(&inside, b"inside").unwrap();

        assert!(confined_update_path(&updates, &inside).is_ok());
        assert!(confined_update_path(&updates, &outside).is_err());
        assert!(confined_update_path(&updates, &updates.join("..").join("outside.zip")).is_err());

        let _ = fs::remove_dir_all(&base);
    }
}
