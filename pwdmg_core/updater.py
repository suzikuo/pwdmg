from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .paths import UPDATE_DIR, ensure_app_dir
from .version import APP_VERSION


MAX_MANIFEST_BYTES = 1024 * 1024
MAX_PACKAGE_BYTES = 500 * 1024 * 1024
HTTP_TIMEOUT_SECONDS = 20
WINDOWS_ASSET_KEYS = ("windows", "win64", "win")
HEX_SHA256_RE = re.compile(r"^[a-fA-F0-9]{64}$")
DEFAULT_UPDATE_MANIFEST_URL = "https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json"
UPDATE_SIGNING_KEY_ID = "mypwdmg-update-2026-01"
UPDATE_PUBLIC_KEY_B64 = "YvQQkegFxgCmfPe23B1HctOqXf+DALTv2dFBXIy4Apk="
VERIFIED_METADATA_SUFFIX = ".verified.json"
VERIFIED_METADATA_VERSION = 1
GITHUB_RELEASE_ASSET_PATH_RE = re.compile(
    r"^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[^/]+/[^/]+$"
)
PACKAGED_HOST_EXE = "My Password Host.exe"


class UpdateError(Exception):
    pass


class DesktopUpdateService:
    def __init__(
        self,
        *,
        current_version: str = APP_VERSION,
        update_dir: Path | None = None,
        public_key_b64: str = UPDATE_PUBLIC_KEY_B64,
    ) -> None:
        ensure_app_dir()
        self.current_version = current_version
        self.update_dir = update_dir or UPDATE_DIR
        self.public_key_b64 = public_key_b64

    def check(self, manifest_url: str) -> Dict[str, Any]:
        parsed, _manifest = self._load_verified_update(manifest_url)
        return parsed

    def _load_verified_update(self, manifest_url: str) -> tuple[Dict[str, Any], Dict[str, Any]]:
        manifest_urls = self._normalize_manifest_urls(manifest_url)
        manifest_url, manifest = self._fetch_manifest_from_candidates(manifest_urls)
        parsed = self._parse_manifest(manifest, manifest_url)
        parsed["currentVersion"] = self.current_version
        parsed["updateAvailable"] = compare_versions(parsed["latestVersion"], self.current_version) > 0
        parsed["canApply"] = is_packaged_windows()
        return parsed, manifest

    def download(self, manifest_url: str) -> Dict[str, Any]:
        update, manifest = self._load_verified_update(manifest_url)
        if not update["updateAvailable"]:
            raise UpdateError("Already on the latest version")

        asset = update["asset"]
        cached_package = self.update_dir / safe_file_name(asset["fileName"])
        self._cleanup_update_dir(keep=cached_package)
        package_path = self._download_asset(
            url=asset.get("urls") or asset["url"],
            expected_sha256=asset["sha256"],
            expected_size=asset.get("size", 0),
            file_name=asset["fileName"],
        )
        self._write_verified_download_record(package_path, update["manifestUrl"], manifest)

        return {
            "update": update,
            "packagePath": str(package_path),
            "sha256": asset["sha256"],
            "size": package_path.stat().st_size,
        }

    def apply(self, package_path: str) -> Dict[str, Any]:
        if not is_packaged_windows():
            raise UpdateError("Desktop auto update is only available in packaged Windows builds")

        package = Path(package_path).resolve()
        update_root = self.update_dir.resolve()
        if not package.exists() or package.suffix.lower() != ".zip":
            raise UpdateError("Update package does not exist or is not a zip file")
        if not is_relative_to(package, update_root):
            raise UpdateError("Update package must be downloaded by this app before it can be applied")

        update = self._verify_downloaded_package(package)
        asset = update["asset"]
        self._cleanup_update_dir(keep=package)
        exe_path = Path(sys.executable).resolve()
        install_dir = exe_path.parent
        script_path = self._write_apply_script(
            package,
            install_dir,
            exe_path.name,
            expected_sha256=asset["sha256"],
            expected_size=asset["size"],
        )
        launch_hidden_powershell(script_path)

        return {
            "packagePath": str(package),
            "scriptPath": str(script_path),
            "installDir": str(install_dir),
            "willRestart": True,
        }

    def _cleanup_update_dir(self, keep: Path | None = None) -> None:
        self.update_dir.mkdir(parents=True, exist_ok=True)
        update_root = self.update_dir.resolve()
        keep_path = keep.resolve() if keep else None
        for child in self.update_dir.iterdir():
            try:
                child_path = child.resolve()
            except OSError:
                continue
            if keep_path and child_path == keep_path:
                continue
            if not is_relative_to(child_path, update_root):
                continue
            name = child.name
            should_delete = (
                name.startswith("apply-")
                or name.startswith("backup-")
                or (name.startswith("apply-update-") and name.endswith(".ps1"))
                or name.endswith(VERIFIED_METADATA_SUFFIX)
                or name.endswith(".tmp")
                or name.lower().endswith(".zip")
            )
            if not should_delete:
                continue
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
            except OSError:
                pass

    def _normalize_manifest_url(self, manifest_url: str) -> str:
        return self._normalize_manifest_urls(manifest_url)[0]

    def _normalize_manifest_urls(self, manifest_url: str) -> list[str]:
        values = split_url_candidates(manifest_url) or [DEFAULT_UPDATE_MANIFEST_URL]
        result: list[str] = []
        for value in values:
            parsed = urllib.parse.urlparse(value)
            host = (parsed.hostname or "").lower()
            if parsed.scheme == "https" or (parsed.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}):
                if value not in result:
                    result.append(value)
                continue
            raise UpdateError("Update manifest URL must use HTTPS")
        return result

    def _fetch_manifest(self, manifest_url: str) -> Dict[str, Any]:
        data = fetch_url(manifest_url, MAX_MANIFEST_BYTES)
        try:
            manifest = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UpdateError("Update manifest is not valid JSON") from exc
        if not isinstance(manifest, dict):
            raise UpdateError("Update manifest must be a JSON object")
        return manifest

    def _fetch_manifest_from_candidates(self, manifest_urls: list[str]) -> tuple[str, Dict[str, Any]]:
        last_error: Exception | None = None
        for manifest_url in manifest_urls:
            try:
                return manifest_url, self._fetch_manifest(manifest_url)
            except Exception as exc:
                last_error = exc
        if isinstance(last_error, UpdateError):
            raise last_error
        raise UpdateError(str(last_error or "Update manifest request failed"))

    def _parse_manifest(self, manifest: Dict[str, Any], manifest_url: str) -> Dict[str, Any]:
        verify_manifest_signature(manifest, self.public_key_b64)
        version = str(manifest.get("version") or "").strip()
        if not version:
            raise UpdateError("Update manifest is missing version")

        asset = select_windows_asset(manifest)
        urls = collect_asset_urls(asset)
        url = urls[0] if urls else ""
        sha256 = str(asset.get("sha256") or "").strip().lower()
        if not url:
            raise UpdateError("Update manifest is missing the Windows asset URL")
        for candidate_url in urls:
            validate_github_release_asset_url(candidate_url)
        if not HEX_SHA256_RE.match(sha256):
            raise UpdateError("Update manifest must include a valid SHA256 for the Windows asset")

        size = to_int(asset.get("size"), 0)
        if size <= 0 or size > MAX_PACKAGE_BYTES:
            raise UpdateError("Update package size is invalid")

        file_name = safe_file_name(asset.get("fileName") or file_name_from_url(url, version))
        for candidate_url in urls:
            if safe_file_name(file_name_from_url(candidate_url, version)).lower() != file_name.lower():
                raise UpdateError("Update asset URL and fileName do not match")

        return {
            "supported": True,
            "manifestUrl": manifest_url,
            "latestVersion": version,
            "updateAvailable": False,
            "notes": str(manifest.get("notes") or ""),
            "publishedAt": str(manifest.get("publishedAt") or ""),
            "canApply": False,
            "signatureVerified": True,
            "signatureKeyId": UPDATE_SIGNING_KEY_ID,
            "asset": {
                "url": url,
                "urls": urls,
                "sha256": sha256,
                "size": size,
                "fileName": file_name,
            },
        }

    def _write_verified_download_record(
        self,
        package: Path,
        manifest_url: str,
        manifest: Dict[str, Any],
    ) -> Path:
        record_path = verified_metadata_path(package)
        temp_path = record_path.with_suffix(record_path.suffix + ".tmp")
        record = {
            "formatVersion": VERIFIED_METADATA_VERSION,
            "manifestUrl": manifest_url,
            "manifest": manifest,
        }
        encoded = json.dumps(record, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_MANIFEST_BYTES:
            raise UpdateError("Verified update metadata is too large")
        temp_path.write_bytes(encoded)
        os.replace(temp_path, record_path)
        return record_path

    def _verify_downloaded_package(self, package: Path) -> Dict[str, Any]:
        record_path = verified_metadata_path(package)
        if not record_path.is_file():
            raise UpdateError("Verified update metadata is missing; download the update again")
        try:
            encoded = record_path.read_bytes()
            if len(encoded) > MAX_MANIFEST_BYTES:
                raise UpdateError("Verified update metadata is too large")
            record = json.loads(encoded.decode("utf-8"))
        except UpdateError:
            raise
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UpdateError("Verified update metadata is invalid; download the update again") from exc
        if not isinstance(record, dict) or record.get("formatVersion") != VERIFIED_METADATA_VERSION:
            raise UpdateError("Verified update metadata format is unsupported")
        manifest = record.get("manifest")
        if not isinstance(manifest, dict):
            raise UpdateError("Verified update metadata does not contain a manifest")

        update = self._parse_manifest(manifest, str(record.get("manifestUrl") or ""))
        if compare_versions(update["latestVersion"], self.current_version) <= 0:
            raise UpdateError("Refusing to apply an older or current update version")
        asset = update["asset"]
        if package.name.lower() != asset["fileName"].lower():
            raise UpdateError("Update package name does not match verified metadata")

        actual_size = package.stat().st_size
        if actual_size != asset["size"]:
            raise UpdateError("Update package size verification failed before apply")
        if sha256_file(package) != asset["sha256"]:
            raise UpdateError("Update package SHA256 verification failed before apply")
        return update

    def _download_asset(
        self,
        *,
        url: str | list[str],
        expected_sha256: str,
        expected_size: int,
        file_name: str,
    ) -> Path:
        self.update_dir.mkdir(parents=True, exist_ok=True)
        destination = self.update_dir / safe_file_name(file_name)
        if (
            destination.exists()
            and destination.stat().st_size == expected_size
            and sha256_file(destination) == expected_sha256
        ):
            return destination

        urls = url if isinstance(url, list) else [url]
        temp_path = destination.with_suffix(destination.suffix + ".tmp")
        last_error: Exception | None = None
        for candidate_url in urls:
            try:
                return self._download_asset_from_url(
                    url=candidate_url,
                    expected_sha256=expected_sha256,
                    expected_size=expected_size,
                    destination=destination,
                    temp_path=temp_path,
                )
            except Exception as exc:
                last_error = exc
                try:
                    temp_path.unlink()
                except OSError:
                    pass
        if isinstance(last_error, UpdateError):
            raise last_error
        raise UpdateError(str(last_error or "Update package download failed"))

    def _download_asset_from_url(
        self,
        *,
        url: str,
        expected_sha256: str,
        expected_size: int,
        destination: Path,
        temp_path: Path,
    ) -> Path:
        validate_github_release_asset_url(url)
        digest = hashlib.sha256()
        total = 0

        request = urllib.request.Request(url, headers={"User-Agent": "MyPasswordManager-Updater"})
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            length = to_int(response.headers.get("Content-Length"), 0)
            limit = expected_size or length or MAX_PACKAGE_BYTES
            if limit > MAX_PACKAGE_BYTES:
                raise UpdateError("Update package is too large")
            with temp_path.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_PACKAGE_BYTES or total > limit + 1024:
                        raise UpdateError("Update package is larger than expected")
                    digest.update(chunk)
                    handle.write(chunk)

        actual_sha256 = digest.hexdigest()
        if actual_sha256 != expected_sha256:
            try:
                temp_path.unlink()
            except OSError:
                pass
            raise UpdateError("Update package SHA256 verification failed")

        if expected_size and total != expected_size:
            try:
                temp_path.unlink()
            except OSError:
                pass
            raise UpdateError("Update package size verification failed")

        os.replace(temp_path, destination)
        return destination

    def _write_apply_script(
        self,
        package: Path,
        install_dir: Path,
        exe_name: str,
        *,
        expected_sha256: str = "",
        expected_size: int = 0,
    ) -> Path:
        self.update_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        script_path = self.update_dir / f"apply-update-{stamp}.ps1"
        work_dir = self.update_dir / f"apply-{stamp}"
        backup_dir = self.update_dir / f"backup-{stamp}"
        log_path = self.update_dir / f"apply-update-{stamp}.log"
        pid = os.getpid()

        script = f"""$ErrorActionPreference = 'Stop'
$ProcessIdToWait = {pid}
$PackagePath = {ps_quote(str(package))}
$ExpectedSha256 = {ps_quote(expected_sha256.lower())}
$ExpectedSize = {int(expected_size)}
$InstallDir = {ps_quote(str(install_dir))}
$ExeName = {ps_quote(exe_name)}
$HostExeName = {ps_quote(PACKAGED_HOST_EXE)}
$HostName = 'com.suzikuo.mypwdmg'
$ChromeHostKey = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HostName"
$EdgeHostKey = "HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\$HostName"
$WorkDir = {ps_quote(str(work_dir))}
$BackupDir = {ps_quote(str(backup_dir))}
$UpdateDir = {ps_quote(str(self.update_dir))}
$LogPath = {ps_quote(str(log_path))}
$BackupComplete = $false
$InstallMutationStarted = $false

function Resolve-FullPath {{
    param([string] $Path)
    return [System.IO.Path]::GetFullPath($Path)
}}

function Assert-UnderPath {{
    param([string] $Path, [string] $Root, [string] $Label)
    $FullPath = Resolve-FullPath $Path
    $FullRoot = (Resolve-FullPath $Root).TrimEnd('\\')
    if ($FullPath -ne $FullRoot -and -not $FullPath.StartsWith($FullRoot + '\\', [System.StringComparison]::OrdinalIgnoreCase)) {{
        throw "$Label is outside allowed directory: $FullPath"
    }}
    return $FullPath
}}

function Assert-DeleteTarget {{
    param([string] $Path, [string] $Root, [string] $Label)
    $FullPath = Assert-UnderPath $Path $Root $Label
    $FullRoot = (Resolve-FullPath $Root).TrimEnd('\\')
    if ($FullPath.TrimEnd('\\') -eq $FullRoot) {{
        throw "$Label cannot be the root directory: $FullPath"
    }}
    return $FullPath
}}

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
        Write-UpdateLog "Could not read registry ${Path}: $($_.Exception.Message)"
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
        Write-UpdateLog "Could not disable native host registration ${Path}: $($_.Exception.Message)"
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
        Write-UpdateLog "Could not restore native host registration ${Path}: $($_.Exception.Message)"
    }}
}}

function Start-UpdatedApp {{
    $UpdatedExe = Join-Path $InstallDir $ExeName
    if (-not (Test-Path -LiteralPath $UpdatedExe -PathType Leaf)) {{
        throw "Updated executable was not found: $UpdatedExe"
    }}
    try {{
        Write-UpdateLog "Starting updated app with Start-Process: $UpdatedExe"
        Start-Process -FilePath $UpdatedExe -WorkingDirectory $InstallDir -ErrorAction Stop
        Write-UpdateLog "Start-Process returned successfully"
    }} catch {{
        Write-UpdateLog "Start-Process failed: $($_.Exception.Message)"
        Write-UpdateLog "Starting updated app with cmd fallback"
        $StartArgs = '/c start "" "' + $UpdatedExe + '"'
        Start-Process -FilePath 'cmd.exe' -ArgumentList $StartArgs -WorkingDirectory $InstallDir -WindowStyle Hidden -ErrorAction Stop
        Write-UpdateLog "cmd fallback returned successfully"
    }}
}}

function Restore-InstallBackup {{
    if (-not $BackupComplete) {{
        throw "A complete backup is not available"
    }}
    Write-UpdateLog "Rolling back installation from $BackupDir"
    Get-ChildItem -LiteralPath $InstallDir -Force | ForEach-Object {{
        Remove-Item -LiteralPath (Assert-DeleteTarget $_.FullName $InstallDir 'Rollback target') -Recurse -Force -ErrorAction Stop
    }}
    Get-ChildItem -LiteralPath $BackupDir -Force | ForEach-Object {{
        Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction Stop
    }}
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $ExeName) -PathType Leaf)) {{
        throw "Rollback did not restore $ExeName"
    }}
    Write-UpdateLog "Rollback completed"
}}

try {{
    Write-UpdateLog "Update started"
    $InstallDir = Resolve-FullPath $InstallDir
    $UpdateDir = Resolve-FullPath $UpdateDir
    $PackagePath = Assert-UnderPath $PackagePath $UpdateDir 'PackagePath'
    $WorkDir = Assert-DeleteTarget $WorkDir $UpdateDir 'WorkDir'
    $BackupDir = Assert-DeleteTarget $BackupDir $UpdateDir 'BackupDir'
    $LogPath = Assert-UnderPath $LogPath $UpdateDir 'LogPath'
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {{
        throw "Update package was not found: $PackagePath"
    }}
    $PackageItem = Get-Item -LiteralPath $PackagePath -ErrorAction Stop
    if ($ExpectedSize -le 0 -or $PackageItem.Length -ne $ExpectedSize) {{
        throw "Update package size verification failed before extraction"
    }}
    if (-not $ExpectedSha256 -or (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) {{
        throw "Update package SHA256 verification failed before extraction"
    }}
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $ExeName))) {{
        throw "InstallDir does not contain $ExeName"
    }}
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
    Start-Sleep -Milliseconds 800
    Stop-ImageName $HostExeName

    if (Test-Path -LiteralPath $WorkDir) {{
        Remove-Item -LiteralPath (Assert-DeleteTarget $WorkDir $UpdateDir 'WorkDir') -Recurse -Force
    }}
    if (Test-Path -LiteralPath $BackupDir) {{
        Remove-Item -LiteralPath (Assert-DeleteTarget $BackupDir $UpdateDir 'BackupDir') -Recurse -Force
    }}
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

    Expand-Archive -LiteralPath $PackagePath -DestinationPath $WorkDir -Force
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
    $PayloadDir = Assert-UnderPath $PayloadDir $WorkDir 'PayloadDir'
    $PayloadHostPath = Assert-UnderPath (Join-Path $PayloadDir $HostExeName) $PayloadDir 'PayloadHostPath'
    if (-not (Test-Path -LiteralPath $PayloadHostPath -PathType Leaf)) {{
        throw "Update package does not contain $HostExeName"
    }}
    $ExpectedHostSha256 = (Get-FileHash -LiteralPath $PayloadHostPath -Algorithm SHA256).Hash

    $InstallItems = @(Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction Stop)
    if ($InstallItems.Count -eq 0) {{
        throw "Install directory is empty; refusing to continue"
    }}
    foreach ($InstallItem in $InstallItems) {{
        Copy-Item -LiteralPath $InstallItem.FullName -Destination $BackupDir -Recurse -Force -ErrorAction Stop
    }}
    if (-not (Test-Path -LiteralPath (Join-Path $BackupDir $ExeName) -PathType Leaf)) {{
        throw "Backup verification failed: $ExeName is missing"
    }}
    $BackupComplete = $true
    $InstallMutationStarted = $true
    Get-ChildItem -LiteralPath $PayloadDir -Force | ForEach-Object {{
        $Target = Join-Path $InstallDir $_.Name
        if (Test-Path -LiteralPath $Target) {{
            Remove-Item -LiteralPath (Assert-DeleteTarget $Target $InstallDir 'Install target') -Recurse -Force -ErrorAction Stop
        }}
        Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction Stop
    }}
    $InstalledHostPath = Assert-UnderPath (Join-Path $InstallDir $HostExeName) $InstallDir 'InstalledHostPath'
    if (-not (Test-Path -LiteralPath $InstalledHostPath -PathType Leaf)) {{
        throw "Updated installation does not contain $HostExeName"
    }}
    $InstalledHostSha256 = (Get-FileHash -LiteralPath $InstalledHostPath -Algorithm SHA256).Hash
    if ($InstalledHostSha256 -ne $ExpectedHostSha256) {{
        throw "$HostExeName verification failed after installation"
    }}
    Write-UpdateLog "$HostExeName updated and verified: $InstalledHostSha256"

    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
    Write-UpdateLog "Update copied, restarting"
    Start-UpdatedApp

    Get-ChildItem -LiteralPath $UpdateDir -Force | Where-Object {{
        $Candidate = Assert-UnderPath $_.FullName $UpdateDir 'Update cleanup target'
        $_.FullName -ne $LogPath -and
        (
            $_.Name -like 'apply-*' -or
            $_.Name -like 'backup-*' -or
            $_.Name -like 'apply-update-*.ps1' -or
            $_.Name -like '*.tmp' -or
            $_.Name -like '*.zip'
        )
    }} | ForEach-Object {{
        Remove-Item -LiteralPath (Assert-DeleteTarget $_.FullName $UpdateDir 'Update cleanup target') -Recurse -Force -ErrorAction SilentlyContinue
    }}
}} catch {{
    $FailureMessage = $_.Exception.Message
    $RollbackFailure = $null
    if ($InstallMutationStarted) {{
        try {{
            Restore-InstallBackup
            try {{ Start-UpdatedApp }} catch {{ Write-UpdateLog "Could not restart rolled back app: $($_.Exception.Message)" }}
        }} catch {{
            $RollbackFailure = $_.Exception.Message
            Write-UpdateLog "Rollback failed: $RollbackFailure"
        }}
    }}
    Restore-NativeHostRegistration $ChromeHostKey $ChromeHostValue
    Restore-NativeHostRegistration $EdgeHostKey $EdgeHostValue
    Write-UpdateLog "Update failed: $FailureMessage"
    if ($RollbackFailure) {{
        throw "Update failed: $FailureMessage. Rollback also failed: $RollbackFailure"
    }}
    if ($InstallMutationStarted) {{
        throw "Update failed and the previous installation was restored: $FailureMessage"
    }}
    throw "Update failed before installation changes: $FailureMessage"
}}
"""
        script = sanitize_powershell_variable_colons(script)
        script_path.write_text(script, encoding="utf-8")
        return script_path


def sanitize_powershell_variable_colons(script: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.lower() in {"env", "script", "global", "local", "private", "using", "variable"}:
            return match.group(0)
        return f"${{{name}}}:"

    return re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*):", replace, script)


def canonical_manifest_bytes(manifest: Dict[str, Any]) -> bytes:
    if not isinstance(manifest, dict):
        raise UpdateError("Update manifest must be a JSON object")
    unsigned = dict(manifest)
    unsigned.pop("signature", None)
    try:
        canonical = json.dumps(
            unsigned,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise UpdateError("Update manifest cannot be canonicalized") from exc
    return canonical.encode("utf-8")


def verify_manifest_signature(manifest: Dict[str, Any], public_key_b64: str = UPDATE_PUBLIC_KEY_B64) -> None:
    signature_block = manifest.get("signature") if isinstance(manifest, dict) else None
    if not isinstance(signature_block, dict):
        raise UpdateError("Update manifest signature is missing")
    if signature_block.get("algorithm") != "Ed25519":
        raise UpdateError("Update manifest signature algorithm is unsupported")
    if signature_block.get("keyId") != UPDATE_SIGNING_KEY_ID:
        raise UpdateError("Update manifest signature key is not trusted")
    try:
        public_key_bytes = base64.b64decode(str(public_key_b64), validate=True)
        signature = base64.b64decode(str(signature_block.get("value") or ""), validate=True)
        if len(public_key_bytes) != 32 or len(signature) != 64:
            raise ValueError("invalid Ed25519 key or signature length")
        public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
        public_key.verify(signature, canonical_manifest_bytes(manifest))
    except (InvalidSignature, TypeError, ValueError) as exc:
        raise UpdateError("Update manifest signature verification failed") from exc


def sign_manifest(manifest: Dict[str, Any], private_key_path: Path) -> Dict[str, Any]:
    try:
        private_key = serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
    except (OSError, TypeError, ValueError) as exc:
        raise UpdateError("Update signing private key could not be loaded") from exc
    if not isinstance(private_key, Ed25519PrivateKey):
        raise UpdateError("Update signing private key must be Ed25519")
    signed = dict(manifest)
    signed.pop("signature", None)
    signature = private_key.sign(canonical_manifest_bytes(signed))
    signed["signature"] = {
        "algorithm": "Ed25519",
        "keyId": UPDATE_SIGNING_KEY_ID,
        "value": base64.b64encode(signature).decode("ascii"),
    }
    return signed


def generate_signing_key(private_key_path: Path, public_key_path: Path) -> str:
    if private_key_path.exists() or public_key_path.exists():
        raise UpdateError("Signing key already exists; refusing to overwrite it")
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    public_key_path.parent.mkdir(parents=True, exist_ok=True)
    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    raw_public = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    private_key_path.write_bytes(private_bytes)
    try:
        private_key_path.chmod(0o600)
        public_key_path.write_bytes(public_pem)
    except Exception:
        try:
            private_key_path.unlink()
        except OSError:
            pass
        raise
    return base64.b64encode(raw_public).decode("ascii")


def verified_metadata_path(package: Path) -> Path:
    return package.with_name(package.name + VERIFIED_METADATA_SUFFIX)


def fetch_url(url: str, max_bytes: int) -> bytes:
    validate_download_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "MyPasswordManager-Updater"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        content = response.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise UpdateError("Remote response is too large")
    return content


def validate_download_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}:
        return
    raise UpdateError("Update downloads must use HTTPS")


def validate_github_release_asset_url(url: str) -> None:
    parsed = urllib.parse.urlparse(str(url or ""))
    try:
        port = parsed.port
    except ValueError as exc:
        raise UpdateError("Update asset URL is invalid") from exc
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").lower() != "github.com"
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not GITHUB_RELEASE_ASSET_PATH_RE.fullmatch(parsed.path)
        or urllib.parse.unquote(parsed.path) != parsed.path
    ):
        raise UpdateError("Update assets must use a trusted GitHub Release download URL")


