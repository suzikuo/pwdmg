use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn atomic_write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temp_name = path.file_name().ok_or("Invalid file path")?.to_os_string();
    temp_name.push(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let temp = path.with_file_name(temp_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;

    let written = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = written.and_then(|_| replace_file(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| e.to_string())
}

#[cfg(windows)]
fn replace_file(temp: &Path, path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let wide = |path: &Path| path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let temp = wide(temp);
    let path = wide(path);
    unsafe {
        MoveFileExW(
            PCWSTR(temp.as_ptr()),
            PCWSTR(path.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(io::Error::other)
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temp, path)
}

pub(crate) fn backup_vault_file(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = path.with_file_name("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let backup = dir.join(format!("vault-backup-{}.json", uuid::Uuid::new_v4()));
    atomic_write_file(&backup, bytes)?;
    Ok(backup)
}

pub const APP_NAME: &str = "My Password Manager";

pub fn app_dir() -> PathBuf {
    directories::UserDirs::new()
        .map(|u| u.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mypwdmg")
}

pub fn ensure_app_dir() -> std::io::Result<PathBuf> {
    let dir = app_dir();
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn vault_file() -> PathBuf {
    app_dir().join("vault.json")
}

pub fn legacy_local_storage_file() -> PathBuf {
    app_dir().join("localStorage_data.json")
}

pub fn desktop_config_file() -> PathBuf {
    app_dir().join("desktop_config.json")
}

pub fn local_backup_dir() -> PathBuf {
    app_dir().join("backups")
}

pub fn update_dir() -> PathBuf {
    app_dir().join("updates")
}

pub fn native_host_dir() -> PathBuf {
    app_dir().join("native-host")
}

pub fn plugin_config_file() -> PathBuf {
    app_dir().join("plugin_config.json")
}

pub fn device_unlock_file() -> PathBuf {
    app_dir().join("device_unlock.json")
}

pub fn attachment_dir() -> PathBuf {
    app_dir().join("attachments")
}
