use crate::api_error::{BAD_PASSWORD_MESSAGE, LOCKED_MESSAGE, MANUAL_LOCK_MESSAGE};
use crate::crypto::{
    decrypt_payload, decrypt_payload_with_key, encrypt_payload, encrypt_payload_with_key,
    payload_version_for_encryption, validate_envelope, VaultCryptoError, VaultEnvelope, VaultKey,
};
use crate::device_unlock::DeviceUnlockStore;
use crate::domain::{entry_matches_page, normalize_domain};
use crate::paths::{atomic_write_file, backup_vault_file, legacy_local_storage_file, vault_file};
use crate::totp::generate_totp;
use serde_json::{json, Value};
use sha2::Digest;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_SESSION_TIMEOUT_SECONDS: u64 = 15 * 60;
const MAX_VAULT_ENVELOPE_TEXT_LENGTH: usize = 24 * 1024 * 1024;

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

pub fn default_vault_payload(entries: Vec<Value>) -> Value {
    json!({
        "version": 2,
        "passkeySchemaVersion": 1,
        "revision": 1,
        "entries": entries,
        "passkeys": [],
        "passkeyTombstones": [],
        "settings": {
            "oss": {
                "bucketName": "",
                "accessKeyId": "",
                "accessKeySecret": "",
                "region": "",
                "objectName": "pwd/mypwdmg-vault.json",
                "autoSync": false,
                "autoSyncIntervalMinutes": 1
            }
        },
        "updatedAt": now_secs()
    })
}

fn parse_and_validate_envelope(envelope_text: &str) -> Result<VaultEnvelope, String> {
    if envelope_text.len() > MAX_VAULT_ENVELOPE_TEXT_LENGTH {
        return Err("Vault file exceeds the safe size limit".to_string());
    }
    let envelope: VaultEnvelope = serde_json::from_str(envelope_text)
        .map_err(|_| "Vault envelope is not valid JSON".to_string())?;
    validate_envelope(&envelope).map_err(|e| format!("Invalid vault envelope: {e}"))?;
    Ok(envelope)
}

fn map_decrypt_error(err: VaultCryptoError) -> String {
    match err {
        VaultCryptoError::WrongPasswordOrCorrupted => BAD_PASSWORD_MESSAGE.to_string(),
        other => other.to_string(),
    }
}

fn ensure_v2_metadata(payload: &mut Value) {
    if payload_version_for_encryption(payload) == 2 {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("version".to_string(), Value::from(2));
            obj.entry("passkeySchemaVersion".to_string())
                .or_insert_with(|| Value::from(1));
            if !obj.get("passkeys").is_some_and(Value::is_array) {
                obj.insert("passkeys".to_string(), json!([]));
            }
            if !obj.get("passkeyTombstones").is_some_and(Value::is_array) {
                obj.insert("passkeyTombstones".to_string(), json!([]));
            }
        }
    }
}

fn assert_no_version_downgrade(current: &Value, next: &Value) -> Result<(), String> {
    if payload_version_for_encryption(current) == 2 && payload_version_for_encryption(next) < 2 {
        return Err("Refusing to downgrade a version 2 vault".to_string());
    }
    Ok(())
}

pub struct VaultService {
    vault_path: PathBuf,
    legacy_path: PathBuf,
    state: Mutex<VaultState>,
    device_unlock: DeviceUnlockStore,
}

#[derive(Default)]
struct VaultState {
    session: Option<VaultSession>,
    manually_locked: bool,
}

struct VaultSession {
    payload: Value,
    key: VaultKey,
    passwordless: Option<bool>,
    expires_at_ms: u64,
    unlocked_at_ms: u64,
    vault_file_stamp: Option<(u64, u64)>,
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
            state: Mutex::new(VaultState::default()),
            device_unlock: DeviceUnlockStore::for_vault(vault_path.as_ref().to_path_buf()),
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

    fn lock_epoch_path(&self) -> PathBuf {
        self.vault_path.with_file_name("lock.epoch")
    }

    fn read_lock_epoch(&self) -> Option<u64> {
        fs::read_to_string(self.lock_epoch_path())
            .ok()
            .and_then(|text| text.trim().parse::<u64>().ok())
    }

    fn write_lock_epoch(&self) {
        let prev = self.read_lock_epoch().unwrap_or(0);
        let epoch = now_ms().max(prev).saturating_add(1);
        let path = self.lock_epoch_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = atomic_write_file(&path, epoch.to_string().as_bytes());
    }

    fn session_unlock_timestamp(&self) -> u64 {
        now_ms().max(self.read_lock_epoch().unwrap_or(0))
    }

    fn current_vault_file_stamp(&self) -> Option<(u64, u64)> {
        let meta = fs::metadata(&self.vault_path).ok()?;
        let len = meta.len();
        let mtime_nanos = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        Some((len, mtime_nanos))
    }

    fn is_invalidated_by_lock_epoch(&self, session: &VaultSession) -> bool {
        self.read_lock_epoch()
            .is_some_and(|epoch| epoch > session.unlocked_at_ms)
    }

    fn check_or_auto_unlock(&self) {
        let now = now_ms();
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if lock_guard.manually_locked {
            return;
        }
        if let Some(session) = lock_guard.session.as_ref() {
            if self.is_invalidated_by_lock_epoch(session) {
                lock_guard.session = None;
                lock_guard.manually_locked = true;
                return;
            }
            if now > session.expires_at_ms {
                lock_guard.session = None;
            }
        }
        if lock_guard.session.is_none() && self.vault_path.exists() {
            if let Ok(key) = self.device_unlock.read_key() {
                lock_guard.session = self.session_from_device_key(&key).ok();
            }
        }
    }

