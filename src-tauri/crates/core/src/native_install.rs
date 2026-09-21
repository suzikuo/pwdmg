use crate::paths::{ensure_app_dir, native_host_dir, plugin_config_file};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

pub const HOST_NAME: &str = "com.suzikuo.mypwdmg";
pub const CHROME_REG_PATH: &str = r"Software\Google\Chrome\NativeMessagingHosts\com.suzikuo.mypwdmg";
pub const EDGE_REG_PATH: &str = r"Software\Microsoft\Edge\NativeMessagingHosts\com.suzikuo.mypwdmg";
pub const PACKAGED_HOST_EXE: &str = "My Password Host.exe";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct PluginListenerState {
    pub supported: bool,
    pub hostName: String,
    pub extensionId: String,
    pub manifestPath: String,
    pub launcherPath: String,
    pub logPath: String,
    pub executablePath: String,
    pub hostExecutablePath: String,
    pub hostExecutableExists: bool,
    pub hostRunning: bool,
    pub enabled: bool,
    pub mode: String,
    pub chromeRegistered: bool,
    pub edgeRegistered: bool,
    pub chromeManifestPath: String,
    pub edgeManifestPath: String,
}

pub fn normalize_extension_id(extension_id: &str) -> Result<String, String> {
    let mut id = extension_id.trim();
    if id.starts_with("chrome-extension://") {
        id = id.trim_start_matches("chrome-extension://").trim_matches('/');
    }
    if id.len() != 32 || !id.chars().all(|c| ('a'..='p').contains(&c)) {
        return Err("请输入 Chrome/Edge 扩展页里的 32 位插件 ID".to_string());
    }
    Ok(id.to_string())
}

pub fn host_executable_path() -> PathBuf {
    if let Ok(current_exe) = std::env::current_exe() {
        let parent = current_exe.parent().unwrap_or(Path::new("."));
        let host_exe = parent.join(PACKAGED_HOST_EXE);
        if host_exe.exists() {
            return host_exe;
        }
        let dev_host = parent.join("my-password-host.exe");
        if dev_host.exists() {
            return dev_host;
        }
    }
    native_host_dir().join(PACKAGED_HOST_EXE)
}

pub fn manifest_path() -> PathBuf {
    native_host_dir().join(format!("{}.json", HOST_NAME))
}

pub fn launcher_path() -> PathBuf {
    native_host_dir().join("mypwdmg_native_host.cmd")
}

pub fn log_path() -> PathBuf {
    native_host_dir().join("native-host-error.log")
}

pub fn read_config() -> Value {
    let p = plugin_config_file();
    if p.exists() {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(val) = serde_json::from_str(&text) {
                return val;
            }
        }
    }
    json!({})
}

pub fn write_config(val: &Value) -> Result<(), String> {
    ensure_app_dir().map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(val).map_err(|e| e.to_string())?;
    fs::write(plugin_config_file(), text).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn is_plugin_listener_enabled() -> bool {
    let cfg = read_config();
    cfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
}

fn read_registry(sub_path: &str) -> String {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(sub_path) {
        if let Ok(val) = key.get_value::<String, _>("") {
            return val;
        }
    }
    String::new()
}

fn write_registry(sub_path: &str, target_file: &Path) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(sub_path)?;
    key.set_value("", &target_file.to_string_lossy().to_string())?;
    Ok(())
}

fn delete_registry(sub_path: &str) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey(sub_path);
}

pub fn write_launcher() -> std::io::Result<PathBuf> {
    let launcher = launcher_path();
    let log = log_path();
    let host_exe = host_executable_path();
    let host_dir = host_exe.parent().unwrap_or(Path::new("."));

    let content = format!(
        "@echo off\r\nsetlocal\r\nset \"LOG_DIR={}\"\r\nset \"LOG_FILE={}\"\r\nif not exist \"%LOG_DIR%\" mkdir \"%LOG_DIR%\" >nul 2>nul\r\ncd /d \"{}\" >nul 2>nul\r\n\"{}\" 2>>\"%LOG_FILE%\"\r\nexit /b %ERRORLEVEL%\r\n",
        native_host_dir().display(),
        log.display(),
        host_dir.display(),
        host_exe.display()
    );

    fs::create_dir_all(native_host_dir())?;
    fs::write(&launcher, content)?;
    Ok(launcher)
}

