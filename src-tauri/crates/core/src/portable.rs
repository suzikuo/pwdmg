use crate::crypto::{decrypt_payload, VaultEnvelope};
use crate::paths::{attachment_dir, ensure_app_dir, vault_file};
use serde_json::{json, Value};
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
        "attachmentCount": attachment_count,
    }))
}

pub fn inspect_portable_backup<P: AsRef<Path>>(package_path: P) -> Result<Value, String> {
    let file = File::open(package_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut manifest_file = zip.by_name("manifest.json").map_err(|_| "Invalid backup package: missing manifest.json".to_string())?;
    let mut manifest_text = String::new();
    manifest_file.read_to_string(&mut manifest_text).map_err(|e| e.to_string())?;

    let manifest: Value = serde_json::from_str(&manifest_text).map_err(|_| "Manifest is not valid JSON".to_string())?;

    Ok(manifest)
}

pub fn import_portable_backup<P: AsRef<Path>>(package_path: P, password: &str) -> Result<Value, String> {
    let file = File::open(&package_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    // 1. Read and test decrypt vault.json
    let envelope_text = {
        let mut vault_file_entry = zip.by_name("vault.json").map_err(|_| "Missing vault.json in backup".to_string())?;
        let mut text = String::new();
        vault_file_entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
        text
    };

    let envelope: VaultEnvelope = serde_json::from_str(&envelope_text)
        .map_err(|_| "Vault envelope in backup is invalid".to_string())?;

    // Verify password decrypts correctly
    let _ = decrypt_payload(password, &envelope).map_err(|e| e.to_string())?;

    // 2. Extract attachments
    let att_dir = attachment_dir();
    fs::create_dir_all(&att_dir).map_err(|e| e.to_string())?;

    let mut restored_attachments = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.starts_with("attachments/") && name.ends_with(".json") {
            let file_name = name.trim_start_matches("attachments/");
            if !file_name.is_empty() && !file_name.contains('/') && !file_name.contains('\\') {
                let target = att_dir.join(file_name);
                let mut content = Vec::new();
                entry.read_to_end(&mut content).map_err(|e| e.to_string())?;
                fs::write(target, content).map_err(|e| e.to_string())?;
                restored_attachments += 1;
            }
        }
    }

    // 3. Write vault.json
    let target_vault = vault_file();
    fs::write(&target_vault, envelope_text).map_err(|e| e.to_string())?;

    Ok(json!({
        "imported": true,
        "restoredAttachments": restored_attachments
    }))
}
