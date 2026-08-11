from __future__ import annotations

import webbrowser
from urllib.parse import urlsplit, urlunsplit

MAX_EXTERNAL_URL_LENGTH = 2048


def normalize_external_url(value: str) -> str:
    url = str(value or "").strip()
    if not url or len(url) > MAX_EXTERNAL_URL_LENGTH:
        raise ValueError("Invalid external URL")
    if any(ord(char) < 32 for char in url):
        raise ValueError("Invalid external URL")

    parsed = urlsplit(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Only HTTP and HTTPS URLs can be opened")
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise ValueError("External URL must contain a host and no credentials")

    scheme = parsed.scheme.lower()
    return urlunsplit((scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment))


def open_external_url(value: str) -> str:
    url = normalize_external_url(value)
    if not webbrowser.open(url, new=2):
        raise RuntimeError("The system browser could not be opened")
    return url
