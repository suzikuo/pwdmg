use pwdmg_core::attachment::AttachmentStore;
use pwdmg_core::device_unlock::DeviceUnlockStore;
use pwdmg_core::native_install::{
    disable_plugin_listener, enable_plugin_listener, plugin_listener_state,
};
use pwdmg_core::paths::{
    app_dir, attachment_dir, desktop_config_file, ensure_app_dir, update_dir,
};
use pwdmg_core::portable::{
    export_portable_backup, import_portable_backup, inspect_portable_backup,
};
use pwdmg_core::vault::VaultService;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const DEFAULT_CLOSE_BEHAVIOR: &str = "exit";

pub struct DesktopState {
    pub vault: VaultService,
    pub attachments: AttachmentStore,
    pub device_unlock: DeviceUnlockStore,
    pub portable_backup_selection: Mutex<Option<(String, PathBuf)>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        let _ = ensure_app_dir();
        Self {
            vault: VaultService::default(),
            attachments: AttachmentStore::new(attachment_dir()),
            device_unlock: DeviceUnlockStore::default(),
            portable_backup_selection: Mutex::new(None),
        }
    }
}

pub fn read_desktop_config() -> Value {
    let p = desktop_config_file();
    if p.exists() {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(val) = serde_json::from_str(&text) {
                return val;
            }
        }
    }
    json!({
        "tray_enabled": true,
        "close_behavior": DEFAULT_CLOSE_BEHAVIOR,
        "close_behavior_user_set": false
    })
}

pub fn configured_close_behavior(config: &Value) -> &'static str {
    let behavior = config.get("close_behavior").and_then(|v| v.as_str());
    let user_set = config
        .get("close_behavior_user_set")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match (behavior, user_set) {
        (Some("minimize-to-tray"), true) => "minimize-to-tray",
        (Some("exit"), _) => "exit",
        _ => DEFAULT_CLOSE_BEHAVIOR,
    }
}

pub fn write_desktop_config(val: &Value) -> Result<(), String> {
    ensure_app_dir().map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(val).map_err(|e| e.to_string())?;
    fs::write(desktop_config_file(), text).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_window_state(window: &tauri::WebviewWindow) {
    let is_maximized = window.is_maximized().unwrap_or(false);
    let mut cfg = read_desktop_config();

    let mut win_obj = serde_json::Map::new();
    win_obj.insert("maximized".to_string(), json!(is_maximized));

    if !is_maximized {
        if let Ok(size) = window.inner_size() {
            if let Ok(scale) = window.scale_factor() {
                let logical_size = size.to_logical::<f64>(scale);
                win_obj.insert("width".to_string(), json!(logical_size.width));
                win_obj.insert("height".to_string(), json!(logical_size.height));
            }
        }
        if let Ok(pos) = window.outer_position() {
            if let Ok(scale) = window.scale_factor() {
                let logical_pos = pos.to_logical::<f64>(scale);
                win_obj.insert("x".to_string(), json!(logical_pos.x));
                win_obj.insert("y".to_string(), json!(logical_pos.y));
            }
        }
    } else {
        if let Some(existing_win) = cfg.get("window").and_then(|w| w.as_object()) {
            if let Some(w) = existing_win.get("width") { win_obj.insert("width".to_string(), w.clone()); }
            if let Some(h) = existing_win.get("height") { win_obj.insert("height".to_string(), h.clone()); }
            if let Some(x) = existing_win.get("x") { win_obj.insert("x".to_string(), x.clone()); }
            if let Some(y) = existing_win.get("y") { win_obj.insert("y".to_string(), y.clone()); }
        }
    }

    if let Some(root) = cfg.as_object_mut() {
        if !is_maximized {
            if let Some(w) = win_obj.get("width") { root.insert("width".to_string(), w.clone()); }
            if let Some(h) = win_obj.get("height") { root.insert("height".to_string(), h.clone()); }
            if let Some(x) = win_obj.get("x") { root.insert("x_position".to_string(), x.clone()); }
            if let Some(y) = win_obj.get("y") { root.insert("y_position".to_string(), y.clone()); }
        }
        root.insert("window".to_string(), Value::Object(win_obj));
    }
    let _ = write_desktop_config(&cfg);
}

pub fn handle_api_call(state: &DesktopState, app: &AppHandle, method: &str, args: &[Value]) -> Value {
    let result = dispatch_api(state, app, method, args);
    match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(err) => json!({ "ok": false, "code": "ERROR", "message": err }),
    }
}

