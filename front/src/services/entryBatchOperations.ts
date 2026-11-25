import type { VaultEntry } from '../types'
import { collectEntryIds, countEntries, findEntryById } from './shared/entryTree.ts'

export { collectEntryIds }

export type BatchMoveResult = {
  movedIds: string[]
  error: '' | 'empty-selection' | 'missing-entry' | 'invalid-destination'
}

export function normalizeSelectedRootIds(entries: VaultEntry[], selectedIds: Iterable<string>): string[] {
  const selected = new Set(selectedIds)
  const result: string[] = []

  function visit(items: VaultEntry[], ancestorSelected: boolean) {
    for (const entry of items) {
      const entrySelected = selected.has(entry.id)
      if (entrySelected && !ancestorSelected) result.push(entry.id)
      visit(entry.children || [], ancestorSelected || entrySelected)
    }
  }

  visit(entries, false)
  return result
}

export function moveSelectedEntries(
  entries: VaultEntry[],
  selectedIds: Iterable<string>,
  targetParentId: string
): BatchMoveResult {
  const movedIds = normalizeSelectedRootIds(entries, selectedIds)
  if (movedIds.length === 0) return { movedIds: [], error: 'empty-selection' }

  const sources = movedIds.map((id) => findEntryById(entries, id))
  if (sources.some((entry) => !entry)) return { movedIds: [], error: 'missing-entry' }
  if (targetParentId) {
    const target = findEntryById(entries, targetParentId)
    if (!target || target.kind !== 'folder') return { movedIds: [], error: 'invalid-destination' }
    if (sources.some((source) => source && (source.id === targetParentId || containsEntry(source, targetParentId)))) {
      return { movedIds: [], error: 'invalid-destination' }
    }
  }

  const movedEntries: VaultEntry[] = []
  for (const id of movedIds) {
    const entry = takeEntry(entries, id)
    if (!entry) return { movedIds: [], error: 'missing-entry' }
    movedEntries.push(entry)
  }

  const target = targetParentId ? findEntryById(entries, targetParentId) : null
  if (targetParentId && (!target || target.kind !== 'folder')) {
    return { movedIds: [], error: 'invalid-destination' }
  }
  const destination = target ? (target.children ||= []) : entries
  destination.push(...movedEntries)
  return { movedIds, error: '' }
}

export function removeSelectedEntries(entries: VaultEntry[], selectedIds: Iterable<string>): number {
  const roots = new Set(normalizeSelectedRootIds(entries, selectedIds))
  let removedCount = 0

  function remove(items: VaultEntry[]) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const entry = items[index]
      if (roots.has(entry.id)) {
        removedCount += countEntries([entry])
        items.splice(index, 1)
        continue
      }
      remove(entry.children || [])
    }
  }

  remove(entries)
  return removedCount
}

export function isEntryInsideAny(entries: VaultEntry[], rootIds: Iterable<string>, entryId: string): boolean {
  for (const rootId of normalizeSelectedRootIds(entries, rootIds)) {
    const root = findEntryById(entries, rootId)
    if (root && (root.id === entryId || containsEntry(root, entryId))) return true
  }
  return false
}

function containsEntry(entry: VaultEntry, entryId: string): boolean {
  return Boolean(findEntryById(entry.children || [], entryId))
}

function takeEntry(entries: VaultEntry[], entryId: string): VaultEntry | null {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) return entries.splice(index, 1)[0]
  for (const entry of entries) {
    const nested = takeEntry(entry.children || [], entryId)
    if (nested) return nested
  }
  return null
}
