from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List

from .domain import domain_matches, normalize_domain


@dataclass
class VaultIndex:
    entries_by_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    login_entries: List[Dict[str, Any]] = field(default_factory=list)
    exact_domain_entries: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    wildcard_entries: List[Dict[str, Any]] = field(default_factory=list)
    paths_by_id: Dict[str, List[str]] = field(default_factory=dict)

    @classmethod
    def build(cls, entries: Iterable[Dict[str, Any]]) -> "VaultIndex":
        index = cls()
        index._visit(entries, [])
        return index

    def get_entry(self, entry_id: str) -> Dict[str, Any] | None:
        return self.entries_by_id.get(entry_id)

    def get_login(self, entry_id: str) -> Dict[str, Any] | None:
        entry = self.get_entry(entry_id)
        return entry if entry and entry.get("kind") == "login" and entry.get("status", "active") == "active" else None

    def path_for(self, entry_id: str) -> List[str]:
        return list(self.paths_by_id.get(entry_id) or [])

    def matching_logins(self, hostname: str) -> List[Dict[str, Any]]:
        host = normalize_domain(hostname)
        if not host:
            return []

        candidate_ids: set[str] = set()
        for suffix in _domain_suffixes(host):
            for entry in self.exact_domain_entries.get(suffix) or []:
                entry_id = str(entry.get("id") or "")
                if entry_id:
                    candidate_ids.add(entry_id)

        for entry in self.wildcard_entries:
            domains = entry.get("domains") or []
            if any("*" in normalize_domain(domain) and domain_matches(host, domain) for domain in domains):
                entry_id = str(entry.get("id") or "")
                if entry_id:
                    candidate_ids.add(entry_id)

        if not candidate_ids:
            return []
        return [entry for entry in self.login_entries if str(entry.get("id") or "") in candidate_ids]

    def _visit(self, entries: Iterable[Dict[str, Any]], parents: List[str]) -> None:
        for entry in entries or []:
            if not entry:
                continue

            entry_id = str(entry.get("id") or "")
            if entry_id:
                self.entries_by_id[entry_id] = entry
                self.paths_by_id[entry_id] = list(parents)

            if entry.get("kind") == "folder":
                if entry.get("status", "active") != "active":
                    continue
                title = entry.get("title") or "Untitled"
                self._visit(entry.get("children") or [], [*parents, title])
                continue

            if entry.get("kind") != "login":
                continue
            if entry.get("status", "active") != "active":
                continue

            self.login_entries.append(entry)
            has_wildcard = False
            for raw_domain in entry.get("domains") or []:
                domain = normalize_domain(raw_domain)
                if not domain:
                    continue
                if "*" in domain:
                    has_wildcard = True
                else:
                    self.exact_domain_entries.setdefault(domain, []).append(entry)
            if has_wildcard:
                self.wildcard_entries.append(entry)


def _domain_suffixes(hostname: str) -> List[str]:
    parts = normalize_domain(hostname).split(".")
    return [".".join(parts[index:]) for index in range(len(parts)) if parts[index:]]
