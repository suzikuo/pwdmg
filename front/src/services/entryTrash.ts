import type { VaultEntry } from '../types'

export function removeTrashedEntries(entries: VaultEntry[]): number {
  let removedCount = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.status === 'trashed') {
      removedCount += countEntries([entry])
      entries.splice(index, 1)
      continue
    }
    removedCount += removeTrashedEntries(entry.children || [])
  }
  return removedCount
}

function countEntries(entries: VaultEntry[]): number {
  return entries.reduce((count, entry) => count + 1 + countEntries(entry.children || []), 0)
}
