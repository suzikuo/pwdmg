export type EntryIdStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const FAVORITE_ENTRY_IDS_KEY = 'mypwdmg.entryFavorites.v1'
export const RECENT_ENTRY_IDS_KEY = 'mypwdmg.entryRecent.v1'
export const MAX_RECENT_ENTRY_IDS = 20
const MAX_STORED_ENTRY_IDS = 500

function resolveStorage(): EntryIdStorage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

function normalizeIds(ids: Iterable<unknown>, limit = MAX_STORED_ENTRY_IDS): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of ids) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id || id.length > 256 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= limit) break
  }
  return result
}

export function readEntryIdList(key: string, storage: EntryIdStorage | null = resolveStorage()): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeIds(parsed) : []
  } catch {
    return []
  }
}

export function writeEntryIdList(
  key: string,
  ids: Iterable<unknown>,
  storage: EntryIdStorage | null = resolveStorage()
): string[] {
  const normalized = normalizeIds(ids)
  try {
    storage?.setItem(key, JSON.stringify(normalized))
  } catch {
    // Preferences are optional; a blocked storage should not affect vault access.
  }
  return normalized
}

export function loadFavoriteEntryIds(storage: EntryIdStorage | null = resolveStorage()): Set<string> {
  return new Set(readEntryIdList(FAVORITE_ENTRY_IDS_KEY, storage))
}

export function loadRecentEntryIds(storage: EntryIdStorage | null = resolveStorage()): string[] {
  return readEntryIdList(RECENT_ENTRY_IDS_KEY, storage).slice(0, MAX_RECENT_ENTRY_IDS)
}

export function toggleFavoriteEntryId(
  entryId: string,
  current: Iterable<string>,
  storage: EntryIdStorage | null = resolveStorage()
): Set<string> {
  const next = new Set(normalizeIds(current))
  if (next.has(entryId)) next.delete(entryId)
  else if (entryId.trim()) next.add(entryId.trim())
  writeEntryIdList(FAVORITE_ENTRY_IDS_KEY, next, storage)
  return next
}

export function setFavoriteEntryIds(
  entryIds: Iterable<string>,
  favorite: boolean,
  current: Iterable<string>,
  storage: EntryIdStorage | null = resolveStorage()
): Set<string> {
  const next = new Set(normalizeIds(current))
  for (const entryId of normalizeIds(entryIds)) {
    if (favorite) next.add(entryId)
    else next.delete(entryId)
  }
  writeEntryIdList(FAVORITE_ENTRY_IDS_KEY, next, storage)
  return next
}

export function rememberRecentEntryId(
  entryId: string,
  current: readonly string[],
  storage: EntryIdStorage | null = resolveStorage()
): string[] {
  const normalizedId = entryId.trim()
  if (!normalizedId) return [...current]
  const next = [normalizedId, ...current.filter((id) => id !== normalizedId)]
    .slice(0, MAX_RECENT_ENTRY_IDS)
  writeEntryIdList(RECENT_ENTRY_IDS_KEY, next, storage)
  return next
}

export function pruneEntryPreferenceIds(
  validIds: ReadonlySet<string>,
  favoriteIds: Iterable<string>,
  recentIds: readonly string[],
  storage: EntryIdStorage | null = resolveStorage()
): { favoriteIds: Set<string>; recentIds: string[] } {
  const nextFavorites = new Set(normalizeIds(favoriteIds).filter((id) => validIds.has(id)))
  const nextRecent = normalizeIds(recentIds, MAX_RECENT_ENTRY_IDS).filter((id) => validIds.has(id))
  writeEntryIdList(FAVORITE_ENTRY_IDS_KEY, nextFavorites, storage)
  writeEntryIdList(RECENT_ENTRY_IDS_KEY, nextRecent, storage)
  return { favoriteIds: nextFavorites, recentIds: nextRecent }
}
