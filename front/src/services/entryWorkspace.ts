import type { VaultEntry } from '../types'

export type EntryFilterMode = 'all' | 'favorites' | 'recent' | 'login' | 'other' | 'totp' | 'folder'

export type EntryFilterPreferences = {
  favoriteIds?: ReadonlySet<string>
  recentIds?: readonly string[]
}

export function filterVaultEntries(
  entries: VaultEntry[],
  term = '',
  mode: EntryFilterMode = 'all',
  preferences: EntryFilterPreferences = {}
): VaultEntry[] {
  const query = term.trim().toLowerCase()
  const recentRanks = new Map((preferences.recentIds || []).map((id, index) => [id, index]))
  return filterVaultEntriesInternal(entries, query, mode, preferences, recentRanks)
}

function filterVaultEntriesInternal(
  entries: VaultEntry[],
  query: string,
  mode: EntryFilterMode,
  preferences: EntryFilterPreferences,
  recentRanks: ReadonlyMap<string, number>
): VaultEntry[] {
  const result = entries
    .map((entry) => filterVaultEntry(entry, query, mode, preferences, recentRanks))
    .filter((entry): entry is VaultEntry => Boolean(entry))
  if (mode === 'recent') {
    return result.sort((left, right) => recentEntryRank(left, recentRanks) - recentEntryRank(right, recentRanks))
  }
  return result
}

function filterVaultEntry(
  entry: VaultEntry,
  query: string,
  mode: EntryFilterMode,
  preferences: EntryFilterPreferences,
  recentRanks: ReadonlyMap<string, number>
): VaultEntry | null {
  if (entry.status && entry.status !== 'active') return null

  const children = entry.kind === 'folder'
    ? filterVaultEntriesInternal(entry.children || [], query, mode, preferences, recentRanks)
    : []
  const directMatch = matchesFilterMode(entry, mode, preferences) && matchesSearchTerm(entry, query)

  if (entry.kind === 'folder') {
    return directMatch || children.length ? { ...entry, children } : null
  }
  return directMatch ? entry : null
}

function matchesFilterMode(entry: VaultEntry, mode: EntryFilterMode, preferences: EntryFilterPreferences) {
  if (mode === 'favorites') return Boolean(preferences.favoriteIds?.has(entry.id))
  if (mode === 'recent') return Boolean(preferences.recentIds?.includes(entry.id))
  if (mode === 'login') return entry.kind === 'login'
  if (mode === 'other') return entry.kind !== 'login' && entry.kind !== 'folder'
  if (mode === 'folder') return entry.kind === 'folder'
  if (mode === 'totp') return entry.kind === 'login' && Boolean(entry.totpSecret)
  return true
}

function recentEntryRank(entry: VaultEntry, recentRanks: ReadonlyMap<string, number>): number {
  const directRank = recentRanks.get(entry.id)
  if (directRank !== undefined) return directRank
  if (entry.kind !== 'folder') return Number.POSITIVE_INFINITY
  return Math.min(...(entry.children || []).map((child) => recentEntryRank(child, recentRanks)), Number.POSITIVE_INFINITY)
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