    fn build_state_locked(&self, lock_guard: &VaultState) -> Value {
        let has_vault = self.vault_path.exists();
        let legacy_available = self.legacy_path.exists();
        let passwordless = self.is_passwordless();
        let now = now_ms();
        let (locked, expires_at) = match lock_guard.session.as_ref() {
            Some(s) if now <= s.expires_at_ms => (false, s.expires_at_ms / 1000),
            _ => (true, 0),
        };
        let device_unlock = self.device_unlock.state();

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

    pub fn state(&self) -> Value {
        self.check_or_auto_unlock();
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if lock_guard.session.is_some() {
            let _ = self.refresh_session_if_needed(&mut lock_guard, false);
        }
        self.build_state_locked(&lock_guard)
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
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.persist_envelope(&mut state, envelope_text, protect_backup, expected_revision)
    }

    fn persist_envelope(
        &self,
        state: &mut VaultState,
        envelope_text: &str,
        protect_backup: bool,
        expected_revision: Option<u64>,
    ) -> Result<Value, String> {
        let envelope = parse_and_validate_envelope(envelope_text)?;

        let mut backup_path: Option<PathBuf> = None;
        let (current_rev, key_changed) = match fs::read(&self.vault_path) {
            Ok(current_bytes) => {
                let current: VaultEnvelope = serde_json::from_slice(&current_bytes)
                    .map_err(|_| "Current vault envelope is invalid JSON".to_string())?;
                if current.version == 2 && envelope.version == 1 {
                    return Err("Invalid vault envelope: cannot downgrade a v2 vault to v1".to_string());
                }
                let current_rev = current.revision.unwrap_or(1);
                Self::check_revision(current_rev, expected_revision)?;
                if protect_backup {
                    backup_path = Some(backup_vault_file(&self.vault_path, &current_bytes)?);
                }
                (current_rev, current.kdf != envelope.kdf)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Self::check_revision(0, expected_revision)?;
                (0, false)
            }
            Err(e) => return Err(e.to_string()),
        };

        if !protect_backup && current_rev > 0 {
            if let Some(new_rev) = envelope.revision {
                if current_rev.checked_add(1) != Some(new_rev) {
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
        if key_changed || protect_backup {
            self.device_unlock.disable()?;
        }
        atomic_write_file(&self.vault_path, envelope_text.as_bytes())?;
        if key_changed || protect_backup {
            state.session = None;
        }
        if protect_backup {
            state.manually_locked = true;
        }

        Ok(json!({
            "saved": true,
            "revision": envelope.revision.unwrap_or(1),
            "vaultPath": self.vault_path.to_string_lossy(),
            "backupPath": backup_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        }))
    }

    fn verify_persisted_envelope(&self, key: &VaultKey, expected_revision: u64) -> Result<(), String> {
        let persisted_text = self
            .read_vault_envelope()
            .map_err(|_| "保险库写入校验失败，修改未生效".to_string())?;
        let persisted_env = parse_and_validate_envelope(&persisted_text)
            .map_err(|_| "保险库写入校验失败，修改未生效".to_string())?;
        let persisted_payload = decrypt_payload_with_key(key, &persisted_env)
            .map_err(|_| "保险库写入校验失败，修改未生效".to_string())?;
        let persisted_rev = persisted_payload
            .get("revision")
            .and_then(Value::as_u64)
            .unwrap_or(1);
        if persisted_rev != expected_revision {
            return Err("保险库写入校验失败，修改未生效".to_string());
        }
        Ok(())
    }

    fn refresh_session_if_needed<'a>(
        &self,
        lock_guard: &'a mut VaultState,
        extend_timeout: bool,
    ) -> Result<&'a mut VaultSession, String> {
        let now = now_ms();
        let (invalidated_by_epoch, expired, needs_reload, disk_stamp) = {
            let Some(session) = lock_guard.session.as_ref() else {
                return Err(LOCKED_MESSAGE.to_string());
            };
            if self.is_invalidated_by_lock_epoch(session) {
                (true, false, false, None)
            } else if now > session.expires_at_ms {
                (false, true, false, None)
            } else {
                let disk_stamp = self.current_vault_file_stamp();
                (false, false, disk_stamp != session.vault_file_stamp, disk_stamp)
            }
        };

        if invalidated_by_epoch {
            lock_guard.session = None;
            lock_guard.manually_locked = true;
            return Err(LOCKED_MESSAGE.to_string());
        }
        if expired {
            lock_guard.session = None;
            return Err(LOCKED_MESSAGE.to_string());
        }

        if needs_reload {
            if disk_stamp.is_none() {
                lock_guard.session = None;
                return Err(LOCKED_MESSAGE.to_string());
            }
            let reloaded = {
                let session = lock_guard.session.as_ref().unwrap();
                let env_text = match self.read_vault_envelope() {
                    Ok(t) => t,
                    Err(_) => {
                        lock_guard.session = None;
                        return Err(LOCKED_MESSAGE.to_string());
                    }
                };
                let envelope = match parse_and_validate_envelope(&env_text) {
                    Ok(e) => e,
                    Err(_) => {
                        lock_guard.session = None;
                        return Err(LOCKED_MESSAGE.to_string());
                    }
                };
                let payload = match decrypt_payload_with_key(&session.key, &envelope) {
                    Ok(p) => p,
                    Err(_) => {
                        lock_guard.session = None;
                        return Err(LOCKED_MESSAGE.to_string());
                    }
                };
                assert_no_version_downgrade(&session.payload, &payload)?;
                (payload, envelope.passwordless)
            };

            let session = lock_guard.session.as_mut().unwrap();
            session.payload = reloaded.0;
            session.passwordless = reloaded.1;
            session.vault_file_stamp = disk_stamp;
        }

        let session = lock_guard.session.as_mut().unwrap();
        if extend_timeout {
            session.expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        }
        Ok(session)
    }

    fn require_fresh_session<'a>(
        &self,
        lock_guard: &'a mut VaultState,
    ) -> Result<&'a mut VaultSession, String> {
        self.refresh_session_if_needed(lock_guard, true)
    }

