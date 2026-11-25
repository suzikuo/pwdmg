import type { VaultEntry } from '../../types.ts'

export function walkEntries(
  entries: readonly VaultEntry[],
  visit: (entry: VaultEntry, parentId: string) => void,
  parentId = ''
): void {
  for (const entry of entries) {
    visit(entry, parentId)
    if (entry.children?.length) walkEntries(entry.children, visit, entry.id)
  }
}

export function findEntryById(entries: readonly VaultEntry[], entryId: string): VaultEntry | null {
  if (!entryId) return null
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    if (entry.children?.length) {
      const nested = findEntryById(entry.children, entryId)
      if (nested) return nested
    }
  }
  return null
}

export function findParentEntryId(
  entries: readonly VaultEntry[],
  entryId: string,
  parentId = ''
): string | null {
  if (!entryId) return null
  for (const entry of entries) {
    if (entry.id === entryId) return parentId
    if (entry.children?.length) {
      const nested = findParentEntryId(entry.children, entryId, entry.id)
      if (nested !== null) return nested
    }
  }
  return null
}

export function collectEntryIds(entries: readonly VaultEntry[]): string[] {
  const result: string[] = []
  walkEntries(entries, (entry) => result.push(entry.id))
  return result
}

export function countEntries(entries: readonly VaultEntry[]): number {
  let count = 0
  walkEntries(entries, () => {
    count += 1
  })
  return count
}

export function flattenEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  const result: VaultEntry[] = []
  walkEntries(entries, (entry) => result.push(entry))
  return result
}
