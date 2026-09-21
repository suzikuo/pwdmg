use crate::crypto::{
    decrypt_payload, encrypt_payload, encrypt_payload_with_key, VaultEnvelope, VaultKey,
};
use crate::device_unlock::DeviceUnlockStore;
use crate::domain::{entry_matches_page, normalize_domain};
use crate::paths::{ensure_app_dir, legacy_local_storage_file, local_backup_dir, vault_file};
use crate::totp::generate_totp;
use serde_json::{json, Value};
use sha2::Digest;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_SESSION_TIMEOUT_SECONDS: u64 = 15 * 60;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub struct VaultService {
    vault_path: PathBuf,
    legacy_path: PathBuf,
    session: Mutex<Option<VaultSession>>,
}

struct VaultSession {
    payload: Value,
    key: VaultKey,
    expires_at_ms: u64,
}

impl Default for VaultService {
    fn default() -> Self {
        Self::new(vault_file(), legacy_local_storage_file())
    }
}

impl VaultService {
    pub fn new<P1: AsRef<Path>, P2: AsRef<Path>>(vault_path: P1, legacy_path: P2) -> Self {
        Self {
            vault_path: vault_path.as_ref().to_path_buf(),
            legacy_path: legacy_path.as_ref().to_path_buf(),
            session: Mutex::new(None),
        }
    }

    pub fn is_passwordless(&self) -> bool {
        if !self.vault_path.exists() {
            return false;
        }
        if let Ok(text) = fs::read_to_string(&self.vault_path) {
            if let Ok(env) = serde_json::from_str::<VaultEnvelope>(&text) {
                return env.passwordless.unwrap_or(false);
            }
        }
        false
    }

    fn check_or_auto_unlock(&self) {
        let now = now_ms();
        let mut lock_guard = self.session.lock().unwrap();
        if let Some(session) = lock_guard.as_ref() {
            if now > session.expires_at_ms {
                *lock_guard = None;
            }
        }
        let is_locked = lock_guard.is_none();
        drop(lock_guard);

        if is_locked && self.vault_path.exists() {
            let du = DeviceUnlockStore::default();
            if let Ok(key_val) = du.read_key() {
                let _ = self.unlock_with_device_key(&key_val);
            }
        }
    }

    pub fn state(&self) -> Value {
        let has_vault = self.vault_path.exists();
        let legacy_available = self.legacy_path.exists();
        let passwordless = self.is_passwordless();

        self.check_or_auto_unlock();

        let lock_guard = self.session.lock().unwrap();
        let (locked, expires_at) = match lock_guard.as_ref() {
            Some(s) => (false, s.expires_at_ms),
            None => (true, 0),
        };
        drop(lock_guard);

        let du = DeviceUnlockStore::default();
        let device_unlock = du.state();

        json!({
            "hasVault": has_vault,
            "legacyAvailable": legacy_available,
            "vaultPath": self.vault_path.to_string_lossy(),
            "passwordless": passwordless,
            "locked": locked,
            "expiresAt": expires_at,
            "deviceUnlock": device_unlock,
        })
    }


    pub fn storage_state(&self) -> Value {
        json!({
            "hasVault": self.vault_path.exists(),
            "legacyAvailable": self.legacy_path.exists(),
            "vaultPath": self.vault_path.to_string_lossy(),
            "passwordless": self.is_passwordless(),
        })
    }

    pub fn read_vault_envelope(&self) -> Result<String, String> {
        if !self.vault_path.exists() {
            return Err("Vault file not found".to_string());
        }
        fs::read_to_string(&self.vault_path).map_err(|e| e.to_string())
    }

