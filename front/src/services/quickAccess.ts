import { buildVaultSearchIndex } from './searchIndex.ts'
import type { VaultEntry } from '../types'

export type QuickAccessPreferences = {
  favoriteIds?: ReadonlySet<string>
  recentIds?: readonly string[]
  limit?: number
}

export function searchQuickAccessEntries(
  entries: VaultEntry[],
  term = '',
  preferences: QuickAccessPreferences = {}
): VaultEntry[] {
  return buildVaultSearchIndex(entries).quickAccess(term, preferences)
}
