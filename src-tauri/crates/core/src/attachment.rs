use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    uuid::Uuid::parse_str(id)
        .map(|u| u.get_version_num() == 4)
        .unwrap_or(false)
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
        if !is_valid_attachment_id(attachment_id) {
            return Err("Attachment ID is invalid".to_string());
        }
        let raw = object_text.as_bytes();
        if raw.len() > MAX_ATTACHMENT_OBJECT_BYTES {
            return Err("Attachment object is too large".to_string());
        }

        let parsed: Value = serde_json::from_str(object_text)
            .map_err(|_| "Attachment object is not valid JSON".to_string())?;

        if parsed.get("format").and_then(|s| s.as_str()) != Some(ATTACHMENT_FORMAT)
            || parsed.get("cipher").and_then(|s| s.as_str()) != Some(ATTACHMENT_CIPHER)
            || parsed.get("attachmentId").and_then(|s| s.as_str()) != Some(attachment_id)
        {
            return Err("Attachment object payload is invalid".to_string());
        }

        self.ensure_dirs().map_err(|e| e.to_string())?;
        let target = self.root.join(format!("{}.json", attachment_id));

        if target.exists() {
            if let Ok(existing) = fs::read(&target) {
                if existing == raw {
                    return Ok(serde_json::json!({
                        "attachmentId": attachment_id,
                        "size": raw.len(),
                        "exists": true
                    }));
                }
            }
            return Err("Attachment objects are immutable".to_string());
        }

        let state = self.state();
        if state.activeBytes + state.retainedBytes + (raw.len() as u64) > MAX_ATTACHMENT_STORE_BYTES {
            return Err("Attachment storage quota exceeded".to_string());
        }

        let temp_path = self.root.join(format!(".{}.{}.tmp", attachment_id, uuid::Uuid::new_v4()));
        fs::write(&temp_path, raw).map_err(|e| e.to_string())?;
        fs::rename(&temp_path, &target).map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "attachmentId": attachment_id,
            "size": raw.len(),
            "exists": true
        }))
    }

    pub fn read(&self, attachment_id: &str) -> Result<String, String> {
        if !is_valid_attachment_id(attachment_id) {
            return Err("Attachment ID is invalid".to_string());
        }

        let target = self.root.join(format!("{}.json", attachment_id));
        if target.exists() {
            return fs::read_to_string(&target).map_err(|e| e.to_string());
        }

        // Check retained
        if let Ok(entries) = fs::read_dir(&self.retained_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(attachment_id) && name.ends_with(".json") {
                    let text = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
                    // Restore from retained
                    let _ = fs::rename(entry.path(), &target);
                    return Ok(text);
                }
            }
        }

        Err("Attachment object does not exist".to_string())
    }

    pub fn retain(&self, attachment_id: &str) -> Result<bool, String> {
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
                            if self.retain(stem).unwrap_or(false) {
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