pub fn write_manifest(extension_id: &str) -> std::io::Result<PathBuf> {
    let manifest = manifest_path();
    let host_exe = host_executable_path();

    // If host_exe exists directly, we can point directly to host_exe or to the cmd launcher
    let launch_target = if host_exe.exists() {
        host_exe
    } else {
        launcher_path()
    };

    let manifest_content = json!({
        "name": HOST_NAME,
        "description": "My Password native messaging host",
        "path": launch_target.to_string_lossy().to_string(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{}/", extension_id)
        ]
    });

    fs::create_dir_all(native_host_dir())?;
    fs::write(&manifest, serde_json::to_string_pretty(&manifest_content)?)?;
    Ok(manifest)
}

pub fn plugin_listener_state() -> PluginListenerState {
    let cfg = read_config();
    let manifest = manifest_path();
    let launcher = launcher_path();
    let host_exe = host_executable_path();
    let chrome_path = read_registry(CHROME_REG_PATH);
    let edge_path = read_registry(EDGE_REG_PATH);
    let manifest_str = manifest.to_string_lossy().to_string();

    let enabled = cfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let extension_id = cfg.get("extensionId").and_then(|v| v.as_str()).unwrap_or("").to_string();

    PluginListenerState {
        supported: cfg!(target_os = "windows"),
        hostName: HOST_NAME.to_string(),
        extensionId: extension_id,
        manifestPath: manifest_str.clone(),
        launcherPath: launcher.to_string_lossy().to_string(),
        logPath: log_path().to_string_lossy().to_string(),
        executablePath: std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        hostExecutablePath: host_exe.to_string_lossy().to_string(),
        hostExecutableExists: host_exe.exists(),
        hostRunning: false,
        enabled,
        mode: "native-rust".to_string(),
        chromeRegistered: chrome_path == manifest_str,
        edgeRegistered: edge_path == manifest_str,
        chromeManifestPath: chrome_path,
        edgeManifestPath: edge_path,
    }
}

pub fn enable_plugin_listener(extension_id: &str, browsers: Option<&[String]>) -> Result<PluginListenerState, String> {
    let norm_id = normalize_extension_id(extension_id)?;
    let default_browsers = vec!["chrome".to_string(), "edge".to_string()];
    let browser_list = browsers.unwrap_or(&default_browsers);

    ensure_app_dir().map_err(|e| e.to_string())?;
    let _ = write_launcher();
    let manifest = write_manifest(&norm_id).map_err(|e| e.to_string())?;

    for b in browser_list {
        match b.as_str() {
            "chrome" => {
                let _ = write_registry(CHROME_REG_PATH, &manifest);
            }
            "edge" => {
                let _ = write_registry(EDGE_REG_PATH, &manifest);
            }
            _ => {}
        }
    }

    let mut cfg = read_config();
    if let Some(obj) = cfg.as_object_mut() {
        obj.insert("enabled".to_string(), Value::Bool(true));
        obj.insert("extensionId".to_string(), Value::String(norm_id));
        obj.insert("browsers".to_string(), json!(browser_list));
    }
    write_config(&cfg)?;

    Ok(plugin_listener_state())
}

pub fn disable_plugin_listener() -> Result<PluginListenerState, String> {
    let mut cfg = read_config();
    if let Some(obj) = cfg.as_object_mut() {
        obj.insert("enabled".to_string(), Value::Bool(false));
    }
    let _ = write_config(&cfg);

    delete_registry(CHROME_REG_PATH);
    delete_registry(EDGE_REG_PATH);

    // Terminate any running host processes
    let _ = std::process::Command::new("taskkill")
        .args(["/IM", PACKAGED_HOST_EXE, "/F"])
        .output();
    let _ = std::process::Command::new("taskkill")
        .args(["/IM", "my-password-host.exe", "/F"])
        .output();

    Ok(plugin_listener_state())
}