    pub fn write_vault_envelope(
        &self,
        envelope_text: &str,
        protect_backup: bool,
        expected_revision: Option<u64>,
    ) -> Result<Value, String> {
        let envelope: VaultEnvelope = serde_json::from_str(envelope_text)
            .map_err(|_| "Vault envelope is not valid JSON".to_string())?;

        let current_rev = if self.vault_path.exists() {
            let current_text = fs::read_to_string(&self.vault_path).map_err(|e| e.to_string())?;
            let curr_env = serde_json::from_str::<VaultEnvelope>(&current_text)
                .map_err(|_| "Current vault envelope is invalid JSON".to_string())?;
            curr_env.revision.unwrap_or(1)
        } else {
            0
        };

        if let Some(exp_rev) = expected_revision {
            if current_rev != exp_rev {
                return Err(format!(
                    "Revision mismatch: expected {}, got {}",
                    exp_rev, current_rev
                ));
            }
        }

        if !protect_backup && current_rev > 0 {
            if let Some(new_rev) = envelope.revision {
                if new_rev != current_rev + 1 {
                    return Err(format!(
                        "Vault revision must advance by exactly one: current {}, next {}",
                        current_rev, new_rev
                    ));
                }
            }
        }

        if let Some(parent) = self.vault_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if protect_backup && self.vault_path.exists() {
            let backup_dir = local_backup_dir();
            let _ = fs::create_dir_all(&backup_dir);
            let backup_file = backup_dir.join(format!("vault-backup-{}.json", now_secs()));
            let _ = fs::copy(&self.vault_path, backup_file);
        }

        // `std::fs::rename` does not replace an existing destination on
        // Windows. Use truncate-write here so normal desktop saves and
        // password changes work after the first revision as well.
        fs::write(&self.vault_path, envelope_text).map_err(|e| e.to_string())?;

        Ok(json!({
            "saved": true,
            "revision": envelope.revision.unwrap_or(1)
        }))
    }

    pub fn unlock(&self, password: &str) -> Result<Value, String> {
        if !self.vault_path.exists() {
            return Err("Vault file does not exist".to_string());
        }

        let text = fs::read_to_string(&self.vault_path).map_err(|e| e.to_string())?;
        let envelope: VaultEnvelope = serde_json::from_str(&text)
            .map_err(|_| "Vault envelope is not valid JSON".to_string())?;

        if password.is_empty() {
            let du = DeviceUnlockStore::default();
            if let Ok(key_val) = du.read_key() {
                if self.unlock_with_device_key(&key_val).is_ok() {
                    let lock_guard = self.session.lock().unwrap();
                    let expires_at_ms = lock_guard.as_ref().map(|s| s.expires_at_ms).unwrap_or(0);
                    return Ok(json!({
                        "locked": false,
                        "expiresAt": expires_at_ms
                    }));
                }
            }
        }

        let (payload, key) = decrypt_payload(password, &envelope)
            .map_err(|e| e.to_string())?;

        let expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        let mut lock_guard = self.session.lock().unwrap();
        *lock_guard = Some(VaultSession {
            payload,
            key,
            expires_at_ms,
        });

        Ok(json!({
            "locked": false,
            "expiresAt": expires_at_ms
        }))
    }

    pub fn lock(&self) -> Value {
        let mut lock_guard = self.session.lock().unwrap();
        *lock_guard = None;
        json!({
            "locked": true,
            "expiresAt": 0
        })
    }

    /// Internal: unlock the vault using a pre-loaded device key record (no password needed).
    fn unlock_with_device_key(&self, key_val: &Value) -> Result<(), String> {
        if !self.vault_path.exists() {
            return Err("Vault file does not exist".to_string());
        }
        let key_b64 = key_val.get("key").and_then(|k| k.as_str()).ok_or("Missing key")?;
        let salt_b64 = key_val.get("salt").and_then(|s| s.as_str()).ok_or("Missing salt")?;
        let iterations = key_val.get("iterations").and_then(|i| i.as_u64()).ok_or("Missing iterations")?;

        use base64::Engine;
        let key_bytes = base64::prelude::BASE64_STANDARD.decode(key_b64).map_err(|e| e.to_string())?;
        let salt_bytes = base64::prelude::BASE64_STANDARD.decode(salt_b64).map_err(|e| e.to_string())?;

        let key_arr: [u8; 32] = key_bytes.try_into().map_err(|_| "Device key wrong length (expected 32 bytes)".to_string())?;
        let salt_arr: [u8; 16] = salt_bytes.try_into().map_err(|_| "Device salt wrong length (expected 16 bytes)".to_string())?;

        let text = fs::read_to_string(&self.vault_path).map_err(|e| e.to_string())?;
        let envelope: VaultEnvelope = serde_json::from_str(&text)
            .map_err(|_| "Vault envelope is not valid JSON".to_string())?;

        let vault_key = VaultKey {
            key: key_arr,
            salt: salt_arr,
            iterations: iterations as u32,
        };

        use crate::crypto::decrypt_payload_with_key;
        let payload = decrypt_payload_with_key(&vault_key, &envelope)
            .map_err(|e| e.to_string())?;

        let expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        let mut lock_guard = self.session.lock().unwrap();
        *lock_guard = Some(VaultSession {
            payload,
            key: vault_key,
            expires_at_ms,
        });
        Ok(())
    }


