use crate::paths::atomic_write_file;
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static ATTACHMENT_FILES: Mutex<()> = Mutex::new(());

pub const ATTACHMENT_FORMAT: &str = "mypwdmg-attachment";
pub const ATTACHMENT_VERSION: u32 = 1;
pub const ATTACHMENT_CIPHER: &str = "AES-256-GCM";
pub const MAX_ATTACHMENT_PLAINTEXT_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ATTACHMENT_CIPHERTEXT_BYTES: usize = MAX_ATTACHMENT_PLAINTEXT_BYTES + 16;
pub const MAX_ATTACHMENT_OBJECT_BYTES: usize = ((MAX_ATTACHMENT_CIPHERTEXT_BYTES + 2) / 3) * 4 + 1024;
pub const MAX_ATTACHMENT_STORE_BYTES: u64 = 256 * 1024 * 1024;
pub const RETAIN_SECONDS: u64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct AttachmentStorageState {
    pub maxFileBytes: usize,
    pub quotaBytes: u64,
    pub activeCount: usize,
    pub activeBytes: u64,
    pub retainedCount: usize,
    pub retainedBytes: u64,
}

pub fn is_valid_attachment_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|id_uuid| {
        id_uuid.get_version() == Some(uuid::Version::Random)
            && id_uuid.get_variant() == uuid::Variant::RFC4122
            && id_uuid.hyphenated().to_string().eq_ignore_ascii_case(id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttachmentObject<'a> {
    format: &'a str,
    version: u32,
    cipher: &'a str,
    attachment_id: &'a str,
    nonce: &'a str,
    ciphertext: &'a str,
}

pub(crate) fn validate_attachment_object(attachment_id: &str, object_text: &str) -> Result<(), String> {
    if !is_valid_attachment_id(attachment_id) {
        return Err("Invalid attachment ID".to_string());
    }
    if object_text.len() > MAX_ATTACHMENT_OBJECT_BYTES {
        return Err("Invalid attachment object: size limit exceeded".to_string());
    }
    let object: AttachmentObject<'_> = serde_json::from_str(object_text)
        .map_err(|_| "Invalid attachment object JSON schema".to_string())?;
    if object.format != ATTACHMENT_FORMAT
        || object.version != ATTACHMENT_VERSION
        || object.cipher != ATTACHMENT_CIPHER
        || object.attachment_id != attachment_id
        || !BASE64_STANDARD.decode(object.nonce).is_ok_and(|bytes| !bytes.is_empty())
        || !BASE64_STANDARD.decode(object.ciphertext).is_ok_and(|bytes| !bytes.is_empty())
    {
        return Err("Invalid attachment object payload".to_string());
    }
    Ok(())
}

pub struct AttachmentStore {
    root: PathBuf,
    retained_dir: PathBuf,
}

impl AttachmentStore {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        let root = root.as_ref().to_path_buf();
        let retained_dir = root.join(".retained");
        Self { root, retained_dir }
    }

    fn ensure_dirs(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(&self.retained_dir)?;
        Ok(())
    }

    pub fn state(&self) -> AttachmentStorageState {
        let mut active_count = 0;
        let mut active_bytes = 0;
        let mut retained_count = 0;
        let mut retained_bytes = 0;

        if let Ok(entries) = fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    active_count += 1;
                    active_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }

        if let Ok(entries) = fs::read_dir(&self.retained_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    retained_count += 1;
                    retained_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }

        AttachmentStorageState {
            maxFileBytes: MAX_ATTACHMENT_PLAINTEXT_BYTES,
            quotaBytes: MAX_ATTACHMENT_STORE_BYTES,
            activeCount: active_count,
            activeBytes: active_bytes,
            retainedCount: retained_count,
            retainedBytes: retained_bytes,
        }
    }

    pub fn write(&self, attachment_id: &str, object_text: &str) -> Result<Value, String> {
        validate_attachment_object(attachment_id, object_text)?;
        let raw = object_text.as_bytes();
        let _files = ATTACHMENT_FILES.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_dirs().map_err(|e| e.to_string())?;
        let target = self.root.join(format!("{}.json", attachment_id));
        let mut exists = false;
        let mut retained = None;
        for source in std::iter::once(target.clone()).chain(self.retained_paths(attachment_id)?) {
            match fs::read(&source) {
                Ok(existing) if existing == raw => {
                    if source == target {
                        exists = true;
                    } else {
                        retained = Some(source);
                    }
                }
                Ok(_) => return Err("Conflict: attachment objects are immutable".to_string()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound && source == target => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if !exists {
            if let Some(source) = retained {
                fs::rename(source, &target).map_err(|e| e.to_string())?;
            } else {
                let state = self.state();
                if state.activeBytes + state.retainedBytes + raw.len() as u64 > MAX_ATTACHMENT_STORE_BYTES {
                    return Err("Attachment storage quota exceeded".to_string());
                }
                atomic_write_file(&target, raw)?;
            }
        }

        Ok(serde_json::json!({
            "attachmentId": attachment_id,
            "objectBytes": raw.len(),
            "size": raw.len(),
            "exists": true
        }))
    }

    fn retained_paths(&self, attachment_id: &str) -> Result<Vec<PathBuf>, String> {
        let entries = match fs::read_dir(&self.retained_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if let Some((id, suffix)) = name.to_str().and_then(|name| name.split_once('.')) {
                if id.eq_ignore_ascii_case(attachment_id) && suffix.ends_with(".json") {
                    paths.push(entry.path());
                }
            }
        }
        Ok(paths)
    }

    pub fn read(&self, attachment_id: &str) -> Result<String, String> {
        if !is_valid_attachment_id(attachment_id) {
            return Err("Attachment ID is invalid".to_string());
        }

        let _files = ATTACHMENT_FILES.lock().unwrap_or_else(|e| e.into_inner());
        let target = self.root.join(format!("{}.json", attachment_id));
        if target.exists() {
            return fs::read_to_string(&target).map_err(|e| e.to_string());
        }
        if let Some(source) = self.retained_paths(attachment_id)?.first() {
            let text = fs::read_to_string(source).map_err(|e| e.to_string())?;
            fs::rename(source, &target).map_err(|e| e.to_string())?;
            return Ok(text);
        }

        Err("Attachment object does not exist".to_string())
    }

    pub fn retain(&self, attachment_id: &str) -> Result<bool, String> {
        let _files = ATTACHMENT_FILES.lock().unwrap_or_else(|e| e.into_inner());
        self.retain_file(attachment_id)
    }

    fn retain_file(&self, attachment_id: &str) -> Result<bool, String> {
        if !is_valid_attachment_id(attachment_id) {
            return Err("Attachment ID is invalid".to_string());
        }
        let target = self.root.join(format!("{}.json", attachment_id));
        if !target.exists() {
            return Ok(false);
        }

        self.ensure_dirs().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let retained_target = self.retained_dir.join(format!("{}.{}.json", attachment_id, now));

        fs::rename(&target, &retained_target).map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub fn collect(&self, referenced_ids: &[String]) -> Result<(usize, usize), String> {
        let _files = ATTACHMENT_FILES.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_dirs().map_err(|e| e.to_string())?;
        let ref_set: std::collections::HashSet<&str> = referenced_ids.iter().map(|s| s.as_str()).collect();

        let mut retained_count = 0;
        let mut deleted_count = 0;

        // 1. Move unreferenced active files to retained
        if let Ok(entries) = fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if !ref_set.contains(stem) && is_valid_attachment_id(stem) {
                            if self.retain_file(stem).unwrap_or(false) {
                                retained_count += 1;
                            }
                        }
                    }
                }
            }
        }

        // 2. Expire old retained files older than RETAIN_SECONDS
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if let Ok(entries) = fs::read_dir(&self.retained_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let parts: Vec<&str> = name.split('.').collect();
                if parts.len() == 3 && parts[2] == "json" {
                    if let Ok(timestamp) = parts[1].parse::<u64>() {
                        if now.saturating_sub(timestamp) > RETAIN_SECONDS {
                            if fs::remove_file(path).is_ok() {
                                deleted_count += 1;
                            }
                        }
                    }
                }
            }
        }

        Ok((retained_count, deleted_count))
    }
}
