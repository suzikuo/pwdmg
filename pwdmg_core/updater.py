from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict

from .paths import UPDATE_DIR, ensure_app_dir
from .version import APP_VERSION


MAX_MANIFEST_BYTES = 1024 * 1024
MAX_PACKAGE_BYTES = 500 * 1024 * 1024
HTTP_TIMEOUT_SECONDS = 20
WINDOWS_ASSET_KEYS = ("windows", "win64", "win")
HEX_SHA256_RE = re.compile(r"^[a-fA-F0-9]{64}$")
DEFAULT_UPDATE_MANIFEST_URL = "https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json"


class UpdateError(Exception):
    pass


class DesktopUpdateService:
    def __init__(self, *, current_version: str = APP_VERSION, update_dir: Path | None = None) -> None:
        ensure_app_dir()
        self.current_version = current_version
        self.update_dir = update_dir or UPDATE_DIR

    def check(self, manifest_url: str) -> Dict[str, Any]:
        manifest_url = self._normalize_manifest_url(manifest_url)
        manifest = self._fetch_manifest(manifest_url)
        parsed = self._parse_manifest(manifest, manifest_url)
        parsed["currentVersion"] = self.current_version
        parsed["updateAvailable"] = compare_versions(parsed["latestVersion"], self.current_version) > 0
        parsed["canApply"] = is_packaged_windows()
        return parsed

    def download(self, manifest_url: str) -> Dict[str, Any]:
        update = self.check(manifest_url)
        if not update["updateAvailable"]:
            raise UpdateError("Already on the latest version")

        asset = update["asset"]
        package_path = self._download_asset(
            url=asset["url"],
            expected_sha256=asset["sha256"],
            expected_size=asset.get("size", 0),
            file_name=asset["fileName"],
        )

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

        exe_path = Path(sys.executable).resolve()
        install_dir = exe_path.parent
        script_path = self._write_apply_script(package, install_dir, exe_path.name)
        launch_hidden_powershell(script_path)

        return {
            "packagePath": str(package),
            "scriptPath": str(script_path),
            "installDir": str(install_dir),
            "willRestart": True,
        }

    def _normalize_manifest_url(self, manifest_url: str) -> str:
        value = (manifest_url or "").strip() or DEFAULT_UPDATE_MANIFEST_URL
        parsed = urllib.parse.urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme == "https":
            return value
        if parsed.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}:
            return value
        raise UpdateError("Update manifest URL must use HTTPS")

    def _fetch_manifest(self, manifest_url: str) -> Dict[str, Any]:
        data = fetch_url(manifest_url, MAX_MANIFEST_BYTES)
        try:
            manifest = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UpdateError("Update manifest is not valid JSON") from exc
        if not isinstance(manifest, dict):
            raise UpdateError("Update manifest must be a JSON object")
        return manifest

    def _parse_manifest(self, manifest: Dict[str, Any], manifest_url: str) -> Dict[str, Any]:
        version = str(manifest.get("version") or "").strip()
        if not version:
            raise UpdateError("Update manifest is missing version")

        asset = select_windows_asset(manifest)
        url = str(asset.get("url") or "").strip()
        sha256 = str(asset.get("sha256") or "").strip().lower()
        if not url:
            raise UpdateError("Update manifest is missing the Windows asset URL")
        validate_download_url(url)
        if not HEX_SHA256_RE.match(sha256):
            raise UpdateError("Update manifest must include a valid SHA256 for the Windows asset")

        size = to_int(asset.get("size"), 0)
        if size < 0 or size > MAX_PACKAGE_BYTES:
            raise UpdateError("Update package size is invalid")

        return {
            "supported": True,
            "manifestUrl": manifest_url,
            "latestVersion": version,
            "updateAvailable": False,
            "notes": str(manifest.get("notes") or ""),
            "publishedAt": str(manifest.get("publishedAt") or ""),
            "canApply": False,
            "asset": {
                "url": url,
                "sha256": sha256,
                "size": size,
                "fileName": safe_file_name(asset.get("fileName") or file_name_from_url(url, version)),
            },
        }

    def _download_asset(
        self,
        *,
        url: str,
        expected_sha256: str,
        expected_size: int,
        file_name: str,
    ) -> Path:
        self.update_dir.mkdir(parents=True, exist_ok=True)
        destination = self.update_dir / safe_file_name(file_name)
        if destination.exists() and sha256_file(destination) == expected_sha256:
            return destination

        validate_download_url(url)
        temp_path = destination.with_suffix(destination.suffix + ".tmp")
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

    def _write_apply_script(self, package: Path, install_dir: Path, exe_name: str) -> Path:
        self.update_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        script_path = self.update_dir / f"apply-update-{stamp}.ps1"
        work_dir = self.update_dir / f"apply-{stamp}"
        backup_dir = self.update_dir / f"backup-{stamp}"
        pid = os.getpid()

        script = f"""$ErrorActionPreference = 'Stop'
$ProcessIdToWait = {pid}
$PackagePath = {ps_quote(str(package))}
$InstallDir = {ps_quote(str(install_dir))}
$ExeName = {ps_quote(exe_name)}
$WorkDir = {ps_quote(str(work_dir))}
$BackupDir = {ps_quote(str(backup_dir))}

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

if (Test-Path -LiteralPath $WorkDir) {{
    Remove-Item -LiteralPath $WorkDir -Recurse -Force
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

$CurrentExe = Join-Path $InstallDir $ExeName
if (Test-Path -LiteralPath $CurrentExe) {{
    Copy-Item -LiteralPath $CurrentExe -Destination (Join-Path $BackupDir $ExeName) -Force
}}

Copy-Item -Path (Join-Path $PayloadDir '*') -Destination $InstallDir -Recurse -Force
Start-Process -FilePath (Join-Path $InstallDir $ExeName)
"""
        script_path.write_text(script, encoding="utf-8")
        return script_path


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
