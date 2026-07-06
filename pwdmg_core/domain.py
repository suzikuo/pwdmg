from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse


HOST_TOKEN_RE = re.compile(
    r"(?:(?:https?://)?)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)",
    re.IGNORECASE,
)


def normalize_domain(value: str) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    if "://" in value:
        parsed = urlparse(value)
        value = parsed.hostname or ""
    else:
        value = value.split("/", 1)[0]
    value = value.rsplit("@", 1)[-1]
    if ":" in value:
        value = value.split(":", 1)[0]
    value = value.strip(".")
    if value.startswith("www."):
        value = value[4:]
    return value


def extract_domains(*values: str) -> List[str]:
    domains: List[str] = []
    for value in values:
        if not value:
            continue
        for match in HOST_TOKEN_RE.findall(value):
            domain = normalize_domain(match)
            if domain and domain not in domains:
                domains.append(domain)
    return domains


def domain_matches(hostname: str, saved_domain: str) -> bool:
    host = normalize_domain(hostname)
    domain = normalize_domain(saved_domain)
    if not host or not domain:
        return False
    if "*" in domain:
        pattern = "^" + re.escape(domain).replace(r"\*", r"[^.]*") + "$"
        return re.fullmatch(pattern, host) is not None
    return host == domain or host.endswith("." + domain)


def flatten_entries(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    flat: List[Dict[str, Any]] = []
    for entry in entries or []:
        flat.append(entry)
        if entry.get("kind") == "folder":
            flat.extend(flatten_entries(entry.get("children") or []))
    return flat


def find_entry(entries: Iterable[Dict[str, Any]], entry_id: str) -> Dict[str, Any] | None:
    for entry in entries or []:
        if entry.get("id") == entry_id:
            return entry
        nested = find_entry(entry.get("children") or [], entry_id)
        if nested:
            return nested
    return None