fn dispatch_api(state: &DesktopState, app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, String> {
    match method {
        "getAppInfo" => Ok(json!({
            "version": pwdmg_core::version(),
            "platform": "desktop",
            "packaged": true,
        })),

        "getState" => Ok(state.vault.state()),
        "getStorageState" => Ok(state.vault.storage_state()),
        "readVaultEnvelope" => state.vault.read_vault_envelope().map(Value::String),
        "writeVaultEnvelope" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let protect_backup = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            let expected_rev = args.get(2).and_then(|v| v.as_u64());
            state.vault.write_vault_envelope(text, protect_backup, expected_rev)
        }
        "readLegacyLocalStorage" => state.vault.read_legacy_local_storage().map(Value::String),
        "cleanupLegacyStorage" => {
            let expected_digest = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let expected_vault = args.get(1).and_then(|v| v.as_str());
            state.vault.cleanup_legacy_storage(expected_digest, expected_vault)
        }

        "createVault" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let import_legacy = args.get(1).and_then(|v| v.as_bool()).unwrap_or(true);
            state.vault.create_vault(password, import_legacy)
        }
        "unlock" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.unlock(password)
        }
        "lock" => Ok(state.vault.lock()),
        "getVault" => state.vault.get_vault(),
        "saveVault" => {
            let payload = args.first().ok_or("Missing payload")?;
            let expected_rev = args.get(1).and_then(|v| v.as_u64());
            state.vault.save_vault(payload, expected_rev)
        }
        "changePassword" => {
            let new_password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.change_password(new_password)
        }
        "exportVaultBackup" => state.vault.export_backup(),
        "importVaultBackup" => {
            let envelope_text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            state.vault.import_backup(envelope_text)
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
            Ok(json!({ "retained": retained }))
        }
        "collectAttachmentObjects" => {
            let referenced: Vec<String> = args
                .first()
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let (retained, deleted) = state.attachments.collect(&referenced)?;
            Ok(json!({ "retained": retained, "deleted": deleted }))
        }
        "saveAttachmentFile" => {
            let display_name = args.first().and_then(|v| v.as_str()).unwrap_or("attachment");
            let content_base64 = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            save_attachment_file_dialog(display_name, content_base64)
        }

        // Device Unlock (DPAPI)
        "getDeviceUnlockState" => Ok(state.device_unlock.state()),
        "enableDeviceUnlock" => {
            let password = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let reauth_seconds = args.get(1).and_then(|v| v.as_u64()).unwrap_or(0);
            let vault_path = pwdmg_core::paths::vault_file();
            if !vault_path.exists() {
                return Err("Vault file does not exist".to_string());
            }
            let text = std::fs::read_to_string(&vault_path).map_err(|e| e.to_string())?;
            let envelope: pwdmg_core::crypto::VaultEnvelope = serde_json::from_str(&text)
                .map_err(|_| "Vault envelope is not valid JSON".to_string())?;
            let (_payload, vault_key) = pwdmg_core::crypto::decrypt_payload(password, &envelope)
                .map_err(|_| "密码不正确".to_string())?;
            state.device_unlock.enable(&vault_key, reauth_seconds)
        }
        "disableDeviceUnlock" => state.device_unlock.disable(),
        "readDeviceUnlockKey" => state.device_unlock.read_key(),

        // Portable Backup
        "exportPortableBackupPackage" => {
            let default_name = format!("mypwdmg-{}.mypwdmg-backup", chrono::Local::now().format("%Y%m%d-%H%M%S"));
            let downloads = directories::UserDirs::new()
                .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| app_dir());
            let target_path = downloads.join(default_name);
            let res = export_portable_backup(&target_path)?;
            Ok(json!({ "saved": true, "path": res["path"] }))
        }
        "selectPortableBackupPackage" => {
            let downloads = directories::UserDirs::new()
                .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| app_dir());

            let mut selection_guard = state.portable_backup_selection.lock().unwrap();
            *selection_guard = None;

            if let Some(path) = rfd::FileDialog::new()
                .add_filter("My Password Backup", &["mypwdmg-backup"])
                .set_directory(&downloads)
                .pick_file()
            {
                let inspected = inspect_portable_backup(&path)?;
                let token = uuid::Uuid::new_v4().to_string();
                *selection_guard = Some((token.clone(), path));
                Ok(json!({
                    "selected": true,
                    "selectionToken": token,
                    "manifest": inspected,
                }))
            } else {
                Ok(json!({ "selected": false }))
            }
        }
        "importPortableBackupPackage" => {
            let selection_token = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let password = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let mut selection_guard = state.portable_backup_selection.lock().unwrap();
            match selection_guard.as_ref() {
                Some((token, path)) if token == selection_token => {
                    let res = import_portable_backup(path, password)?;
                    *selection_guard = None;
                    Ok(res)
                }
                _ => Err("Portable backup selection has expired".to_string()),
            }
        }
        "discardPortableBackupSelection" => {
            let selection_token = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let mut selection_guard = state.portable_backup_selection.lock().unwrap();
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
                arr.iter().filter_map(|s| s.as_str().map(|str_val| str_val.to_string())).collect()
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
            let tray_enabled = cfg.get("tray_enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let close_behavior = configured_close_behavior(&cfg);
            Ok(json!({
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
            download_desktop_update(manifest_url)
        }
        "applyDesktopUpdate" => {
            let package_path = args.first().and_then(|v| v.as_str()).unwrap_or("");
            apply_desktop_update(package_path)
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
            if let Some(w) = app.get_webview_window("main") {
                save_window_state(&w);
            }
            app.exit(0);
            Ok(json!(null))
        }
        "openExternalUrl" => {
            let url = args.first().and_then(|v| v.as_str()).unwrap_or("");
            if !url.is_empty() {
                let _ = open::that(url);
            }
            Ok(json!(null))
        }

        _ => Err(format!("Unknown desktop API method: {}", method)),
    }
}

fn save_attachment_file_dialog(display_name: &str, content_base64: &str) -> Result<Value, String> {
    use base64::Engine;
    let data = base64::prelude::BASE64_STANDARD
        .decode(content_base64)
        .map_err(|e| e.to_string())?;

    let file_name = Path::new(display_name).file_name().and_then(|n| n.to_str()).unwrap_or("attachment");
    if let Some(target) = rfd::FileDialog::new().set_file_name(file_name).save_file() {
        fs::write(&target, data).map_err(|e| e.to_string())?;
        Ok(json!({ "saved": true, "path": target.to_string_lossy() }))
    } else {
        Ok(json!({ "saved": false, "path": "" }))
    }
}

fn sha256_file(path: &Path) -> Result<String, std::io::Error> {
    use sha2::Digest;
    use std::io::Read;
    let mut file = File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn check_desktop_update(manifest_url: &str) -> Result<Value, String> {
    let url = if manifest_url.trim().is_empty() {
        "https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json"
    } else {
        manifest_url.trim()
    };

    let agent = ureq::builder()
        .try_proxy_from_env(true)
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(30))
        .build();

    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("获取更新清单失败: {}", e))?;
    let manifest: Value = resp
        .into_json()
        .map_err(|e| format!("更新清单解析错误: {}", e))?;

    let latest_version = manifest.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let current_version = pwdmg_core::version();

    let update_available = compare_versions(latest_version, current_version) > 0;

    let assets = manifest.get("assets").and_then(|a| a.as_object());
    let win_asset = assets
        .and_then(|a| a.get("windows").or_else(|| a.get("win64")))
        .cloned()
        .unwrap_or_else(|| json!({}));

    let notes = manifest.get("notes").and_then(|n| n.as_str()).unwrap_or("");
    let published_at = manifest.get("publishedAt").and_then(|p| p.as_str()).unwrap_or("");
    let latest_code = manifest.get("versionCode").and_then(|c| c.as_i64());

    let asset_url = win_asset.get("url").and_then(|u| u.as_str()).unwrap_or("");
    let asset_sha256 = win_asset.get("sha256").and_then(|s| s.as_str()).unwrap_or("");
    let asset_size = win_asset.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
    let asset_filename = win_asset
        .get("fileName")
        .and_then(|f| f.as_str())
        .unwrap_or("MyPasswordDesktop-windows.zip");
    let asset_urls = win_asset.get("urls").cloned().unwrap_or_else(|| json!([]));

    let asset_obj = json!({
        "url": asset_url,
        "urls": asset_urls,
        "sha256": asset_sha256,
        "size": asset_size,
        "fileName": asset_filename,
    });

    Ok(json!({
        "supported": true,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "latestCode": latest_code,
        "updateAvailable": update_available,
        "canApply": true,
        "manifestUrl": url,
        "notes": notes,
        "publishedAt": published_at,
        "platform": "windows",
        "asset": asset_obj,
        "manifest": manifest,
    }))
}

fn download_desktop_update(manifest_url: &str) -> Result<Value, String> {
    let check = check_desktop_update(manifest_url)?;
    let win_asset = check
        .get("asset")
        .and_then(|a| a.as_object())
        .ok_or("更新清单中未找到 Windows 更新包")?;

    let download_url = win_asset.get("url").and_then(|u| u.as_str()).unwrap_or("");
    if download_url.is_empty() {
        return Err("更新清单缺少下载链接".to_string());
    }
    let expected_sha256 = win_asset.get("sha256").and_then(|s| s.as_str()).unwrap_or("");
    let expected_size = win_asset.get("size").and_then(|s| s.as_u64()).unwrap_or(0);

    let up_dir = update_dir();
    fs::create_dir_all(&up_dir).map_err(|e| e.to_string())?;
    let target_file = up_dir.join("update-package.zip");

    // Check if valid cache exists already
    let mut already_cached = false;
    if target_file.exists() {
        if let Ok(meta) = target_file.metadata() {
            if (expected_size == 0 || meta.len() == expected_size) && !expected_sha256.is_empty() {
                if let Ok(hash) = sha256_file(&target_file) {
                    if hash.eq_ignore_ascii_case(expected_sha256) {
                        already_cached = true;
                    }
                }
            }
        }
    }

    let actual_sha256 = if already_cached {
        expected_sha256.to_string()
    } else {
        let mut candidate_urls = Vec::new();
        if let Some(urls) = win_asset.get("urls").and_then(|u| u.as_array()) {
            for u in urls {
                if let Some(s) = u.as_str() {
                    let st = s.trim();
                    if !st.is_empty() && !candidate_urls.contains(&st.to_string()) {
                        candidate_urls.push(st.to_string());
                    }
                }
            }
        }
        if !candidate_urls.contains(&download_url.to_string()) {
            candidate_urls.push(download_url.to_string());
        }

        let agent = ureq::builder()
            .try_proxy_from_env(true)
            .timeout_connect(std::time::Duration::from_secs(20))
            .timeout_read(std::time::Duration::from_secs(180))
            .build();

        let mut last_err = String::new();
        let mut success = false;
        let mut computed_sha256 = String::new();

        let temp_file = up_dir.join("update-package.zip.tmp");

        for cand_url in &candidate_urls {
            match agent.get(cand_url).call() {
                Ok(resp) => {
                    let mut reader = resp.into_reader();
                    let f = match File::create(&temp_file) {
                        Ok(f) => f,
                        Err(e) => {
                            last_err = e.to_string();
                            continue;
                        }
                    };
                    let mut writer = std::io::BufWriter::new(f);
                    let mut hasher = sha2::Sha256::new();
                    use sha2::Digest;
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 128 * 1024];
                    let mut read_ok = true;

                    while let Ok(n) = reader.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        hasher.update(&buf[..n]);
                        if let Err(e) = writer.write_all(&buf[..n]) {
                            last_err = e.to_string();
                            read_ok = false;
                            break;
                        }
                    }
                    let _ = writer.flush();
                    drop(writer);

                    if !read_ok {
                        let _ = fs::remove_file(&temp_file);
                        continue;
                    }

                    let hash_str = format!("{:x}", hasher.finalize());
                    if !expected_sha256.is_empty()
                        && !hash_str.eq_ignore_ascii_case(expected_sha256)
                    {
                        let _ = fs::remove_file(&temp_file);
                        last_err = format!(
                            "SHA256 校验不匹配 (期望 {}, 实际 {})",
                            expected_sha256, hash_str
                        );
                        continue;
                    }

                    let _ = fs::remove_file(&target_file);
                    if let Err(e) = fs::rename(&temp_file, &target_file) {
                        last_err = format!("保存更新包失败: {}", e);
                        continue;
                    }

                    computed_sha256 = hash_str;
                    success = true;
                    break;
                }
                Err(e) => {
                    last_err = format!("从 {} 下载失败: {}", cand_url, e);
                }
            }
        }

        if !success {
            return Err(if last_err.is_empty() {
                "下载更新包失败".to_string()
            } else {
                last_err
            });
        }
        computed_sha256
    };

    let actual_size = target_file
        .metadata()
        .map(|m| m.len())
        .unwrap_or(expected_size);

    Ok(json!({
        "update": check,
        "packagePath": target_file.to_string_lossy(),
        "sha256": actual_sha256,
        "size": actual_size,
    }))
}