    fn check_revision(current: u64, expected: Option<u64>) -> Result<(), String> {
        if let Some(expected) = expected {
            if current != expected {
                return Err(format!("Revision mismatch: expected {expected}, got {current}"));
            }
        }
        Ok(())
    }

    fn envelope_for_unlock(&self) -> Result<VaultEnvelope, String> {
        let text = self.read_vault_envelope()?;
        serde_json::from_str(&text).map_err(|_| BAD_PASSWORD_MESSAGE.to_string())
    }

    fn unlock_inner(&self, password: &str) -> Result<(Value, Value, u64), String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let envelope = self.envelope_for_unlock()?;

        if password.is_empty() && !state.manually_locked {
            if let Ok(key) = self.device_unlock.read_key() {
                if let Ok(session) = self.session_from_device_key(&key) {
                    let expires_at_secs = session.expires_at_ms / 1000;
                    let payload = session.payload.clone();
                    state.session = Some(session);
                    state.manually_locked = false;
                    let state_val = self.build_state_locked(&state);
                    return Ok((state_val, payload, expires_at_secs));
                }
            }
        }

        let (payload, key) = decrypt_payload(password, &envelope)
            .map_err(|_| BAD_PASSWORD_MESSAGE.to_string())?;
        let expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        let expires_at_secs = expires_at_ms / 1000;
        let passwordless = Some(password.is_empty());
        state.session = Some(VaultSession {
            payload: payload.clone(),
            key,
            passwordless: envelope.passwordless.or(passwordless),
            expires_at_ms,
            unlocked_at_ms: self.session_unlock_timestamp(),
            vault_file_stamp: self.current_vault_file_stamp(),
        });
        state.manually_locked = false;
        let state_val = self.build_state_locked(&state);
        Ok((state_val, payload, expires_at_secs))
    }

    pub fn unlock(&self, password: &str) -> Result<Value, String> {
        let (_, _, expires_at_secs) = self.unlock_inner(password)?;
        Ok(json!({
            "locked": false,
            "expiresAt": expires_at_secs
        }))
    }

    pub fn unlock_with_payload(&self, password: &str) -> Result<Value, String> {
        let (state_val, payload, _) = self.unlock_inner(password)?;
        Ok(json!({
            "state": state_val,
            "payload": payload,
        }))
    }

    pub fn lock(&self) -> Value {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        lock_guard.manually_locked = true;
        lock_guard.session = None;
        self.write_lock_epoch();
        self.build_state_locked(&lock_guard)
    }

    fn session_from_device_key(&self, key_val: &Value) -> Result<VaultSession, String> {
        let key_b64 = key_val.get("key").and_then(|k| k.as_str()).ok_or("Missing key")?;
        let salt_b64 = key_val.get("salt").and_then(|s| s.as_str()).ok_or("Missing salt")?;
        let iterations = key_val.get("iterations").and_then(|i| i.as_u64()).ok_or("Missing iterations")?;

        use base64::Engine;
        let key_bytes = base64::prelude::BASE64_STANDARD.decode(key_b64).map_err(|e| e.to_string())?;
        let salt_bytes = base64::prelude::BASE64_STANDARD.decode(salt_b64).map_err(|e| e.to_string())?;

        let key_arr: [u8; 32] = key_bytes.try_into().map_err(|_| "Device key wrong length (expected 32 bytes)".to_string())?;
        let salt_arr: [u8; 16] = salt_bytes.try_into().map_err(|_| "Device salt wrong length (expected 16 bytes)".to_string())?;

        let envelope = self.envelope_for_unlock()?;
        let vault_key = VaultKey {
            key: key_arr,
            salt: salt_arr,
            iterations: u32::try_from(iterations).map_err(|_| "Invalid device key iterations")?,
        };
        let payload = decrypt_payload_with_key(&vault_key, &envelope)
            .map_err(|_| BAD_PASSWORD_MESSAGE.to_string())?;
        Ok(VaultSession {
            payload,
            key: vault_key,
            passwordless: envelope.passwordless,
            expires_at_ms: now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000,
            unlocked_at_ms: self.session_unlock_timestamp(),
            vault_file_stamp: self.current_vault_file_stamp(),
        })
    }

    pub fn device_unlock_state(&self) -> Value {
        let _state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.device_unlock.state()
    }

    pub fn enable_device_unlock(&self, password: &str, reauth_seconds: u64) -> Result<Value, String> {
        let _state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let envelope = self.envelope_for_unlock()?;
        let (_, vault_key) = decrypt_payload(password, &envelope)
            .map_err(|_| BAD_PASSWORD_MESSAGE.to_string())?;
        self.device_unlock.enable(&vault_key, reauth_seconds)
    }

    pub fn disable_device_unlock(&self) -> Result<Value, String> {
        let _state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.device_unlock.disable()
    }

    pub fn read_device_unlock_key(&self) -> Result<Value, String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let key = self.device_unlock.read_key()?;
        state.session = Some(self.session_from_device_key(&key)?);
        state.manually_locked = false;
        Ok(key)
    }

    fn quick_unlock_inner(&self) -> Result<(Value, Value), String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.manually_locked {
            return Err(MANUAL_LOCK_MESSAGE.to_string());
        }
        let key = self.device_unlock.read_key()?;
        let session = match self.session_from_device_key(&key) {
            Ok(session) => session,
            Err(err) => {
                let _ = self.device_unlock.disable();
                return Err(err);
            }
        };
        let payload = session.payload.clone();
        state.session = Some(session);
        state.manually_locked = false;
        let state_val = self.build_state_locked(&state);
        Ok((state_val, payload))
    }

    pub fn quick_unlock(&self) -> Result<Value, String> {
        let (_, payload) = self.quick_unlock_inner()?;
        Ok(payload)
    }

    pub fn quick_unlock_with_state(&self) -> Result<Value, String> {
        let (state_val, payload) = self.quick_unlock_inner()?;
        Ok(json!({
            "state": state_val,
            "payload": payload,
        }))
    }

    pub fn create_vault(&self, password: &str, _import_legacy: bool) -> Result<Value, String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if self.vault_path.exists() {
            return Err("Vault already exists; unlock it instead".to_string());
        }

        let mut initial_payload = default_vault_payload(Vec::new());
        ensure_v2_metadata(&mut initial_payload);

        let (envelope, vault_key) = encrypt_payload(password, &initial_payload, None)
            .map_err(|e| e.to_string())?;

        let env_text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        self.persist_envelope(&mut state, &env_text, false, Some(0))?;
        self.verify_persisted_envelope(&vault_key, 1)?;

        let expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
        let expires_at_secs = expires_at_ms / 1000;
        state.session = Some(VaultSession {
            payload: initial_payload.clone(),
            key: vault_key,
            passwordless: envelope.passwordless,
            expires_at_ms,
            unlocked_at_ms: self.session_unlock_timestamp(),
            vault_file_stamp: self.current_vault_file_stamp(),
        });
        state.manually_locked = false;
        let state_val = self.build_state_locked(&state);

        Ok(json!({
            "created": true,
            "locked": false,
            "expiresAt": expires_at_secs,
            "state": state_val,
            "payload": initial_payload,
            "migrated": 0,
            "legacyCleanupPending": false,
        }))
    }

    pub fn get_vault(&self) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;
        Ok(session.payload.clone())
    }

    pub fn save_vault(&self, new_payload: &Value, expected_revision: Option<u64>) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (current_rev, session_key, session_passwordless) = {
            let session = self.require_fresh_session(&mut lock_guard)?;
            let current_rev = session.payload.get("revision").and_then(|r| r.as_u64()).unwrap_or(1);
            let effective_expected = expected_revision
                .or_else(|| new_payload.get("revision").and_then(Value::as_u64));
            if let Some(exp) = effective_expected {
                if exp != current_rev {
                    return Err(format!("Conflict: current revision is {}, expected {}", current_rev, exp));
                }
            }
            assert_no_version_downgrade(&session.payload, new_payload)?;
            (current_rev, session.key.clone(), session.passwordless)
        };

        let next_rev = current_rev.checked_add(1).ok_or("Invalid vault revision")?;
        let mut payload_to_save = new_payload.clone();
        let object = payload_to_save
            .as_object_mut()
            .ok_or("Invalid vault payload: expected an object")?;
        object.insert("revision".to_string(), Value::from(next_rev));
        object.insert("updatedAt".to_string(), Value::from(now_secs()));
        ensure_v2_metadata(&mut payload_to_save);

        let mut envelope = encrypt_payload_with_key(&session_key, &payload_to_save)
            .map_err(|e| format!("Invalid vault payload: {e}"))?;
        envelope.passwordless = session_passwordless;
        let env_text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        self.persist_envelope(&mut lock_guard, &env_text, false, Some(current_rev))?;

        let new_stamp = self.current_vault_file_stamp();
        if let Some(session) = lock_guard.session.as_mut() {
            session.payload = payload_to_save.clone();
            session.expires_at_ms = now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000;
            session.vault_file_stamp = new_stamp;
        }

        Ok(json!({
            "saved": true,
            "revision": next_rev,
            "payload": payload_to_save,
        }))
    }

    fn change_password_inner(
        &self,
        current_password: Option<&str>,
        new_password: &str,
    ) -> Result<(Value, Value), String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (current_rev, mut payload) = {
            let session = self.require_fresh_session(&mut lock_guard)?;
            let current_rev = session.payload.get("revision").and_then(Value::as_u64).unwrap_or(1);
            (current_rev, session.payload.clone())
        };

        if let Some(cur_pw) = current_password {
            let current_envelope = self.envelope_for_unlock()?;
            let effective_pw = if current_envelope.passwordless == Some(true) && cur_pw.is_empty() {
                ""
            } else {
                cur_pw
            };
            decrypt_payload(effective_pw, &current_envelope)
                .map_err(|_| BAD_PASSWORD_MESSAGE.to_string())?;
        }

        let next_rev = current_rev.checked_add(1).ok_or("Invalid vault revision")?;
        payload["revision"] = json!(next_rev);
        payload["updatedAt"] = json!(now_secs());
        ensure_v2_metadata(&mut payload);

        let (envelope, key) = encrypt_payload(new_password, &payload, None)
            .map_err(|e| format!("Invalid vault payload: {e}"))?;
        let env_text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        self.device_unlock.disable()?;
        self.persist_envelope(&mut lock_guard, &env_text, false, Some(current_rev))?;
        self.verify_persisted_envelope(&key, next_rev)?;

        lock_guard.session = Some(VaultSession {
            payload: payload.clone(),
            key,
            passwordless: envelope.passwordless,
            expires_at_ms: now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000,
            unlocked_at_ms: self.session_unlock_timestamp(),
            vault_file_stamp: self.current_vault_file_stamp(),
        });
        let state_val = self.build_state_locked(&lock_guard);
        Ok((state_val, payload))
    }

    pub fn change_password(&self, new_password: &str) -> Result<Value, String> {
        let (state_val, payload) = self.change_password_inner(None, new_password)?;
        Ok(json!({
            "passwordChanged": true,
            "state": state_val,
            "payload": payload,
        }))
    }

    pub fn change_password_verified(
        &self,
        current_password: &str,
        new_password: &str,
    ) -> Result<Value, String> {
        let (state_val, payload) = self.change_password_inner(Some(current_password), new_password)?;
        Ok(json!({
            "state": state_val,
            "payload": payload,
        }))
    }

    pub fn adopt_encryption_from_envelope(
        &self,
        envelope_text: &str,
        password: &str,
    ) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (current_rev, mut next_payload) = {
            let session = self.require_fresh_session(&mut lock_guard)?;
            let current_rev = session.payload.get("revision").and_then(Value::as_u64).unwrap_or(1);
            (current_rev, session.payload.clone())
        };

        let target_envelope = parse_and_validate_envelope(envelope_text)?;
        let (_, target_key) = decrypt_payload(password, &target_envelope)
            .map_err(map_decrypt_error)?;

        let next_rev = current_rev.checked_add(1).ok_or("Invalid vault revision")?;
        next_payload["revision"] = json!(next_rev);
        next_payload["updatedAt"] = json!(now_secs());
        ensure_v2_metadata(&mut next_payload);

        let mut next_envelope = encrypt_payload_with_key(&target_key, &next_payload)
            .map_err(|e| format!("Invalid vault payload: {e}"))?;
        next_envelope.passwordless = Some(password.is_empty());
        let env_text = serde_json::to_string_pretty(&next_envelope).map_err(|e| e.to_string())?;

        self.device_unlock.disable()?;
        self.persist_envelope(&mut lock_guard, &env_text, false, Some(current_rev))?;
        self.verify_persisted_envelope(&target_key, next_rev)?;

        lock_guard.session = Some(VaultSession {
            payload: next_payload.clone(),
            key: target_key,
            passwordless: next_envelope.passwordless,
            expires_at_ms: now_ms() + DEFAULT_SESSION_TIMEOUT_SECONDS * 1000,
            unlocked_at_ms: self.session_unlock_timestamp(),
            vault_file_stamp: self.current_vault_file_stamp(),
        });
        let state_val = self.build_state_locked(&lock_guard);
        Ok(json!({
            "state": state_val,
            "payload": next_payload,
        }))
    }

    pub fn export_backup(&self) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let _session = self.require_fresh_session(&mut lock_guard)?;
        let envelope_text = self.read_vault_envelope()?;
        Ok(json!({
            "content": envelope_text,
            "envelope": envelope_text,
            "vaultPath": self.vault_path.to_string_lossy(),
            "updatedAt": now_secs(),
        }))
    }

    pub fn export_backup_for_payload(&self, payload: &Value) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (session_key, session_passwordless) = {
            let session = self.require_fresh_session(&mut lock_guard)?;
            if !payload.is_object() {
                return Err("Invalid vault payload: expected an object".to_string());
            }
            assert_no_version_downgrade(&session.payload, payload)?;
            (session.key.clone(), session.passwordless)
        };

        let updated_at = now_secs();
        let mut next_payload = payload.clone();
        if let Some(obj) = next_payload.as_object_mut() {
            obj.insert("updatedAt".to_string(), Value::from(updated_at));
        }
        ensure_v2_metadata(&mut next_payload);

        let mut envelope = encrypt_payload_with_key(&session_key, &next_payload)
            .map_err(|e| format!("Invalid vault payload: {e}"))?;
        envelope.passwordless = session_passwordless.or_else(|| Some(self.is_passwordless()));
        let content = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;

        Ok(json!({
            "content": content,
            "vaultPath": self.vault_path.to_string_lossy(),
            "updatedAt": updated_at,
        }))
    }

    pub fn preview_backup(&self, envelope_text: &str) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;
        let envelope = parse_and_validate_envelope(envelope_text)?;
        let decrypted = decrypt_payload_with_key(&session.key, &envelope)
            .map_err(map_decrypt_error)?;
        Ok(json!({ "payload": decrypted }))
    }

    pub fn preview_backup_with_password(
        &self,
        envelope_text: &str,
        password: &str,
    ) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let _session = self.require_fresh_session(&mut lock_guard)?;
        let envelope = parse_and_validate_envelope(envelope_text)?;
        let (decrypted, _temp_key) = decrypt_payload(password, &envelope)
            .map_err(map_decrypt_error)?;
        Ok(json!({ "payload": decrypted }))
    }

    pub fn import_backup(&self, envelope_text: &str) -> Result<Value, String> {
        self.write_vault_envelope(envelope_text, true, None)?;
        Ok(json!({ "imported": true }))
    }

    pub fn import_backup_with_state(&self, envelope_text: &str) -> Result<Value, String> {
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let expected_rev = {
            let session = self.require_fresh_session(&mut lock_guard)?;
            session.payload.get("revision").and_then(Value::as_u64)
        };
        let _ = parse_and_validate_envelope(envelope_text)?;
        let write_res = self.persist_envelope(&mut lock_guard, envelope_text, true, expected_rev)?;
        let state_val = self.build_state_locked(&lock_guard);
        Ok(json!({
            "state": state_val,
            "backupPath": write_res.get("backupPath").and_then(Value::as_str).unwrap_or(""),
            "vaultPath": self.vault_path.to_string_lossy(),
        }))
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
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;

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
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;

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
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;

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
        let mut lock_guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let session = self.require_fresh_session(&mut lock_guard)?;

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

        let expected_revision = vault_payload.get("revision").and_then(Value::as_u64).unwrap_or(1);
        let save_res = self.save_vault(&vault_payload, Some(expected_revision))?;
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

    #[test]
    fn test_change_password_atomic_revision_and_v2_downgrade_guard() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_chpwd_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let v2_payload = json!({
            "version": 2,
            "revision": 1,
            "entries": [],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env_v2, _) = encrypt_payload("old-pass", &v2_payload, Some(10_000)).unwrap();
        assert_eq!(env_v2.version, 2);
        service
            .write_vault_envelope(&serde_json::to_string(&env_v2).unwrap(), false, Some(0))
            .unwrap();

        // v2 -> v1 downgrade must be rejected
        let (env_v1, _) = encrypt_payload("old-pass", &json!({"version": 1, "revision": 2, "entries": []}), Some(10_000)).unwrap();
        assert_eq!(env_v1.version, 1);
        let downgrade = service.write_vault_envelope(&serde_json::to_string(&env_v1).unwrap(), false, Some(1));
        assert!(downgrade.is_err(), "v2 to v1 downgrade must be rejected");

        // Unlock and change_password over existing Windows file succeeds & increments revision
        service.unlock("old-pass").unwrap();
        service.change_password("new-pass").unwrap();
        service.lock();
        assert!(service.unlock("old-pass").is_err());
        service.unlock("new-pass").unwrap();
        let unlocked = service.get_vault().unwrap();
        assert_eq!(unlocked["revision"], 2);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_manual_lock_blocks_auto_unlock() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_lock_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file, legacy_file);

        let (env, _) = encrypt_payload("pwd123", &json!({"revision": 1, "entries": []}), Some(10_000)).unwrap();
        service
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();
        service.unlock("pwd123").unwrap();
        assert_eq!(service.state()["locked"], false);

        service.lock();
        assert_eq!(service.state()["locked"], true);
        assert!(service.get_vault().is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_export_backup_for_payload_and_preview_roundtrip() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_preview_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let initial = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{ "id": "e1", "kind": "login", "title": "Local", "domains": ["a.com"] }],
            "passkeys": [],
            "passkeyTombstones": [],
            "settings": { "oss": {} },
            "updatedAt": 100
        });
        let (env, _) = encrypt_payload("master-pw", &initial, Some(10_000)).unwrap();
        service
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();

        let unlocked = service.unlock_with_payload("master-pw").unwrap();
        assert_eq!(unlocked["state"]["locked"], false);
        assert_eq!(unlocked["payload"]["revision"], 1);

        // Export backup for a modified payload using active session key
        let merged = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 2,
            "entries": [
                { "id": "e1", "kind": "login", "title": "Local", "domains": ["a.com"] },
                { "id": "e2", "kind": "login", "title": "Cloud", "domains": ["b.com"] }
            ],
            "passkeys": [],
            "passkeyTombstones": [],
            "settings": { "oss": {} },
            "updatedAt": 100
        });
        let exported = service.export_backup_for_payload(&merged).unwrap();
        let content = exported["content"].as_str().unwrap();
        assert_eq!(exported["vaultPath"], vault_file.to_string_lossy().as_ref());
        assert!(exported["updatedAt"].as_u64().unwrap() > 0);

        // Preview with active session key
        let previewed = service.preview_backup(content).unwrap();
        assert_eq!(previewed["payload"]["entries"].as_array().unwrap().len(), 2);
        assert_eq!(previewed["payload"]["entries"][1]["title"], "Cloud");

        // Preview an envelope encrypted with a different password
        let remote_payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 5,
            "entries": [{ "id": "r1", "kind": "login", "title": "Remote", "domains": ["r.com"] }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (remote_env, _) = encrypt_payload("remote-pw", &remote_payload, Some(10_000)).unwrap();
        let remote_text = serde_json::to_string(&remote_env).unwrap();

        assert!(service.preview_backup(&remote_text).is_err());
        assert!(service.preview_backup_with_password(&remote_text, "wrong-pw").is_err());

        let previewed_remote = service
            .preview_backup_with_password(&remote_text, "remote-pw")
            .unwrap();
        assert_eq!(previewed_remote["payload"]["revision"], 5);
        assert_eq!(previewed_remote["payload"]["entries"][0]["title"], "Remote");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_adopt_encryption_from_envelope_switches_kdf_and_invalidates_device_unlock() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_adopt_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let local_payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{ "id": "local-1", "kind": "login", "title": "Keep Me", "domains": ["keep.com"] }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (local_env, _) = encrypt_payload("local-pw", &local_payload, Some(10_000)).unwrap();
        service
            .write_vault_envelope(&serde_json::to_string(&local_env).unwrap(), false, Some(0))
            .unwrap();
        service.unlock_with_payload("local-pw").unwrap();

        // Enable device unlock (on Windows DPAPI)
        let du_enabled = service.enable_device_unlock("local-pw", 3600);
        if cfg!(target_os = "windows") {
            assert_eq!(du_enabled.unwrap()["enabled"], true);
        }

        // Create remote envelope with a different password and KDF salt/iterations
        let remote_payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 9,
            "entries": [],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (remote_env, _) = encrypt_payload("remote-pw", &remote_payload, Some(12_345)).unwrap();
        let remote_text = serde_json::to_string(&remote_env).unwrap();

        // Wrong password for target envelope must fail without mutating local vault
        assert!(service.adopt_encryption_from_envelope(&remote_text, "wrong").is_err());

        // Right password adopts KDF/key, re-encrypts LOCAL payload, increments revision, disables device unlock
        let adopted = service
            .adopt_encryption_from_envelope(&remote_text, "remote-pw")
            .unwrap();
        assert_eq!(adopted["state"]["locked"], false);
        assert_eq!(adopted["payload"]["revision"], 2);
        assert_eq!(adopted["payload"]["entries"][0]["title"], "Keep Me");
        assert_eq!(service.device_unlock_state()["enabled"], false);

        // Persisted envelope must now use remote KDF and unlock only with remote-pw
        let persisted_env: VaultEnvelope =
            serde_json::from_str(&fs::read_to_string(&vault_file).unwrap()).unwrap();
        assert_eq!(persisted_env.kdf, remote_env.kdf);

        service.lock();
        assert!(service.unlock_with_payload("local-pw").is_err());
        let re_unlocked = service.unlock_with_payload("remote-pw").unwrap();
        assert_eq!(re_unlocked["payload"]["revision"], 2);
        assert_eq!(re_unlocked["payload"]["entries"][0]["title"], "Keep Me");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_change_password_verified_checks_current_and_allows_passwordless() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_chpwd_v_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        let payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{ "id": "e1", "kind": "login", "title": "Site", "domains": [] }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env, _) = encrypt_payload("curr-pass", &payload, Some(10_000)).unwrap();
        service
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();
        service.unlock_with_payload("curr-pass").unwrap();

        if cfg!(target_os = "windows") {
            assert_eq!(service.enable_device_unlock("curr-pass", 3600).unwrap()["enabled"], true);
        }

        // Reject wrong current password
        let bad = service.change_password_verified("wrong-pass", "next-pass");
        assert!(bad.is_err());
        assert_eq!(bad.unwrap_err(), BAD_PASSWORD_MESSAGE);

        // Succeed with right current password -> switch to passwordless ("")
        let changed = service.change_password_verified("curr-pass", "").unwrap();
        assert_eq!(changed["state"]["passwordless"], true);
        assert_eq!(changed["state"]["locked"], false);
        assert_eq!(changed["payload"]["revision"], 2);
        assert_eq!(service.device_unlock_state()["enabled"], false);

        // When passwordless == true, empty current password is accepted
        let changed2 = service.change_password_verified("", "final-pass").unwrap();
        assert_eq!(changed2["state"]["passwordless"], false);
        assert_eq!(changed2["payload"]["revision"], 3);

        service.lock();
        assert!(service.unlock_with_payload("curr-pass").is_err());
        assert!(service.unlock_with_payload("").is_err());
        let ok = service.unlock_with_payload("final-pass").unwrap();
        assert_eq!(ok["payload"]["revision"], 3);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_quick_unlock_blocked_after_manual_lock() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_qu_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file.clone());

        let payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{ "id": "e1", "kind": "login", "title": "Quick", "domains": [] }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env, _) = encrypt_payload("pw-qu", &payload, Some(10_000)).unwrap();
        service
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();
        service.unlock_with_payload("pw-qu").unwrap();

        if cfg!(target_os = "windows") {
            assert_eq!(service.enable_device_unlock("pw-qu", 3600).unwrap()["enabled"], true);

            // Fresh service instance (manually_locked == false) can quick_unlock
            let fresh = VaultService::new(vault_file.clone(), legacy_file.clone());
            let qu = fresh.quick_unlock_with_state().unwrap();
            assert_eq!(qu["state"]["locked"], false);
            assert_eq!(qu["payload"]["entries"][0]["title"], "Quick");

            // After manual lock(), quick_unlock MUST fail
            let locked_state = fresh.lock();
            assert_eq!(locked_state["locked"], true);
            let blocked = fresh.quick_unlock();
            assert!(blocked.is_err());
            assert_eq!(blocked.unwrap_err(), MANUAL_LOCK_MESSAGE);
            let blocked_with_state = fresh.quick_unlock_with_state();
            assert!(blocked_with_state.is_err());
            assert_eq!(blocked_with_state.unwrap_err(), MANUAL_LOCK_MESSAGE);
            // Empty password unlock also must not bypass manual lock
            assert!(fresh.unlock_with_payload("").is_err());
            // Master password unlock clears manual lock
            assert!(fresh.unlock_with_payload("pw-qu").is_ok());
        } else {
            service.lock();
            let blocked = service.quick_unlock();
            assert!(blocked.is_err());
            assert_eq!(blocked.unwrap_err(), MANUAL_LOCK_MESSAGE);
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_import_backup_with_state_and_create_vault_shape() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_imp_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let service = VaultService::new(vault_file.clone(), legacy_file);

        // create_vault returns { state, payload, migrated, legacyCleanupPending }
        let created = service.create_vault("init-pw", false).unwrap();
        assert_eq!(created["state"]["hasVault"], true);
        assert_eq!(created["state"]["locked"], false);
        assert_eq!(created["payload"]["revision"], 1);
        assert_eq!(created["migrated"], 0);
        assert_eq!(created["legacyCleanupPending"], false);

        // save_vault updates revision and returns { saved, revision, payload }
        let mut p = created["payload"].clone();
        p["entries"] = json!([{ "id": "n1", "kind": "login", "title": "Saved", "domains": [] }]);
        let saved = service.save_vault(&p, None).unwrap();
        assert_eq!(saved["saved"], true);
        assert_eq!(saved["revision"], 2);
        assert_eq!(saved["payload"]["revision"], 2);

        // import_backup_with_state backs up existing, locks session, sets manually_locked
        let backup_payload = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 7,
            "entries": [{ "id": "b1", "kind": "login", "title": "Restored", "domains": [] }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (backup_env, _) = encrypt_payload("backup-pw", &backup_payload, Some(10_000)).unwrap();
        let imported = service
            .import_backup_with_state(&serde_json::to_string(&backup_env).unwrap())
            .unwrap();
        assert_eq!(imported["state"]["locked"], true);
        assert_eq!(imported["vaultPath"], vault_file.to_string_lossy().as_ref());
        let backup_path = imported["backupPath"].as_str().unwrap();
        assert!(!backup_path.is_empty());
        assert!(Path::new(backup_path).exists());
        assert!(service.get_vault().is_err());

        let unlocked = service.unlock_with_payload("backup-pw").unwrap();
        assert_eq!(unlocked["payload"]["revision"], 7);
        assert_eq!(unlocked["payload"]["entries"][0]["title"], "Restored");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cross_process_lock_sync_invalidates_peer_session() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_xlock_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let desktop = VaultService::new(vault_file.clone(), legacy_file.clone());
        let native_host = VaultService::new(vault_file, legacy_file);

        let initial = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{
                "id": "e1",
                "kind": "login",
                "title": "Example",
                "username": "alice",
                "password": "pw",
                "domains": ["example.com"],
                "autofillMatchMode": "base-domain",
                "status": "active"
            }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env, _) = encrypt_payload("shared-pw", &initial, Some(10_000)).unwrap();
        desktop
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();

        desktop.unlock("shared-pw").unwrap();
        native_host.unlock("shared-pw").unwrap();
        assert_eq!(
            native_host
                .query_matches("example.com", "https://example.com/login")
                .unwrap()
                .len(),
            1
        );

        // Locking Desktop writes lock.epoch and immediately invalidates native_host
        desktop.lock();
        let err = native_host
            .query_matches("example.com", "https://example.com/login")
            .unwrap_err();
        assert_eq!(err, LOCKED_MESSAGE);
        assert_eq!(native_host.state()["locked"], true);

        // Re-unlocking native_host after Desktop lock succeeds cleanly
        native_host.unlock("shared-pw").unwrap();
        assert_eq!(
            native_host
                .query_matches("example.com", "https://example.com/login")
                .unwrap()
                .len(),
            1
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cross_process_live_reload_sees_new_entries_without_reunlock() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_xreload_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let desktop = VaultService::new(vault_file.clone(), legacy_file.clone());
        let native_host = VaultService::new(vault_file, legacy_file);

        let initial = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env, _) = encrypt_payload("shared-pw", &initial, Some(10_000)).unwrap();
        desktop
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();

        desktop.unlock("shared-pw").unwrap();
        native_host.unlock("shared-pw").unwrap();
        assert!(native_host
            .query_matches("fresh.example.com", "https://fresh.example.com/login")
            .unwrap()
            .is_empty());

        // Desktop saves a brand new login entry
        let mut updated = desktop.get_vault().unwrap();
        updated["entries"] = json!([{
            "id": "fresh-1",
            "kind": "login",
            "title": "Fresh Site",
            "username": "bob",
            "password": "secret",
            "domains": ["fresh.example.com"],
            "autofillMatchMode": "base-domain",
            "status": "active"
        }]);
        desktop.save_vault(&updated, Some(1)).unwrap();

        // native_host immediately sees the new entry without re-unlocking
        let matches = native_host
            .query_matches("fresh.example.com", "https://fresh.example.com/login")
            .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["id"], "fresh-1");
        assert_eq!(matches[0]["username"], "bob");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cross_process_password_rotation_invalidates_peer_session() {
        let dir = std::env::temp_dir().join(format!("pwdmg_test_xrot_{}", uuid::Uuid::new_v4()));
        let vault_file = dir.join("vault.json");
        let legacy_file = dir.join("legacy.json");
        let desktop = VaultService::new(vault_file.clone(), legacy_file.clone());
        let native_host = VaultService::new(vault_file, legacy_file);

        let initial = json!({
            "version": 2,
            "passkeySchemaVersion": 1,
            "revision": 1,
            "entries": [{
                "id": "e1",
                "kind": "login",
                "title": "Rotate",
                "username": "carol",
                "password": "pw",
                "domains": ["rotate.example.com"],
                "autofillMatchMode": "base-domain",
                "status": "active"
            }],
            "passkeys": [],
            "passkeyTombstones": []
        });
        let (env, _) = encrypt_payload("old-pw", &initial, Some(10_000)).unwrap();
        desktop
            .write_vault_envelope(&serde_json::to_string(&env).unwrap(), false, Some(0))
            .unwrap();

        desktop.unlock("old-pw").unwrap();
        native_host.unlock("old-pw").unwrap();
        assert_eq!(
            native_host
                .query_matches("rotate.example.com", "https://rotate.example.com/")
                .unwrap()
                .len(),
            1
        );

        // Desktop rotates master password
        desktop.change_password("new-pw").unwrap();

        // native_host detects changed vault file, fails decryption with stale key, and locks immediately
        let err = native_host
            .query_matches("rotate.example.com", "https://rotate.example.com/")
            .unwrap_err();
        assert_eq!(err, LOCKED_MESSAGE);
        assert_eq!(native_host.state()["locked"], true);

        let _ = fs::remove_dir_all(dir);
    }
}
