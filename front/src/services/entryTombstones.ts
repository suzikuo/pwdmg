import type { VaultEntry, VaultPayload } from '../types.ts'
import { walkEntries } from './shared/entryTree.ts'

export function normalizeEntryTombstones(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.length)) {
    throw new Error('保险库条目删除标记无效')
  }
  return [...new Set<string>(value)].sort()
}

export function recordPermanentEntryDeletions(before: VaultEntry[], after: VaultPayload, knownTombstones: string[] = []): void {
  const remaining = new Set<string>()
  walkEntries(after.entries, (entry) => { remaining.add(entry.id) })
  const deleted = new Set([...(after.entryTombstones ?? []), ...knownTombstones])
  walkEntries(before, (entry) => {
    if (!remaining.has(entry.id)) deleted.add(entry.id)
  })
  if ([...deleted].some((id) => remaining.has(id))) {
    throw new Error('快照包含已永久删除的条目，请为需恢复的条目创建副本后再同步')
  }
  if (deleted.size) after.entryTombstones = [...deleted].sort()
}
