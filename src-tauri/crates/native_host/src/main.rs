use pwdmg_core::native_install::is_plugin_listener_enabled;
use pwdmg_core::vault::VaultService;
use serde_json::{json, Value};
use std::io::{self, Read, Write};

const MAX_NATIVE_MESSAGE_BYTES: usize = 1024 * 1024;

fn read_message() -> io::Result<Option<Value>> {
    let mut len_buf = [0u8; 4];
    match io::stdin().read_exact(&mut len_buf) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > MAX_NATIVE_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid message length",
        ));
    }

    let mut body = vec![0u8; len];
    io::stdin().read_exact(&mut body)?;

    let val: Value = serde_json::from_slice(&body)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    Ok(Some(val))
}

fn write_message(val: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(val)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let len = bytes.len() as u32;

    let mut stdout = io::stdout().lock();
    stdout.write_all(&len.to_le_bytes())?;
    stdout.write_all(&bytes)?;
    stdout.flush()?;
    Ok(())
}

fn dispatch(service: &VaultService, req: &Value) -> Value {
    if !is_plugin_listener_enabled() {
        return json!({
            "ok": false,
            "code": "PLUGIN_DISABLED",
            "message": "插件监听已在桌面端关闭。"
        });
    }

    let method = match req.get("method").and_then(|m| m.as_str()) {
        Some(m) => m,
        None => {
            return json!({
                "ok": false,
                "code": "INVALID_INPUT",
                "message": "Invalid native host request."
            });
        }
    };

    let params = req.get("params").unwrap_or(&Value::Null);

    let result = match method {
        "getState" => Ok(service.state()),
        "unlock" => {
            let password = params
                .get("password")
                .and_then(|p| p.as_str())
                .unwrap_or("");
            service.unlock(password)
        }
        "lock" => Ok(service.lock()),
        "queryMatches" => {
            let hostname = params
                .get("hostname")
                .and_then(|h| h.as_str())
                .unwrap_or("");
            let page_url = params
                .get("pageUrl")
                .and_then(|u| u.as_str())
                .unwrap_or("");
            service.query_matches(hostname, page_url).map(|matches| json!(matches))
        }
        "getFillPayload" => {
            let entry_id = params
                .get("entryId")
                .and_then(|id| id.as_str())
                .unwrap_or("");
            let hostname = params
                .get("hostname")
                .and_then(|h| h.as_str())
                .unwrap_or("");
            let page_url = params
                .get("pageUrl")
                .and_then(|u| u.as_str())
                .unwrap_or("");
            service.get_fill_payload_for_host(entry_id, hostname, page_url)
        }
        "listSaveTargets" => service.list_save_targets(),
        "previewCapturedLogin" => {
            let capture = params.get("capture").unwrap_or(params);
            service.preview_captured_login(capture)
        }
        "saveCapturedLogin" => {
            let capture = params.get("capture").unwrap_or(params);
            let parent_id = params
                .get("parentId")
                .and_then(|p| p.as_str())
                .unwrap_or("");
            let update_entry_id = params
                .get("updateEntryId")
                .and_then(|u| u.as_str())
                .unwrap_or("");
            service.save_captured_login(capture, parent_id, update_entry_id)
        }
        "generateTotp" => {
            let entry_id = params
                .get("entryId")
                .and_then(|id| id.as_str())
                .unwrap_or("");
            service.generate_totp_for_entry(entry_id)
        }
        "getDeviceUnlockState" => Ok(service.device_unlock_state()),
        "enableDeviceUnlock" => {
            let password = params
                .get("password")
                .and_then(|p| p.as_str())
                .unwrap_or("");
            let reauth_seconds = params
                .get("reauthSeconds")
                .and_then(|s| s.as_u64())
                .unwrap_or(0);
            service.enable_device_unlock(password, reauth_seconds)
        }
        "disableDeviceUnlock" => service.disable_device_unlock(),
        "readDeviceUnlockKey" => service.read_device_unlock_key(),
        _ => {
            return json!({
                "ok": false,
                "code": "UNKNOWN_METHOD",
                "message": "Unknown native host method."
            });
        }
    };

    match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(err) => json!({
            "ok": false,
            "code": "NATIVE_HOST_ERROR",
            "message": err
        }),
    }
}

fn main() {
    let service = VaultService::default();

    while let Ok(Some(req)) = read_message() {
        let mut resp = dispatch(&service, &req);
        if let Some(id) = req.get("id") {
            if let Some(obj) = resp.as_object_mut() {
                obj.insert("id".to_string(), id.clone());
            }
        }
        if write_message(&resp).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pwdmg_core::paths::ensure_app_dir;

    #[test]
    fn test_native_dispatch_structure() {
        let _ = ensure_app_dir();
        let service = VaultService::default();
        let req = json!({
            "id": 42,
            "method": "getState",
            "params": {}
        });

        let resp = dispatch(&service, &req);
        assert!(resp.get("ok").is_some());
    }
}
