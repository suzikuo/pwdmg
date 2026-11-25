use crate::updater::{
    confined_update_path, download_update_asset, extract_verified_update, get_https_update,
    https_update_url, sha256, update_agent, update_sha256, VerifiedUpdate,
};
use pwdmg_core::paths::update_dir;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::path::Path;
use url::Url;

fn update_asset_urls(asset: &Value) -> Result<Vec<Url>, String> {
    let mut urls = Vec::new();
    if let Some(mirrors) = asset.get("urls") {
        for mirror in mirrors.as_array().ok_or("Invalid update asset URLs")? {
            let url = https_update_url(mirror.as_str().ok_or("Invalid update mirror URL")?)?;
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
    }
    if let Some(primary) = asset.get("url") {
        let url = https_update_url(primary.as_str().ok_or("Invalid update asset URL")?)?;
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    Ok(urls)
}

pub(crate) fn check_desktop_update(manifest_url: &str) -> Result<Value, String> {
    let url = if manifest_url.trim().is_empty() {
        "https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json"
    } else {
        manifest_url.trim()
    };

    let resp = get_https_update(&update_agent(30), https_update_url(url)?)?;
    let manifest: Value = resp
        .into_json()
        .map_err(|e| format!("Invalid update manifest: {e}"))?;

    let latest_version = manifest.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let current_version = pwdmg_core::version();

    let update_available = compare_versions(latest_version, current_version) > 0;

    let assets = manifest.get("assets").and_then(|a| a.as_object());
    let win_asset = assets
        .and_then(|a| a.get("windows").or_else(|| a.get("win64")))
        .cloned()
        .unwrap_or_else(|| json!({}));

    update_asset_urls(&win_asset)?;

    let notes = manifest.get("notes").and_then(|n| n.as_str()).unwrap_or("");
    let published_at = manifest
        .get("publishedAt")
        .and_then(|p| p.as_str())
        .unwrap_or("");
    let latest_code = manifest.get("versionCode").and_then(|c| c.as_i64());

    let asset_url = win_asset.get("url").and_then(|u| u.as_str()).unwrap_or("");
    let asset_sha256 = win_asset
        .get("sha256")
        .and_then(|s| s.as_str())
        .unwrap_or("");
    let asset_size = win_asset.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
    let asset_filename = win_asset
        .get("fileName")
        .and_then(|f| f.as_str())
        .unwrap_or("MyPasswordDesktop-windows.zip");
    let asset_urls = win_asset.get("urls").cloned().unwrap_or_else(|| json!([]));

    let asset_obj = json!({
        "url": asset_url,
        "urls": asset_urls,
        "sha256": asset_sha256,
        "size": asset_size,
        "fileName": asset_filename,
    });

    Ok(json!({
        "supported": true,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "latestCode": latest_code,
        "updateAvailable": update_available,
        "canApply": true,
        "manifestUrl": url,
        "notes": notes,
        "publishedAt": published_at,
        "platform": "windows",
        "asset": asset_obj,
        "manifest": manifest,
    }))
}

pub(crate) fn download_desktop_update(
    manifest_url: &str,
    verified: &mut Option<VerifiedUpdate>,
) -> Result<Value, String> {
    let check = check_desktop_update(manifest_url)?;
    let asset = &check["asset"];
    let expected_sha256 = update_sha256(asset["sha256"].as_str().unwrap_or_default())?;
    let urls = update_asset_urls(asset)?;
    if urls.is_empty() {
        return Err("Invalid update asset: missing download URL".to_string());
    }
    let expected_size = asset["size"].as_u64().unwrap_or_default();

    let dir = update_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join("update-package.zip");
    let cached = confined_update_path(&dir, &target)
        .ok()
        .and_then(|path| File::open(path).ok())
        .is_some_and(|mut file| {
            (expected_size == 0 || file.metadata().is_ok_and(|meta| meta.len() == expected_size))
                && sha256(&mut file)
                    .is_ok_and(|hash| hash.eq_ignore_ascii_case(expected_sha256))
        });

    if !cached {
        let agent = update_agent(180);
        let mut last_error = None;
        for url in urls {
            match download_update_asset(&agent, url, &target, expected_sha256, expected_size) {
                Ok(()) => {
                    last_error = None;
                    break;
                }
                Err(err) => last_error = Some(err),
            }
        }
        if let Some(err) = last_error {
            return Err(err);
        }
    }

    let path = confined_update_path(&dir, &target)?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    *verified = Some(VerifiedUpdate {
        path,
        sha256: expected_sha256.to_ascii_lowercase(),
    });
    Ok(json!({
        "update": check,
        "packagePath": target.to_string_lossy(),
        "sha256": expected_sha256.to_ascii_lowercase(),
        "size": size,
    }))
}

pub(crate) fn apply_desktop_update(
    package_path: &str,
    verified: Option<&VerifiedUpdate>,
) -> Result<Value, String> {
    let up_dir = update_dir();
    let package = confined_update_path(&up_dir, Path::new(package_path))?;

    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let install_dir = exe_path.parent().ok_or("获取安装目录失败")?.to_path_buf();
    let exe_name = exe_path
        .file_name()
        .ok_or("获取程序名失败")?
        .to_string_lossy()
        .to_string();

    let staging = tempfile::Builder::new()
        .prefix("apply-")
        .tempdir_in(&up_dir)
        .map_err(|e| e.to_string())?;
    let work_dir = staging.path().join("payload");
    let backup_dir = staging.path().join("backup");
    let log_path = staging.path().join("apply-update.log");
    let script_path = staging.path().join("apply-update.ps1");
    extract_verified_update(&package, verified, &work_dir)?;
    let current_pid = std::process::id();

    let ps_script = format!(
        r#"$ErrorActionPreference = 'Stop'
$ProcessIdToWait = {pid}
$PackagePath = '{package_path}'
$InstallDir = '{install_dir}'
$ExeName = '{exe_name}'
$HostExeName = 'My Password Host.exe'
$HostName = 'com.suzikuo.mypwdmg'
$ChromeHostKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$EdgeHostKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
$WorkDir = '{work_dir}'
$BackupDir = '{backup_dir}'
$LogPath = '{log_path}'
$BackupComplete = $false
$InstallMutationStarted = $false

function Write-UpdateLog {{
    param([string] $Message)
    $Line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $LogPath -Value $Line -Encoding UTF8
}}

function Stop-ImageName {{
    param([string] $ImageName)
    if (-not $ImageName) {{ return }}
    $ImageBase = [System.IO.Path]::GetFileNameWithoutExtension($ImageName)
    $Processes = Get-Process -Name $ImageBase -ErrorAction SilentlyContinue
    foreach ($Process in $Processes) {{
        try {{
            Write-UpdateLog "Stopping $ImageName pid=$($Process.Id)"
            Stop-Process -Id $Process.Id -Force -ErrorAction Stop
        }} catch {{
            Write-UpdateLog "Could not stop $ImageName pid=$($Process.Id): $($_.Exception.Message)"
        }}
    }}
}}

function Get-DefaultRegistryValue {{
    param([string] $Path)
    try {{
        if (-not (Test-Path -LiteralPath $Path)) {{ return $null }}
        return (Get-Item -LiteralPath $Path).GetValue('')
    }} catch {{
        Write-UpdateLog "Could not read registry ${{Path}}: $($_.Exception.Message)"
        return $null
    }}
}}

function Disable-NativeHostRegistration {{
    param([string] $Path)
    try {{
        if (Test-Path -LiteralPath $Path) {{
            Write-UpdateLog "Disabling native host registration: $Path"
            Remove-Item -LiteralPath $Path -Recurse -Force
        }}
    }} catch {{
        Write-UpdateLog "Could not disable native host registration ${{Path}}: $($_.Exception.Message)"
    }}
}}

function Restore-NativeHostRegistration {{
    param([string] $Path, [object] $Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) {{ return }}
    try {{
        Write-UpdateLog "Restoring native host registration: $Path"
        New-Item -Path $Path -Force | Out-Null
        Set-Item -LiteralPath $Path -Value ([string] $Value)
    }} catch {{
        Write-UpdateLog "Could not restore native host registration ${{Path}}: $($_.Exception.Message)"
    }}
}}

function Start-UpdatedApp {{
    $UpdatedExe = Join-Path $InstallDir $ExeName
    if (-not (Test-Path -LiteralPath $UpdatedExe -PathType Leaf)) {{
        throw "Updated executable was not found: $UpdatedExe"
    }}
    try {{
        Write-UpdateLog "Starting updated app: $UpdatedExe"
        Start-Process -FilePath $UpdatedExe -WorkingDirectory $InstallDir -ErrorAction Stop
    }} catch {{
        Write-UpdateLog "Start-Process failed: $($_.Exception.Message)"
        $StartArgs = '/c start "" "' + $UpdatedExe + '"'
        Start-Process -FilePath 'cmd.exe' -ArgumentList $StartArgs -WorkingDirectory $InstallDir -WindowStyle Hidden -ErrorAction Stop
    }}
}}

try {{
    Write-UpdateLog "Update started"

    $ChromeHostValue = Get-DefaultRegistryValue $ChromeHostKey
    $EdgeHostValue = Get-DefaultRegistryValue $EdgeHostKey
    Disable-NativeHostRegistration $ChromeHostKey
    Disable-NativeHostRegistration $EdgeHostKey
    Stop-ImageName $HostExeName

    if ($ProcessIdToWait -gt 0) {{
        $Deadline = (Get-Date).AddSeconds(120)
        while (Get-Process -Id $ProcessIdToWait -ErrorAction SilentlyContinue) {{
            if ((Get-Date) -gt $Deadline) {{
                throw "Timed out waiting for current app process to exit"
            }}
            Start-Sleep -Milliseconds 250
        }}
    }}
    Start-Sleep -Milliseconds 600
    Stop-ImageName $HostExeName

    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    $PayloadDir = $WorkDir
    if (-not (Test-Path -LiteralPath (Join-Path $PayloadDir $ExeName))) {{
        $Candidate = Get-ChildItem -LiteralPath $WorkDir -Directory | Where-Object {{
            Test-Path -LiteralPath (Join-Path $_.FullName $ExeName)
        }} | Select-Object -First 1
        if ($null -ne $Candidate) {{
            $PayloadDir = $Candidate.FullName
        }}
    }}
    if (-not (Test-Path -LiteralPath (Join-Path $PayloadDir $ExeName))) {{
        throw "Update package does not contain $ExeName"
    }}

    $InstallItems = @(Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction Stop)
    foreach ($InstallItem in $InstallItems) {{
        Copy-Item -LiteralPath $InstallItem.FullName -Destination $BackupDir -Recurse -Force -ErrorAction Stop
    }}
    $BackupComplete = $true
    $InstallMutationStarted = $true

    Get-ChildItem -LiteralPath $PayloadDir -Force | ForEach-Object {{
        $Target = Join-Path $InstallDir $_.Name
        if (Test-Path -LiteralPath $Target) {{
            Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
        }}
        Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction Stop
    }}

    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
    Write-UpdateLog "Update installed successfully, restarting app"
    Start-UpdatedApp

    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PackagePath -Force -ErrorAction SilentlyContinue
}} catch {{
    $FailureMessage = $_.Exception.Message
    Write-UpdateLog "Update failed: $FailureMessage"
    if ($InstallMutationStarted -and $BackupComplete) {{
        try {{
            Write-UpdateLog "Rolling back from backup"
            Get-ChildItem -LiteralPath $BackupDir -Force | ForEach-Object {{
                $Target = Join-Path $InstallDir $_.Name
                Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
            }}
            Start-UpdatedApp
        }} catch {{
            Write-UpdateLog "Rollback failed: $($_.Exception.Message)"
        }}
    }}
    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
}}
"#,
        pid = current_pid,
        package_path = package_path.replace('\'', "''"),
        install_dir = install_dir.to_string_lossy().replace('\'', "''"),
        exe_name = exe_name.replace('\'', "''"),
        work_dir = work_dir.to_string_lossy().replace('\'', "''"),
        backup_dir = backup_dir.to_string_lossy().replace('\'', "''"),
        log_path = log_path.to_string_lossy().replace('\'', "''"),
    );

    fs::write(&script_path, ps_script.as_bytes())
        .map_err(|e| format!("写入更新脚本失败: {}", e))?;

    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script_path.to_string_lossy(),
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map_err(|e| format!("启动更新脚本失败: {}", e))?;
    let _ = staging.keep();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::process::exit(0);
    });

    Ok(json!({
        "packagePath": package_path,
        "scriptPath": script_path.to_string_lossy(),
        "installDir": install_dir.to_string_lossy(),
        "willRestart": true,
    }))
}

pub(crate) fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split('.')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    for (x, y) in va.iter().zip(vb.iter()) {
        if x > y {
            return 1;
        }
        if x < y {
            return -1;
        }
    }
    va.len().cmp(&vb.len()) as i32
}
