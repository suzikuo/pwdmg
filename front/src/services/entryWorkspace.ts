import type { VaultEntry } from '../types'
import { buildVaultSearchIndex } from './searchIndex.ts'

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
  return buildVaultSearchIndex(entries).filter(term, mode, preferences)
}
