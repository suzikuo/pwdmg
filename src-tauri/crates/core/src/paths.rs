use std::path::PathBuf;

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
