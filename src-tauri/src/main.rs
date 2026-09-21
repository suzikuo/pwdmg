// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use bridge::{
    configured_close_behavior, handle_api_call, read_desktop_config, save_window_state, DesktopState,
};
use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

const SHIM_SCRIPT: &str = r#"
(function() {
  function getInvoke() {
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      return window.__TAURI_INTERNALS__.invoke;
    }
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke;
    }
    return null;
  }

  function setupBridge() {
    const invoke = getInvoke();
    if (invoke) {
      const api = new Proxy({}, {
        get(_target, prop) {
          return async function(...args) {
            return await invoke('desktop_api', { method: String(prop), args: args });
          };
        }
      });

      window.pywebview = { api: api };
      window.isTauri = true;
      window.dispatchEvent(new CustomEvent('pywebviewready'));
    } else {
      setTimeout(setupBridge, 10);
    }
  }

  setupBridge();
})();
"#;

#[tauri::command]
fn desktop_api(
    state: State<DesktopState>,
    app: AppHandle,
    method: String,
    args: Vec<Value>,
) -> Value {
    handle_api_call(&state, &app, &method, &args)
}

fn main() {
    // Optimize WebView2 startup performance by disabling unused background services and telemetry
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-background-networking --disable-component-update --disable-sync --disable-default-apps --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
    );

    let app_state = DesktopState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![desktop_api])
        .setup(|app| {
            let config = read_desktop_config();
            let tray_enabled = config.get("tray_enabled").and_then(|v| v.as_bool()).unwrap_or(true);

            // Setup System Tray
            if tray_enabled {
                let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let reset_item = MenuItem::with_id(app, "reset_position", "重置窗口位置", true, None::<&str>)?;
                let lock_item = MenuItem::with_id(app, "lock", "锁定保险库", true, None::<&str>)?;
                let exit_item = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &reset_item, &lock_item, &exit_item])?;

                let tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "reset_position" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unmaximize();
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 960.0, height: 700.0 }));
                                let _ = window.center();
                                let _ = window.show();
                                let _ = window.set_focus();
                                save_window_state(&window);
                            }
                        }
                        "lock" => {
                            let state: State<DesktopState> = app.state();
                            state.vault.lock();
                        }
                        "exit" => {
                            if let Some(window) = app.get_webview_window("main") {
                                save_window_state(&window);
                            }
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    let _ = tray_builder.icon(icon.clone()).build(app);
                } else {
                    let _ = tray_builder.build(app);
                }
            }

            // Create main window with saved geometry and shim script
            let win_cfg = config.get("window");
            let width = win_cfg
                .and_then(|w| w.get("width"))
                .or_else(|| config.get("width"))
                .and_then(|v| v.as_f64())
                .unwrap_or(960.0)
                .max(360.0);
            let height = win_cfg
                .and_then(|w| w.get("height"))
                .or_else(|| config.get("height"))
                .and_then(|v| v.as_f64())
                .unwrap_or(700.0)
                .max(480.0);
            let is_maximized = win_cfg
                .and_then(|w| w.get("maximized"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let pos_x = win_cfg
                .and_then(|w| w.get("x"))
                .or_else(|| config.get("x_position"))
                .and_then(|v| v.as_f64());
            let pos_y = win_cfg
                .and_then(|w| w.get("y"))
                .or_else(|| config.get("y_position"))
                .and_then(|v| v.as_f64());

            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("My Password")
                .inner_size(width, height)
                .min_inner_size(360.0, 480.0)
                .resizable(true)
                .devtools(true)
                .visible(false)
                .background_color(tauri::utils::config::Color(17, 24, 39, 255))
                .initialization_script(SHIM_SCRIPT);

            if is_maximized {
                builder = builder.maximized(true);
            }

            let window = builder.build()?;

            let mut restored_pos = false;
            if let (Some(x), Some(y)) = (pos_x, pos_y) {
                if let Ok(monitors) = window.available_monitors() {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let phys_x = (x * scale) as i32;
                    let phys_y = (y * scale) as i32;
                    for m in monitors {
                        let m_pos = m.position();
                        let m_size = m.size();
                        if phys_x + 50 >= m_pos.x
                            && phys_x + 50 <= m_pos.x + m_size.width as i32
                            && phys_y + 50 >= m_pos.y
                            && phys_y + 50 <= m_pos.y + m_size.height as i32
                        {
                            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                            restored_pos = true;
                            break;
                        }
                    }
                }
            }
            if !restored_pos && !is_maximized {
                let _ = window.center();
            }

            // Safety fallback: reveal window after 600ms even if frontend call is delayed
            let w = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(600));
                let _ = w.show();
            });

            use std::sync::atomic::{AtomicU64, Ordering};
            use std::sync::Arc;
            let last_save_time = Arc::new(AtomicU64::new(0));

            let window_clone = window.clone();
            let save_time = last_save_time.clone();
            window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        save_window_state(&window_clone);
                        let cfg = read_desktop_config();
                        let behavior = configured_close_behavior(&cfg);

                        if behavior == "minimize-to-tray" {
                            api.prevent_close();
                            let _ = window_clone.hide();
                        } else {
                            window_clone.app_handle().exit(0);
                        }
                    }
                    tauri::WindowEvent::Destroyed => {
                        save_window_state(&window_clone);
                    }
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let prev = save_time.load(Ordering::Relaxed);
                        if now.saturating_sub(prev) >= 1000 {
                            save_time.store(now, Ordering::Relaxed);
                            save_window_state(&window_clone);
                        }
                    }
                    _ => {}
                }
            });

            // Auto-repair/sync plugin listener registration on startup if previously configured
            let pcfg = pwdmg_core::native_install::read_config();
            if pcfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Some(ext_id) = pcfg.get("extensionId").and_then(|v| v.as_str()) {
                    if !ext_id.is_empty() {
                        let _ = pwdmg_core::native_install::enable_plugin_listener(ext_id, None);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