    pub fn device_unlock_state(&self) -> Value {
        DeviceUnlockStore::default().state()
    }

    pub fn enable_device_unlock(&self, password: &str, reauth_seconds: u64) -> Result<Value, String> {
        let text = fs::read_to_string(&self.vault_path).map_err(|e| e.to_string())?;
        let envelope: VaultEnvelope = serde_json::from_str(&text)
            .map_err(|_| "Vault envelope is not valid JSON".to_string())?;
        let (_payload, vault_key) = decrypt_payload(password, &envelope)
            .map_err(|_| "密码不正确".to_string())?;

        DeviceUnlockStore::default().enable(&vault_key, reauth_seconds)
    }

    pub fn disable_device_unlock(&self) -> Result<Value, String> {
        DeviceUnlockStore::default().disable()
    }

    pub fn read_device_unlock_key(&self) -> Result<Value, String> {
        DeviceUnlockStore::default().read_key()
    }

    pub fn create_vault(&self, password: &str, _import_legacy: bool) -> Result<Value, String> {
        ensure_app_dir().map_err(|e| e.to_string())?;
        let initial_payload = json!({
            "version": 1,
            "revision": 1,
            "entries": [],
            "settings": {}
        });

        let (envelope, vault_key) = encrypt_payload(password, &initial_payload, None)
            .map_err(|e| e.to_string())?;

        let env_text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        self.write_vault_envelope(&env_text, false, None)?;

        let expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        let mut lock_guard = self.session.lock().unwrap();
        *lock_guard = Some(VaultSession {
            payload: initial_payload,
            key: vault_key,
            expires_at_ms,
        });

        Ok(json!({
            "created": true,
            "locked": false,
            "expiresAt": expires_at_ms
        }))
    }

    pub fn get_vault(&self) -> Result<Value, String> {
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        if let Some(session) = lock_guard.as_mut() {
            if now > session.expires_at_ms {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
            session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
            return Ok(session.payload.clone());
        }
        Err("Vault is locked".to_string())
    }

    pub fn save_vault(&self, new_payload: &Value, expected_revision: Option<u64>) -> Result<Value, String> {
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };

        let current_rev = session.payload.get("revision").and_then(|r| r.as_u64()).unwrap_or(1);
        if let Some(exp) = expected_revision {
            if exp != current_rev {
                return Err(format!("Conflict: current revision is {}, expected {}", current_rev, exp));
            }
        }

        let next_rev = current_rev + 1;
        let mut payload_to_save = new_payload.clone();
        if let Some(obj) = payload_to_save.as_object_mut() {
            obj.insert("revision".to_string(), Value::Number(next_rev.into()));
        }

        let envelope = encrypt_payload_with_key(&session.key, &payload_to_save)
            .map_err(|e| e.to_string())?;
        let env_text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        drop(lock_guard);

        self.write_vault_envelope(&env_text, false, Some(current_rev))?;

        let mut lock_guard = self.session.lock().unwrap();
        if let Some(s) = lock_guard.as_mut() {
            s.payload = payload_to_save;
            s.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        }

        Ok(json!({ "saved": true, "revision": next_rev }))
    }

    pub fn change_password(&self, new_password: &str) -> Result<Value, String> {
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };

        let (new_envelope, new_key) = encrypt_payload(new_password, &session.payload, None)
            .map_err(|e| e.to_string())?;
        let env_text = serde_json::to_string_pretty(&new_envelope).map_err(|e| e.to_string())?;

        let temp_path = self.vault_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        fs::write(&temp_path, &env_text).map_err(|e| e.to_string())?;
        fs::rename(&temp_path, &self.vault_path).map_err(|e| e.to_string())?;

        session.key = new_key;
        session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;