def split_url_candidates(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = [str(item or "") for item in value]
    else:
        raw_values = re.split(r"[\s,;]+", str(value or ""))
    result: list[str] = []
    for raw_value in raw_values:
        candidate = raw_value.strip()
        if candidate and candidate not in result:
            result.append(candidate)
    return result


def collect_asset_urls(asset: Dict[str, Any]) -> list[str]:
    result = split_url_candidates(asset.get("urls"))
    for candidate in split_url_candidates(asset.get("url")):
        if candidate not in result:
            result.append(candidate)
    return result


def select_windows_asset(manifest: Dict[str, Any]) -> Dict[str, Any]:
    assets = manifest.get("assets")
    if isinstance(assets, dict):
        for key in WINDOWS_ASSET_KEYS:
            asset = assets.get(key)
            if isinstance(asset, dict):
                return asset
    asset = manifest.get("windows")
    if isinstance(asset, dict):
        return asset
    raise UpdateError("Update manifest is missing a Windows asset")


def compare_versions(left: str, right: str) -> int:
    left_parts = version_parts(left)
    right_parts = version_parts(right)
    length = max(len(left_parts), len(right_parts))
    left_parts += [0] * (length - len(left_parts))
    right_parts += [0] * (length - len(right_parts))
    if left_parts > right_parts:
        return 1
    if left_parts < right_parts:
        return -1
    return 0


def version_parts(value: str) -> list[int]:
    cleaned = str(value or "").strip().lower().lstrip("v")
    numbers = [int(part) for part in re.findall(r"\d+", cleaned)]
    return numbers or [0]


def safe_file_name(value: Any) -> str:
    name = Path(str(value or "")).name.strip()
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)
    if not name.lower().endswith(".zip"):
        name = f"{name or 'update'}.zip"
    return name[:120]


