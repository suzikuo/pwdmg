use pwdmg_core::paths::{atomic_write_file, desktop_config_file, ensure_app_dir};
use serde_json::{json, Value};
use std::{fs, sync::Mutex};

pub const DEFAULT_CLOSE_BEHAVIOR: &str = "exit";
static DESKTOP_CONFIG_WRITE: Mutex<()> = Mutex::new(());

pub fn read_desktop_config() -> Value {
    let p = desktop_config_file();
    if p.exists() {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if val.is_object() {
                    return val;
                }
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

pub fn configured_gpu_acceleration(config: &Value) -> bool {
    config.get("gpu_acceleration_enabled").and_then(Value::as_bool) == Some(true)
}

#[cfg(windows)]
pub fn windows_webview_browser_args(config: &Value) -> Option<&'static str> {
    if configured_gpu_acceleration(config) {
        return None;
    }

    // Passing custom arguments replaces Wry's defaults, so keep them in software mode.
    Some(concat!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection ",
        "--autoplay-policy=no-user-gesture-required ",
        "--disable-gpu",
    ))
}

pub fn update_desktop_config(update: impl FnOnce(&mut Value)) -> Result<Value, String> {
    let _guard = DESKTOP_CONFIG_WRITE
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut config = read_desktop_config();
    update(&mut config);
    ensure_app_dir().map_err(|error| format!("{error}"))?;
    let bytes = serde_json::to_vec_pretty(&config).map_err(|error| format!("{error}"))?;
    atomic_write_file(&desktop_config_file(), &bytes)?;
    Ok(config)
}

pub fn save_window_state(window: &tauri::WebviewWindow) {
    let is_maximized = window.is_maximized().unwrap_or(false);
    let mut win_obj = serde_json::Map::new();
    win_obj.insert("maximized".to_owned(), json!(is_maximized));

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
    }

    let _ = update_desktop_config(|cfg| {
        if is_maximized {
            if let Some(existing_win) = cfg.get("window").and_then(Value::as_object) {
                for key in ["width", "height", "x", "y"] {
                    if let Some(value) = existing_win.get(key) {
                        win_obj.insert(key.to_owned(), value.clone());
                    }
                }
            }
        } else {
            for (window_key, config_key) in [
                ("width", "width"),
                ("height", "height"),
                ("x", "x_position"),
                ("y", "y_position"),
            ] {
                if let Some(value) = win_obj.get(window_key) {
                    cfg[config_key] = value.clone();
                }
            }
        }
        cfg["window"] = Value::Object(win_obj);
    });
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn webview_uses_software_rendering_unless_gpu_acceleration_is_enabled() {
        let legacy_config = json!({"tray_enabled": false});
        let software_args = windows_webview_browser_args(&legacy_config).unwrap();
        assert!(software_args
            .split_whitespace()
            .any(|arg| arg == "--disable-gpu"));
        assert_eq!(
            windows_webview_browser_args(&json!({"gpu_acceleration_enabled": false})),
            Some(software_args)
        );
        assert_eq!(
            windows_webview_browser_args(&json!({"gpu_acceleration_enabled": true})),
            None
        );
    }
}