        Ok(json!({ "passwordChanged": true }))
    }

    pub fn export_backup(&self) -> Result<Value, String> {
        let envelope_text = self.read_vault_envelope()?;
        Ok(json!({ "envelope": envelope_text }))
    }

    pub fn import_backup(&self, envelope_text: &str) -> Result<Value, String> {
        self.write_vault_envelope(envelope_text, true, None)?;
        self.lock();
        Ok(json!({ "imported": true }))
    }

    pub fn read_legacy_local_storage(&self) -> Result<String, String> {
        if !self.legacy_path.exists() {
            return Err("Legacy storage file not found".to_string());
        }
        fs::read_to_string(&self.legacy_path).map_err(|e| e.to_string())
    }

    pub fn cleanup_legacy_storage(&self, expected_digest: &str, _expected_vault_digest: Option<&str>) -> Result<Value, String> {
        if !self.legacy_path.exists() {
            return Ok(json!({ "cleaned": false, "reason": "not_found" }));
        }
        let content = fs::read(&self.legacy_path).map_err(|e| e.to_string())?;
        let digest = format!("{:x}", sha2::Sha256::digest(&content));
        if digest != expected_digest {
            return Err("Digest mismatch for legacy file".to_string());
        }
        fs::remove_file(&self.legacy_path).map_err(|e| e.to_string())?;
        Ok(json!({ "cleaned": true }))
    }

    // --- Browser Extension Integration APIs ---

    pub fn query_matches(&self, hostname: &str, page_url: &str) -> Result<Vec<Value>, String> {
        self.check_or_auto_unlock();
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };
        session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;

        let host = normalize_domain(hostname, false);
        let mut results = Vec::new();

        if let Some(entries) = session.payload.get("entries").and_then(|e| e.as_array()) {
            Self::collect_matching_logins(entries, &host, page_url, &mut results);
        }

        Ok(results)
    }

    fn collect_matching_logins(
        entries: &[Value],
        hostname: &str,
        page_url: &str,
        matches: &mut Vec<Value>,
    ) {
        for entry in entries {
            let status = entry.get("status").and_then(|s| s.as_str()).unwrap_or("active");
            if status != "active" {
                continue;
            }

            let kind = entry.get("kind").and_then(|k| k.as_str()).unwrap_or("");
            if kind == "folder" {
                if let Some(children) = entry.get("children").and_then(|c| c.as_array()) {
                    Self::collect_matching_logins(children, hostname, page_url, matches);
                }
            } else if kind == "login" || kind.is_empty() {
                if entry_matches_page(entry, hostname, page_url) {
                    matches.push(json!({
                        "id": entry.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": entry.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "username": entry.get("username").and_then(|v| v.as_str()).unwrap_or(""),
                        "email": entry.get("email").and_then(|v| v.as_str()).unwrap_or(""),
                        "phone": entry.get("phone").and_then(|v| v.as_str()).unwrap_or(""),
                        "loginAccountSource": entry.get("loginAccountSource").and_then(|v| v.as_str()).unwrap_or("auto"),
                        "autofillMatchMode": entry.get("autofillMatchMode").and_then(|v| v.as_str()).unwrap_or("base-domain"),
                        "domains": entry.get("domains").cloned().unwrap_or(Value::Array(Vec::new())),
                        "hasPassword": !entry.get("password").and_then(|v| v.as_str()).unwrap_or("").is_empty(),
                        "hasTotp": !entry.get("totpSecret").and_then(|v| v.as_str()).unwrap_or("").is_empty(),
                        "kind": "login",
                        "matchType": "domain",
                    }));
                }
            }
        }
    }

    pub fn get_fill_payload_for_host(
        &self,
        entry_id: &str,
        hostname: &str,
        page_url: &str,
    ) -> Result<Value, String> {
        self.check_or_auto_unlock();
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };
        session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;

        let host = normalize_domain(hostname, false);
        if host.is_empty() {
            return Err("Fill hostname is required".to_string());
        }

        let entry = Self::find_entry_recursive(
            session.payload.get("entries").and_then(|e| e.as_array()).map(|v| v.as_slice()).unwrap_or(&[]),
            entry_id,
        ).ok_or_else(|| "Entry not found".to_string())?;

        if !entry_matches_page(&entry, &host, page_url) {
            return Err("Entry is not authorized for this site".to_string());
        }

        let totp_code = entry
            .get("totpSecret")
            .and_then(|v| v.as_str())
            .map(|secret| generate_totp(secret, None).unwrap_or_default())
            .unwrap_or_default();

        Ok(json!({
            "id": entry.get("id"),
            "title": entry.get("title"),
            "username": entry.get("username").unwrap_or(&Value::String(String::new())),
            "email": entry.get("email").unwrap_or(&Value::String(String::new())),
            "password": entry.get("password").unwrap_or(&Value::String(String::new())),
            "phone": entry.get("phone").unwrap_or(&Value::String(String::new())),
            "loginAccountSource": entry.get("loginAccountSource").unwrap_or(&Value::String("auto".to_string())),
            "totp": totp_code,
        }))
    }

    pub fn list_save_targets(&self) -> Result<Value, String> {
        self.check_or_auto_unlock();
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };
        session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;

        let mut folders = Vec::new();
        if let Some(entries) = session.payload.get("entries").and_then(|e| e.as_array()) {
            Self::collect_folders(entries, "", &mut folders);
        }

        Ok(json!({ "folders": folders }))
    }

    fn collect_folders(entries: &[Value], parent_path: &str, list: &mut Vec<Value>) {
        for entry in entries {
            if entry.get("kind").and_then(|k| k.as_str()) == Some("folder") {
                let name = entry.get("title").and_then(|t| t.as_str()).unwrap_or("Folder");
                let current_path = if parent_path.is_empty() {
                    name.to_string()
                } else {
                    format!("{}/{}", parent_path, name)
                };
                list.push(json!({
                    "id": entry.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                    "title": name,
                    "path": current_path,
                }));
                if let Some(children) = entry.get("children").and_then(|c| c.as_array()) {
                    Self::collect_folders(children, &current_path, list);
                }
            }
        }
    }

    pub fn preview_captured_login(&self, capture: &Value) -> Result<Value, String> {
        self.check_or_auto_unlock();
        let mut lock_guard = self.session.lock().unwrap();
        let now = now_ms();
        let session = match lock_guard.as_mut() {
            Some(s) if now <= s.expires_at_ms => s,
            _ => {
                *lock_guard = None;
                return Err("Vault is locked".to_string());
            }
        };
        session.expires_at_ms = now + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;

        let hostname = capture.get("hostname").and_then(|h| h.as_str()).unwrap_or("");
        let username = capture.get("username").and_then(|u| u.as_str()).unwrap_or("");
        let password = capture.get("password").and_then(|p| p.as_str()).unwrap_or("");

        if password.is_empty() {
            return Err("Captured password is empty".to_string());
        }

        let mut folders = Vec::new();
        if let Some(entries) = session.payload.get("entries").and_then(|e| e.as_array()) {
            Self::collect_folders(entries, "", &mut folders);
        }

        // Search for existing entry matching hostname and username
        let candidate = Self::find_candidate(
            session.payload.get("entries").and_then(|e| e.as_array()).map(|v| v.as_slice()).unwrap_or(&[]),
            hostname,
            username,
        );

        let (update_candidate, password_same) = match candidate {
            Some(entry) => {
                let same = entry.get("password").and_then(|p| p.as_str()) == Some(password);
                (Some(json!({
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "username": entry.get("username"),
                })), same)
            }
            None => (None, false),
        };

        Ok(json!({
            "hostname": hostname,
            "title": capture.get("title").unwrap_or(&Value::String(hostname.to_string())),
            "accountLabel": username,
            "accountKind": "username",
            "folders": folders,
            "updateCandidate": update_candidate,
            "passwordSame": password_same,
            "shouldPrompt": !password_same,
        }))
    }

    fn find_candidate(entries: &[Value], hostname: &str, username: &str) -> Option<Value> {
        for entry in entries {
            if entry.get("kind").and_then(|k| k.as_str()) == Some("folder") {
                if let Some(children) = entry.get("children").and_then(|c| c.as_array()) {
                    if let Some(found) = Self::find_candidate(children, hostname, username) {
                        return Some(found);
                    }
                }
            } else if entry.get("kind").and_then(|k| k.as_str()) == Some("login") || entry.get("kind").is_none() {
                if entry_matches_page(entry, hostname, "") {
                    let u = entry.get("username").and_then(|v| v.as_str()).unwrap_or("");
                    let e = entry.get("email").and_then(|v| v.as_str()).unwrap_or("");
                    if (!username.is_empty() && (u == username || e == username)) || (username.is_empty() && u.is_empty() && e.is_empty()) {
                        return Some(entry.clone());
                    }
                }
            }
        }
        None
    }

    pub fn save_captured_login(
        &self,
        capture: &Value,
        parent_id: &str,
        update_entry_id: &str,
    ) -> Result<Value, String> {
        let mut vault_payload = self.get_vault()?;
        let password = capture.get("password").and_then(|p| p.as_str()).unwrap_or("");
        if password.is_empty() {
            return Err("Captured password is empty".to_string());
        }

        let action;
        let result_entry;

        if !update_entry_id.is_empty() {
            // Update existing entry
            let entry = Self::find_entry_mut(
                vault_payload.get_mut("entries").and_then(|e| e.as_array_mut()).ok_or("No entries in vault")?,
                update_entry_id,
            ).ok_or_else(|| "Entry not found".to_string())?;

            if let Some(obj) = entry.as_object_mut() {
                obj.insert("password".to_string(), Value::String(password.to_string()));
                if let Some(u) = capture.get("username").and_then(|u| u.as_str()) {
                    if !u.is_empty() {
                        obj.insert("username".to_string(), Value::String(u.to_string()));
                    }
                }
                obj.insert("updatedAt".to_string(), json!(now_secs()));
            }
            action = "updated";
            result_entry = entry.clone();
        } else {
            // Create new entry
            let new_id = uuid::Uuid::new_v4().to_string();
            let hostname = capture.get("hostname").and_then(|h| h.as_str()).unwrap_or("");
            let title = capture.get("title").and_then(|t| t.as_str()).unwrap_or(hostname);
            let username = capture.get("username").and_then(|u| u.as_str()).unwrap_or("");

            let new_entry = json!({
                "id": new_id,
                "kind": "login",
                "title": title,
                "username": username,
                "password": password,
                "domains": [hostname],
                "autofillMatchMode": "base-domain",
                "createdAt": now_secs(),
                "updatedAt": now_secs(),
                "status": "active",
            });

            if parent_id.is_empty() {
                if let Some(entries) = vault_payload.get_mut("entries").and_then(|e| e.as_array_mut()) {
                    entries.insert(0, new_entry.clone());
                }
            } else {
                let folder = Self::find_entry_mut(
                    vault_payload.get_mut("entries").and_then(|e| e.as_array_mut()).ok_or("No entries")?,
                    parent_id,
                ).ok_or_else(|| "Target folder not found".to_string())?;

                if folder.get("kind").and_then(|k| k.as_str()) != Some("folder") {
                    return Err("Target is not a folder".to_string());
                }
                let children = folder.as_object_mut().unwrap().entry("children".to_string()).or_insert_with(|| json!([]));
                if let Some(arr) = children.as_array_mut() {
                    arr.insert(0, new_entry.clone());
                }
            }
            action = "created";
            result_entry = new_entry;
        }

        let save_res = self.save_vault(&vault_payload, None)?;
        Ok(json!({
            "action": action,
            "entry": result_entry,
            "saved": save_res
        }))
    }

    pub fn generate_totp_for_entry(&self, entry_id: &str) -> Result<Value, String> {
        let vault_payload = self.get_vault()?;
        let entry = Self::find_entry_recursive(
            vault_payload.get("entries").and_then(|e| e.as_array()).map(|v| v.as_slice()).unwrap_or(&[]),
            entry_id,
        ).ok_or_else(|| "Entry not found".to_string())?;

        let secret = entry.get("totpSecret").and_then(|s| s.as_str()).unwrap_or("");
        let code = generate_totp(secret, None)?;
        Ok(json!({ "code": code }))
    }

    fn find_entry_recursive(entries: &[Value], id: &str) -> Option<Value> {
        for entry in entries {
            if entry.get("id").and_then(|i| i.as_str()) == Some(id) {
                return Some(entry.clone());
            }
            if let Some(children) = entry.get("children").and_then(|c| c.as_array()) {
                if let Some(found) = Self::find_entry_recursive(children, id) {
                    return Some(found);
                }
            }
        }
        None
    }

    fn find_entry_mut<'a>(entries: &'a mut [Value], id: &str) -> Option<&'a mut Value> {
        for entry in entries {
            if entry.get("id").and_then(|i| i.as_str()) == Some(id) {
                return Some(entry);
            }
            if let Some(children) = entry.get_mut("children").and_then(|c| c.as_array_mut()) {
                if let Some(found) = Self::find_entry_mut(children, id) {
                    return Some(found);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_vault_envelope_revision_lifecycle() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_rev_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let (env1, _) = encrypt_payload("pwd", &json!({"revision": 1, "entries": []}), None).unwrap();
        let initial_str = serde_json::to_string(&env1).unwrap();

        // 1. Initial write with expected_revision = 0 succeeds
        let res = service.write_vault_envelope(&initial_str, false, Some(0));
        assert!(res.is_ok(), "Initial write should succeed: {:?}", res);

        // 2. Advance to revision 2 with expected_revision = 1 succeeds
        let (env2, _) = encrypt_payload("pwd", &json!({"revision": 2, "entries": []}), None).unwrap();
        let rev2_str = serde_json::to_string(&env2).unwrap();
        let res2 = service.write_vault_envelope(&rev2_str, false, Some(1));
        assert!(res2.is_ok(), "Advance to rev 2 should succeed: {:?}", res2);

        // 3. Trying to write again with stale expected_revision = 1 fails with mismatch
        let (env3, _) = encrypt_payload("pwd", &json!({"revision": 3, "entries": []}), None).unwrap();
        let rev3_str = serde_json::to_string(&env3).unwrap();
        let stale_res = service.write_vault_envelope(&rev3_str, false, Some(1));
        assert!(stale_res.is_err(), "Stale revision check must fail");
        let err_msg = stale_res.unwrap_err();
        assert!(err_msg.contains("Revision mismatch: expected 1, got 2"), "Got: {}", err_msg);

        // 4. Writing without single-step increment (e.g. rev 10) fails
        let (env10, _) = encrypt_payload("pwd", &json!({"revision": 10, "entries": []}), None).unwrap();
        let jump_str = serde_json::to_string(&env10).unwrap();
        let jump_res = service.write_vault_envelope(&jump_str, false, Some(2));
        assert!(jump_res.is_err(), "Non-sequential revision should fail");
        assert!(jump_res.unwrap_err().contains("must advance by exactly one"));

        // 5. Restore backup allows arbitrary revision
        let (env50, _) = encrypt_payload("pwd", &json!({"revision": 50, "entries": []}), None).unwrap();
        let backup_str = serde_json::to_string(&env50).unwrap();
        let backup_res = service.write_vault_envelope(&backup_str, true, Some(2));
        assert!(backup_res.is_ok(), "Backup restore should succeed: {:?}", backup_res);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_write_vault_envelope_persists_new_content() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_write_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let (env1, _) = encrypt_payload("old", &json!({"revision": 1, "entries": []}), None).unwrap();
        let env1_text = serde_json::to_string(&env1).unwrap();
        service.write_vault_envelope(&env1_text, false, Some(0)).unwrap();
        assert_eq!(fs::read_to_string(&vault_file).unwrap(), env1_text);

        let (env2, _) = encrypt_payload("new", &json!({"revision": 2, "entries": []}), None).unwrap();
        let env2_text = serde_json::to_string(&env2).unwrap();
        service.write_vault_envelope(&env2_text, false, Some(1)).unwrap();
        assert_eq!(fs::read_to_string(&vault_file).unwrap(), env2_text);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_query_matches_returns_all_metadata_fields() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_qm_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file, legacy_file);

        let test_entries = json!({
            "revision": 1,
            "entries": [
                {
                    "id": "login-1",
                    "kind": "login",
                    "title": "Example Site",
                    "username": "user1",
                    "email": "user1@example.com",
                    "password": "secretpassword",
                    "phone": "13800138000",
                    "loginAccountSource": "email",
                    "domains": ["example.com"],
                    "autofillMatchMode": "base-domain",
                    "status": "active"
                }
            ]
        });

        let (env, _) = encrypt_payload("pwd123", &test_entries, None).unwrap();
        let env_str = serde_json::to_string(&env).unwrap();
        service.write_vault_envelope(&env_str, false, Some(0)).unwrap();
        service.unlock("pwd123").unwrap();

        let matches = service.query_matches("example.com", "https://example.com/login").unwrap();
        assert_eq!(matches.len(), 1);
        let m = &matches[0];
        assert_eq!(m["id"], "login-1");
        assert_eq!(m["title"], "Example Site");
        assert_eq!(m["username"], "user1");
        assert_eq!(m["email"], "user1@example.com");
        assert_eq!(m["phone"], "13800138000");
        assert_eq!(m["loginAccountSource"], "email");
        assert_eq!(m["autofillMatchMode"], "base-domain");
        assert_eq!(m["domains"], json!(["example.com"]));
        assert_eq!(m["hasPassword"], true);
        assert_eq!(m["hasTotp"], false);

        let _ = fs::remove_dir_all(dir);
    }
}
