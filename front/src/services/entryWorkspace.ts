import type { VaultEntry } from '../types'

export type EntryFilterMode = 'all' | 'login' | 'other' | 'totp' | 'folder'

export function filterVaultEntries(
  entries: VaultEntry[],
  term = '',
  mode: EntryFilterMode = 'all'
): VaultEntry[] {
  const query = term.trim().toLowerCase()
  return entries
    .map((entry) => filterVaultEntry(entry, query, mode))
    .filter((entry): entry is VaultEntry => Boolean(entry))
}

function filterVaultEntry(entry: VaultEntry, query: string, mode: EntryFilterMode): VaultEntry | null {
  if (entry.status && entry.status !== 'active') return null

  const children = entry.kind === 'folder'
    ? filterVaultEntries(entry.children || [], query, mode)
    : []
  const directMatch = matchesFilterMode(entry, mode) && matchesSearchTerm(entry, query)

  if (entry.kind === 'folder') {
    return directMatch || children.length ? { ...entry, children } : null
  }
  return directMatch ? entry : null
}

function matchesFilterMode(entry: VaultEntry, mode: EntryFilterMode) {
  if (mode === 'login') return entry.kind === 'login'
  if (mode === 'other') return entry.kind !== 'login' && entry.kind !== 'folder'
  if (mode === 'folder') return entry.kind === 'folder'
  if (mode === 'totp') return entry.kind === 'login' && Boolean(entry.totpSecret)
  return true
}

function matchesSearchTerm(entry: VaultEntry, query: string) {
  if (!query) return true
  return [
    entry.title,
    entry.username,
    entry.email,
    entry.phone,
    entry.note,
    ...(entry.customFields || []).filter((field) => !field.protected).flatMap((field) => [field.label, field.value]),
    ...(entry.domains || [])
  ].some((value) => String(value || '').toLowerCase().includes(query))
}
