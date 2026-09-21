use crate::crypto::VaultKey;
use crate::paths::{device_unlock_file, vault_file};
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::ptr::null_mut;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
};

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

pub const DEFAULT_REAUTH_SECONDS: u64 = 7 * 24 * 60 * 60;
pub const MIN_REAUTH_SECONDS: u64 = 60 * 60;
pub const MAX_REAUTH_SECONDS: u64 = 3650 * 24 * 60 * 60;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn dpapi_protect(plaintext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        let res = CryptProtectData(
            &mut data_in,
            None,
            Some(&mut entropy_blob),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut data_out,
        );

        if res.is_err() {
            return Err("CryptProtectData failed".to_string());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        let _ = LocalFree(data_out.pbData as _);
        Ok(result)
    }
}

pub fn dpapi_unprotect(ciphertext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        let res = CryptUnprotectData(
            &mut data_in,
            None,
            Some(&mut entropy_blob),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut data_out,
        );

        if res.is_err() {
            return Err("CryptUnprotectData failed".to_string());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        let _ = LocalFree(data_out.pbData as _);
        Ok(result)
    }
}

pub struct DeviceUnlockStore {
    path: PathBuf,
}

impl Default for DeviceUnlockStore {
    fn default() -> Self {
        Self {
            path: device_unlock_file(),
        }
    }
}

impl DeviceUnlockStore {
    pub fn state(&self) -> Value {
        if !cfg!(target_os = "windows") {
            return json!({ "supported": false, "enabled": false, "expiresAt": 0 });
        }
        if !self.path.exists() {
            return json!({ "supported": true, "enabled": false, "expiresAt": 0 });
        }
        if let Ok(text) = fs::read_to_string(&self.path) {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                let expires_at = val.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0);
                if expires_at > now_secs() {
                    return json!({ "supported": true, "enabled": true, "expiresAt": expires_at });
                } else {
                    let _ = self.disable();
                }
            }
        }
        json!({ "supported": true, "enabled": false, "expiresAt": 0 })
    }

    pub fn enable(&self, vault_key: &VaultKey, reauth_seconds: u64) -> Result<Value, String> {
        if !cfg!(target_os = "windows") {
            return Err("Device unlock is only supported on Windows".to_string());
        }
        let reauth = if reauth_seconds == 0 {
            DEFAULT_REAUTH_SECONDS
        } else {
            reauth_seconds
        };

        if !(MIN_REAUTH_SECONDS..=MAX_REAUTH_SECONDS).contains(&reauth) {
            return Err("Reauth interval outside supported range".to_string());
        }

        let expires_at = now_secs() + reauth;
        let binding = vault_file().to_string_lossy().to_string();
        let payload = json!({
            "key": base64::prelude::BASE64_STANDARD.encode(vault_key.key),
            "salt": base64::prelude::BASE64_STANDARD.encode(&vault_key.salt),
            "iterations": vault_key.iterations,
            "binding": binding,
        });

        let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let entropy = b"mypwdmg-device-unlock-v1";
        let protected = dpapi_protect(&payload_bytes, entropy)?;

        let record = json!({
            "version": 1,
            "expiresAt": expires_at,
            "ciphertext": base64::prelude::BASE64_STANDARD.encode(protected),
        });

        let text = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
        fs::write(&self.path, text).map_err(|e| e.to_string())?;

        Ok(json!({
            "supported": true,
            "enabled": true,
            "expiresAt": expires_at
        }))
    }

    pub fn disable(&self) -> Result<Value, String> {
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
        Ok(json!({
            "supported": true,
            "enabled": false,
            "expiresAt": 0
        }))
    }

    pub fn read_key(&self) -> Result<Value, String> {
        if !self.path.exists() {
            return Err("Device unlock is not enabled".to_string());
        }
        let text = fs::read_to_string(&self.path).map_err(|e| e.to_string())?;
        let record: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

        let expires_at = record.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0);
        if expires_at <= now_secs() {
            let _ = self.disable();
            return Err("Device unlock session expired".to_string());
        }

        let cipher_b64 = record.get("ciphertext").and_then(|s| s.as_str()).ok_or("Missing ciphertext")?;
        let cipher_bytes = base64::prelude::BASE64_STANDARD.decode(cipher_b64).map_err(|e| e.to_string())?;
        let entropy = b"mypwdmg-device-unlock-v1";

        let plaintext = dpapi_unprotect(&cipher_bytes, entropy)?;
        let key_obj: Value = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

        let binding = key_obj.get("binding").and_then(|b| b.as_str()).unwrap_or("");
        if binding != vault_file().to_string_lossy().to_string() {
            return Err("Device unlock file binding mismatch".to_string());
        }

        Ok(json!({
            "key": key_obj.get("key"),
            "salt": key_obj.get("salt"),
            "iterations": key_obj.get("iterations"),
        }))
    }
}
