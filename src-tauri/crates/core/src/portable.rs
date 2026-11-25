use crate::attachment::{
    is_valid_attachment_id, validate_attachment_object, AttachmentStore, MAX_ATTACHMENT_OBJECT_BYTES,
};
use crate::crypto::{decrypt_payload, VaultEnvelope, MAX_CIPHERTEXT_BYTES};
use crate::paths::{atomic_write_file, attachment_dir, backup_vault_file, ensure_app_dir, vault_file};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

pub fn export_portable_backup<P: AsRef<Path>>(target_zip_path: P) -> Result<Value, String> {
    ensure_app_dir().map_err(|e| e.to_string())?;
    let vault_p = vault_file();
    if !vault_p.exists() {
        return Err("No vault to export".to_string());
    }

    let envelope_text = fs::read_to_string(&vault_p).map_err(|e| e.to_string())?;
    let target = target_zip_path.as_ref();
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = File::create(target).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Write vault.json
    zip.start_file("vault.json", options).map_err(|e| e.to_string())?;
    zip.write_all(envelope_text.as_bytes()).map_err(|e| e.to_string())?;

    // Copy attachments
    let mut attachment_count = 0;
    let att_dir = attachment_dir();
    if att_dir.exists() {
        if let Ok(entries) = fs::read_dir(&att_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        let Some(id) = name.strip_suffix(".json") else { continue };
                        if !is_valid_attachment_id(id) {
                            continue;
                        }
                        let zip_entry_name = format!("attachments/{}", name);
                        zip.start_file(&zip_entry_name, options).map_err(|e| e.to_string())?;
                        let data = fs::read(&p).map_err(|e| e.to_string())?;
                        zip.write_all(&data).map_err(|e| e.to_string())?;
                        attachment_count += 1;
                    }
                }
            }
        }
    }

    // Write manifest.json
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let manifest = json!({
        "format": "mypwdmg-portable-backup",
        "version": 1,
        "exportedAt": now,
        "attachmentCount": attachment_count,
    });
    zip.start_file("manifest.json", options).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes()).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;

    Ok(json!({
        "path": target.to_string_lossy(),
        "createdAt": now,
        "packageBytes": fs::metadata(target).map_err(|e| e.to_string())?.len(),
        "attachmentCount": attachment_count,
    }))
}

pub fn inspect_portable_backup<P: AsRef<Path>>(package_path: P) -> Result<Value, String> {
    let file = File::open(package_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let manifest_file = zip.by_name("manifest.json").map_err(|_| "Invalid backup package: missing manifest.json".to_string())?;
    let manifest_text = read_entry(manifest_file, 64 * 1024, "manifest.json")?;
    let manifest: Value = serde_json::from_str(&manifest_text).map_err(|_| "Invalid backup manifest JSON".to_string())?;

    Ok(manifest)
}

fn read_entry(mut entry: impl Read, limit: usize, name: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    entry.by_ref().take(limit as u64 + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("Invalid backup entry {name}: {e}"))?;
    if bytes.len() > limit {
        return Err(format!("Invalid backup entry {name}: size limit exceeded"));
    }
    String::from_utf8(bytes).map_err(|_| format!("Invalid backup entry {name}: expected UTF-8"))
}

pub fn import_portable_backup<P: AsRef<Path>>(package_path: P, password: &str) -> Result<Value, String> {
    import_backup(package_path.as_ref(), password, &vault_file(), &attachment_dir())
}

pub(crate) fn import_backup(
    package_path: &Path,
    password: &str,
    target_vault: &Path,
    attachments: &Path,
) -> Result<Value, String> {
    let file = File::open(package_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("Invalid backup package: {e}"))?;

    let envelope_text = read_entry(
        zip.by_name("vault.json").map_err(|_| "Invalid backup package: missing vault.json")?,
        MAX_CIPHERTEXT_BYTES,
        "vault.json",
    )?;
    let envelope: VaultEnvelope = serde_json::from_str(&envelope_text)
        .map_err(|_| "Invalid vault envelope in backup".to_string())?;
    decrypt_payload(password, &envelope).map_err(|e| e.to_string())?;

    // Validate all attachment entries before changing the vault or attachment store.
    let mut entries = Vec::new();
    let mut ids = HashSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.name().strip_prefix("attachments/") else { continue };
        if name.is_empty() && entry.is_dir() {
            continue;
        }
        let id = name.strip_suffix(".json").filter(|id| is_valid_attachment_id(id))
            .ok_or("Invalid attachment filename in backup")?.to_string();
        if !ids.insert(id.to_ascii_lowercase()) {
            return Err("Invalid backup package: duplicate attachment ID".to_string());
        }
        let text = read_entry(entry, MAX_ATTACHMENT_OBJECT_BYTES, &id)?;
        validate_attachment_object(&id, &text)?;
        entries.push((i, id));
    }

    if let Some(parent) = target_vault.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let backup_path = match fs::read(target_vault) {
        Ok(current) => {
            if envelope.version == 1 && serde_json::from_slice::<VaultEnvelope>(&current)
                .is_ok_and(|current| current.version == 2)
            {
                return Err("Invalid vault envelope: cannot downgrade a v2 vault to v1".to_string());
            }
            Some(backup_vault_file(target_vault, &current)?)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };

    let store = AttachmentStore::new(attachments);
    for (i, id) in &entries {
        let entry = zip.by_index(*i).map_err(|e| e.to_string())?;
        let text = read_entry(entry, MAX_ATTACHMENT_OBJECT_BYTES, id)?;
        store.write(id, &text)?;
    }
    atomic_write_file(target_vault, envelope_text.as_bytes())?;

    Ok(json!({
        "imported": true,
        "backupPath": backup_path.as_deref().and_then(Path::to_str).unwrap_or_default(),
        "vaultPath": target_vault.to_string_lossy(),
        "attachmentCount": entries.len(),
        "restoredAttachments": entries.len()
    }))
}
