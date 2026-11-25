use std::fs::{self, File};
use std::io::{self, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use url::Url;

pub(crate) struct VerifiedUpdate {
    pub path: PathBuf,
    pub sha256: String,
}

pub(crate) fn https_update_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid update URL")?;
    if url.scheme() != "https" || !url.has_host() || !value.starts_with("https://") {
        return Err("Invalid update URL: HTTPS is required".to_string());
    }
    Ok(url)
}

pub(crate) fn update_sha256(value: &str) -> Result<&str, String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid update SHA-256: expected 64 hexadecimal characters".to_string());
    }
    Ok(value)
}

pub(crate) fn update_agent(read_seconds: u64) -> ureq::Agent {
    ureq::builder()
        .try_proxy_from_env(true)
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(read_seconds))
        .redirects(0)
        .build()
}

pub(crate) fn get_https_update(agent: &ureq::Agent, mut url: Url) -> Result<ureq::Response, String> {
    for _ in 0..=5 {
        let response = agent.get(url.as_str()).call().map_err(|e| e.to_string())?;
        if (200..300).contains(&response.status()) {
            return Ok(response);
        }
        if !matches!(response.status(), 301 | 302 | 303 | 307 | 308) {
            return Err(format!("Unexpected update HTTP status {}", response.status()));
        }
        let location = response.header("Location").ok_or("Invalid update redirect: missing Location")?;
        let target = url.join(location).map_err(|_| "Invalid update redirect URL")?;
        url = https_update_url(target.as_str())?;
    }
    Err("Invalid update redirect: too many redirects".to_string())
}

pub(crate) fn sha256(reader: &mut impl Read) -> io::Result<String> {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    io::copy(reader, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn download_update_asset(
    agent: &ureq::Agent,
    url: Url,
    target: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<(), String> {
    let mut reader = get_https_update(agent, url)?.into_reader();
    let mut temp = tempfile::NamedTempFile::new_in(target.parent().ok_or("Invalid update directory")?)
        .map_err(|e| e.to_string())?;
    let size = if expected_size > 0 {
        io::copy(&mut reader.by_ref().take(expected_size.saturating_add(1)), &mut temp)
    } else {
        io::copy(&mut reader, &mut temp)
    }.map_err(|e| e.to_string())?;
    if expected_size > 0 && size != expected_size {
        return Err("Invalid update package size".to_string());
    }
    temp.flush().and_then(|_| temp.rewind()).map_err(|e| e.to_string())?;
    if !sha256(&mut temp).map_err(|e| e.to_string())?.eq_ignore_ascii_case(expected_sha256) {
        return Err("Invalid update package: SHA-256 mismatch".to_string());
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(target).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn confined_update_path(updates: &Path, package: &Path) -> Result<PathBuf, String> {
    const INVALID_PATH: &str = "Invalid update package path: expected a file inside the updates directory";
    if !package.is_absolute() || package.components().any(|part| part == Component::ParentDir) {
        return Err(INVALID_PATH.to_string());
    }
    let dir = fs::canonicalize(updates).map_err(|_| INVALID_PATH)?;
    let package = fs::canonicalize(package).map_err(|_| INVALID_PATH)?;
    if package == dir || !package.starts_with(dir) || !package.is_file() {
        return Err(INVALID_PATH.to_string());
    }
    Ok(package)
}

fn update_entry_path(name: &str, is_dir: bool) -> Result<PathBuf, String> {
    let name = if is_dir { name.trim_end_matches(['/', '\\']) } else { name };
    let mut path = PathBuf::new();
    for part in name.split(['/', '\\']) {
        let stem = part.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
        let reserved_numbered_name = ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
            })
        });
        if part.is_empty()
            || part.ends_with(['.', ' '])
            || part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c))
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
            || reserved_numbered_name
        {
            return Err("Invalid update ZIP entry path".to_string());
        }
        path.push(part);
    }
    Ok(path)
}

pub(crate) fn extract_verified_update(
    package: &Path,
    verified: Option<&VerifiedUpdate>,
    work_dir: &Path,
) -> Result<(), String> {
    let verified = verified.filter(|update| update.path == package)
        .ok_or("Invalid update package: download and verify the package first")?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Allow reads while preventing writes or replacement during extraction.
        options.share_mode(1);
    }
    let mut file = options.open(package).map_err(|e| e.to_string())?;
    if sha256(&mut file).map_err(|e| e.to_string())? != verified.sha256 {
        return Err("Invalid update package: SHA-256 mismatch".to_string());
    }
    file.rewind().map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid update ZIP: {e}"))?;
    let mut paths = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("Invalid update ZIP entry: {e}"))?;
        let kind = entry.unix_mode().unwrap_or_default() & 0o170000;
        if !matches!(kind, 0 | 0o040000 | 0o100000) {
            return Err("Invalid update ZIP entry type".to_string());
        }
        paths.push(update_entry_path(entry.name(), entry.is_dir())?);
    }
    for (i, path) in paths.iter().enumerate() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Invalid update ZIP entry: {e}"))?;
        let target = work_dir.join(path);
        if entry.is_dir() {
            fs::create_dir_all(target).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(target.parent().ok_or("Invalid update ZIP entry path")?)
                .map_err(|e| e.to_string())?;
            let mut output = File::create_new(target).map_err(|e| format!("Invalid update ZIP entry: {e}"))?;
            io::copy(&mut entry, &mut output).map_err(|e| format!("Invalid update ZIP entry: {e}"))?;
        }
    }
    Ok(())
}