fn apply_desktop_update(package_path: &str) -> Result<Value, String> {
    let package = PathBuf::from(package_path);
    if !package.exists() {
        return Err("更新包不存在，请重新下载".to_string());
    }

    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let install_dir = exe_path.parent().ok_or("获取安装目录失败")?.to_path_buf();
    let exe_name = exe_path
        .file_name()
        .ok_or("获取程序名失败")?
        .to_string_lossy()
        .to_string();

    let up_dir = update_dir();
    fs::create_dir_all(&up_dir).map_err(|e| e.to_string())?;

    let now = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let script_path = up_dir.join(format!("apply-update-{}.ps1", now));
    let work_dir = up_dir.join(format!("apply-{}", now));
    let backup_dir = up_dir.join(format!("backup-{}", now));
    let log_path = up_dir.join(format!("apply-update-{}.log", now));
    let current_pid = std::process::id();

    let ps_script = format!(
        r#"$ErrorActionPreference = 'Stop'
$ProcessIdToWait = {pid}
$PackagePath = '{package_path}'
$InstallDir = '{install_dir}'
$ExeName = '{exe_name}'
$HostExeName = 'My Password Host.exe'
$HostName = 'com.suzikuo.mypwdmg'
$ChromeHostKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$EdgeHostKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
$WorkDir = '{work_dir}'
$BackupDir = '{backup_dir}'
$UpdateDir = '{update_dir}'
$LogPath = '{log_path}'
$BackupComplete = $false
$InstallMutationStarted = $false

function Write-UpdateLog {{
    param([string] $Message)
    $Line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $LogPath -Value $Line -Encoding UTF8
}}

function Stop-ImageName {{
    param([string] $ImageName)
    if (-not $ImageName) {{ return }}
    $ImageBase = [System.IO.Path]::GetFileNameWithoutExtension($ImageName)
    $Processes = Get-Process -Name $ImageBase -ErrorAction SilentlyContinue
    foreach ($Process in $Processes) {{
        try {{
            Write-UpdateLog "Stopping $ImageName pid=$($Process.Id)"
            Stop-Process -Id $Process.Id -Force -ErrorAction Stop
        }} catch {{
            Write-UpdateLog "Could not stop $ImageName pid=$($Process.Id): $($_.Exception.Message)"
        }}
    }}
}}

function Get-DefaultRegistryValue {{
    param([string] $Path)
    try {{
        if (-not (Test-Path -LiteralPath $Path)) {{ return $null }}
        return (Get-Item -LiteralPath $Path).GetValue('')
    }} catch {{
        Write-UpdateLog "Could not read registry ${{Path}}: $($_.Exception.Message)"
        return $null
    }}
}}

function Disable-NativeHostRegistration {{
    param([string] $Path)
    try {{
        if (Test-Path -LiteralPath $Path) {{
            Write-UpdateLog "Disabling native host registration: $Path"
            Remove-Item -LiteralPath $Path -Recurse -Force
        }}
    }} catch {{
        Write-UpdateLog "Could not disable native host registration ${{Path}}: $($_.Exception.Message)"
    }}
}}

function Restore-NativeHostRegistration {{
    param([string] $Path, [object] $Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) {{ return }}
    try {{
        Write-UpdateLog "Restoring native host registration: $Path"
        New-Item -Path $Path -Force | Out-Null
        Set-Item -LiteralPath $Path -Value ([string] $Value)
    }} catch {{
        Write-UpdateLog "Could not restore native host registration ${{Path}}: $($_.Exception.Message)"
    }}
}}

function Start-UpdatedApp {{
    $UpdatedExe = Join-Path $InstallDir $ExeName
    if (-not (Test-Path -LiteralPath $UpdatedExe -PathType Leaf)) {{
        throw "Updated executable was not found: $UpdatedExe"
    }}
    try {{
        Write-UpdateLog "Starting updated app: $UpdatedExe"
        Start-Process -FilePath $UpdatedExe -WorkingDirectory $InstallDir -ErrorAction Stop
    }} catch {{
        Write-UpdateLog "Start-Process failed: $($_.Exception.Message)"
        $StartArgs = '/c start "" "' + $UpdatedExe + '"'
        Start-Process -FilePath 'cmd.exe' -ArgumentList $StartArgs -WorkingDirectory $InstallDir -WindowStyle Hidden -ErrorAction Stop
    }}
}}

try {{
    Write-UpdateLog "Update started"
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {{
        throw "Update package was not found: $PackagePath"
    }}

    $ChromeHostValue = Get-DefaultRegistryValue $ChromeHostKey
    $EdgeHostValue = Get-DefaultRegistryValue $EdgeHostKey
    Disable-NativeHostRegistration $ChromeHostKey
    Disable-NativeHostRegistration $EdgeHostKey
    Stop-ImageName $HostExeName

    if ($ProcessIdToWait -gt 0) {{
        $Deadline = (Get-Date).AddSeconds(120)
        while (Get-Process -Id $ProcessIdToWait -ErrorAction SilentlyContinue) {{
            if ((Get-Date) -gt $Deadline) {{
                throw "Timed out waiting for current app process to exit"
            }}
            Start-Sleep -Milliseconds 250
        }}
    }}
    Start-Sleep -Milliseconds 600
    Stop-ImageName $HostExeName

    if (Test-Path -LiteralPath $WorkDir) {{
        Remove-Item -LiteralPath $WorkDir -Recurse -Force
    }}
    if (Test-Path -LiteralPath $BackupDir) {{
        Remove-Item -LiteralPath $BackupDir -Recurse -Force
    }}
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

    Expand-Archive -LiteralPath $PackagePath -DestinationPath $WorkDir -Force
    $PayloadDir = $WorkDir
    if (-not (Test-Path -LiteralPath (Join-Path $PayloadDir $ExeName))) {{
        $Candidate = Get-ChildItem -LiteralPath $WorkDir -Directory | Where-Object {{
            Test-Path -LiteralPath (Join-Path $_.FullName $ExeName)
        }} | Select-Object -First 1
        if ($null -ne $Candidate) {{
            $PayloadDir = $Candidate.FullName
        }}
    }}
    if (-not (Test-Path -LiteralPath (Join-Path $PayloadDir $ExeName))) {{
        throw "Update package does not contain $ExeName"
    }}

    $InstallItems = @(Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction Stop)
    foreach ($InstallItem in $InstallItems) {{
        Copy-Item -LiteralPath $InstallItem.FullName -Destination $BackupDir -Recurse -Force -ErrorAction Stop
    }}
    $BackupComplete = $true
    $InstallMutationStarted = $true

    Get-ChildItem -LiteralPath $PayloadDir -Force | ForEach-Object {{
        $Target = Join-Path $InstallDir $_.Name
        if (Test-Path -LiteralPath $Target) {{
            Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
        }}
        Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction Stop
    }}

    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
    Write-UpdateLog "Update installed successfully, restarting app"
    Start-UpdatedApp

    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PackagePath -Force -ErrorAction SilentlyContinue
}} catch {{
    $FailureMessage = $_.Exception.Message
    Write-UpdateLog "Update failed: $FailureMessage"
    if ($InstallMutationStarted -and $BackupComplete) {{
        try {{
            Write-UpdateLog "Rolling back from backup"
            Get-ChildItem -LiteralPath $BackupDir -Force | ForEach-Object {{
                $Target = Join-Path $InstallDir $_.Name
                Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
            }}
            Start-UpdatedApp
        }} catch {{
            Write-UpdateLog "Rollback failed: $($_.Exception.Message)"
        }}
    }}
    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
}}
"#,
        pid = current_pid,
        package_path = package.to_string_lossy().replace('\'', "''"),
        install_dir = install_dir.to_string_lossy().replace('\'', "''"),
        exe_name = exe_name.replace('\'', "''"),
        work_dir = work_dir.to_string_lossy().replace('\'', "''"),
        backup_dir = backup_dir.to_string_lossy().replace('\'', "''"),
        update_dir = up_dir.to_string_lossy().replace('\'', "''"),
        log_path = log_path.to_string_lossy().replace('\'', "''"),
    );

    fs::write(&script_path, ps_script.as_bytes())
        .map_err(|e| format!("写入更新脚本失败: {}", e))?;

    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script_path.to_string_lossy(),
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("启动更新脚本失败: {}", e))?;

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::process::exit(0);
    });

    Ok(json!({
        "packagePath": package_path,
        "scriptPath": script_path.to_string_lossy(),
        "installDir": install_dir.to_string_lossy(),
        "willRestart": true,
    }))
}

fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split('.')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    for (x, y) in va.iter().zip(vb.iter()) {
        if x > y {
            return 1;
        }
        if x < y {
            return -1;
        }
    }
    va.len().cmp(&vb.len()) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
