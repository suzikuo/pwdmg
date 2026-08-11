from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse, urlunparse


HOST_TOKEN_RE = re.compile(
    r"(?:(?:https?://)?)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)",
    re.IGNORECASE,
)
AUTOFILL_MATCH_MODES = {"base-domain", "exact-host", "subdomain", "url-prefix", "never"}


def normalize_domain(value: str, *, strip_www: bool = True) -> str:
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
    if strip_www and value.startswith("www."):
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


def normalize_autofill_match_mode(value: Any) -> str:
    return value if value in AUTOFILL_MATCH_MODES else "base-domain"


def normalize_autofill_rule(value: str, mode: str) -> str:
    normalized_mode = normalize_autofill_match_mode(mode)
    if normalized_mode == "url-prefix":
        return normalize_url_prefix(value)
    return normalize_domain(value, strip_www=normalized_mode == "base-domain")


def normalize_url_prefix(value: str) -> str:
    try:
        parsed = urlparse(str(value or "").strip())
        scheme = parsed.scheme.lower()
        hostname = (parsed.hostname or "").lower().strip(".")
        if scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
            return ""
        port = parsed.port
    except (TypeError, ValueError):
        return ""

    default_port = 80 if scheme == "http" else 443
    netloc = hostname if not port or port == default_port else f"{hostname}:{port}"
    return urlunparse((scheme, netloc, parsed.path or "/", "", parsed.query, ""))


def autofill_rule_matches(
    hostname: str,
    page_url: str,
    saved_rule: str,
    mode: str,
) -> bool:
    normalized_mode = normalize_autofill_match_mode(mode)
    if normalized_mode == "never":
        return False

    preserve_www = normalized_mode in {"exact-host", "subdomain"}
    host = normalize_domain(hostname, strip_www=not preserve_www)
    if normalized_mode == "url-prefix":
        page = normalize_url_prefix(page_url)
        rule = normalize_url_prefix(saved_rule)
        if not page or not rule:
            return False
        parsed_page = urlparse(page)
        if host and normalize_domain(parsed_page.hostname or "") != host:
            return False
        parsed_rule = urlparse(rule)
        if (parsed_page.scheme, parsed_page.netloc) != (parsed_rule.scheme, parsed_rule.netloc):
            return False
        if page == rule:
            return True
        if not page.startswith(rule):
            return False
        return rule.endswith(("/", "?", "&", "=")) or page[len(rule):len(rule) + 1] in {"/", "?", "&"}

    domain = normalize_domain(saved_rule, strip_www=not preserve_www)
    if not host or not domain:
        return False
    if "*" in domain:
        pattern = "^" + re.escape(domain).replace(r"\*", r"[^.]*") + "$"
        return re.fullmatch(pattern, host) is not None
    if normalized_mode == "exact-host":
        return host == domain
    if normalized_mode == "subdomain":
        return host != domain and host.endswith("." + domain)
    return host == domain or host.endswith("." + domain)


def entry_matches_page(entry: Dict[str, Any], hostname: str, page_url: str = "") -> bool:
    mode = normalize_autofill_match_mode(entry.get("autofillMatchMode"))
    return any(
        autofill_rule_matches(hostname, page_url, rule, mode)
        for rule in entry.get("domains") or []
    )


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