def file_name_from_url(url: str, version: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(urllib.parse.unquote(parsed.path)).name
    return name or f"MyPasswordDesktop-{version}-windows.zip"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 256), b""):
            digest.update(chunk)
    return digest.hexdigest()


def to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def is_packaged_windows() -> bool:
    return os.name == "nt" and bool(getattr(sys, "frozen", False))


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def launch_hidden_powershell(script_path: Path) -> None:
    command = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
    ]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(command, close_fds=True, creationflags=creationflags)


def _write_json_atomic(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    encoded = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    temp_path.write_bytes(encoded)
    os.replace(temp_path, path)


def _updater_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="My Password signed update manifest tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sign_parser = subparsers.add_parser("sign-manifest", help="Sign a canonical JSON update manifest")
    sign_parser.add_argument("--input", required=True, type=Path)
    sign_parser.add_argument("--output", required=True, type=Path)
    sign_parser.add_argument("--private-key", required=True, type=Path)

    verify_parser = subparsers.add_parser("verify-manifest", help="Verify a signed update manifest")
    verify_parser.add_argument("--input", required=True, type=Path)

    key_parser = subparsers.add_parser("generate-signing-key", help="Generate a one-time Ed25519 signing key")
    key_parser.add_argument("--private-key", required=True, type=Path)
    key_parser.add_argument("--public-key", required=True, type=Path)

    args = parser.parse_args(argv)
    try:
        if args.command == "sign-manifest":
            raw = args.input.read_bytes()
            if len(raw) > MAX_MANIFEST_BYTES:
                raise UpdateError("Unsigned manifest is too large")
            manifest = json.loads(raw.decode("utf-8"))
            if not isinstance(manifest, dict):
                raise UpdateError("Unsigned manifest must be a JSON object")
            signed = sign_manifest(manifest, args.private_key)
            verify_manifest_signature(signed)
            _write_json_atomic(args.output, signed)
            print(f"Signed update manifest: {args.output}")
            return 0
        if args.command == "verify-manifest":
            raw = args.input.read_bytes()
            if len(raw) > MAX_MANIFEST_BYTES:
                raise UpdateError("Signed manifest is too large")
            manifest = json.loads(raw.decode("utf-8"))
            if not isinstance(manifest, dict):
                raise UpdateError("Signed manifest must be a JSON object")
            verify_manifest_signature(manifest)
            print(f"Verified update manifest: {args.input}")
            return 0
        if args.command == "generate-signing-key":
            public_key_b64 = generate_signing_key(args.private_key, args.public_key)
            fingerprint = hashlib.sha256(base64.b64decode(public_key_b64)).hexdigest()
            print(f"Private key: {args.private_key}")
            print(f"Public key: {args.public_key}")
            print(f"UPDATE_PUBLIC_KEY_B64={public_key_b64}")
            print(f"Raw public key SHA256={fingerprint}")
            print("Update UPDATE_PUBLIC_KEY_B64 before distributing a client that trusts this key.")
            return 0
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, UpdateError) as exc:
        parser.exit(1, f"error: {exc}\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(_updater_cli())
