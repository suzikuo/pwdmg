use pwdmg_core::paths::{desktop_config_file, ensure_app_dir};
use serde_json::{json, Value};
use std::fs;

pub const DEFAULT_CLOSE_BEHAVIOR: &str = "exit";

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
    } else if let Some(existing_win) = cfg.get("window").and_then(|w| w.as_object()) {
        if let Some(w) = existing_win.get("width") {
            win_obj.insert("width".to_string(), w.clone());
        }
        if let Some(h) = existing_win.get("height") {
            win_obj.insert("height".to_string(), h.clone());
        }
        if let Some(x) = existing_win.get("x") {
            win_obj.insert("x".to_string(), x.clone());
        }
        if let Some(y) = existing_win.get("y") {
            win_obj.insert("y".to_string(), y.clone());
        }
    }

    if let Some(root) = cfg.as_object_mut() {
        if !is_maximized {
            if let Some(w) = win_obj.get("width") {
                root.insert("width".to_string(), w.clone());
            }
            if let Some(h) = win_obj.get("height") {
                root.insert("height".to_string(), h.clone());
            }
            if let Some(x) = win_obj.get("x") {
                root.insert("x_position".to_string(), x.clone());
            }
            if let Some(y) = win_obj.get("y") {
                root.insert("y_position".to_string(), y.clone());
            }
        }
        root.insert("window".to_string(), Value::Object(win_obj));
    }
    let _ = write_desktop_config(&cfg);
}
