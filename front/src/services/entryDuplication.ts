import type { VaultEntry } from '../types'

type IdFactory = () => string

export function insertDuplicateEntry(
  entries: VaultEntry[],
  sourceId: string,
  createId: IdFactory
): VaultEntry | null {
  const reservedIds = collectEntryIds(entries)
  return insertDuplicateIntoList(entries, sourceId, createId, reservedIds)
}

function insertDuplicateIntoList(
  entries: VaultEntry[],
  sourceId: string,
  createId: IdFactory,
  reservedIds: Set<string>
): VaultEntry | null {
  const sourceIndex = entries.findIndex((entry) => entry.id === sourceId)
  if (sourceIndex >= 0) {
    const duplicate = duplicateEntryTree(entries[sourceIndex], createId, reservedIds, true)
    entries.splice(sourceIndex + 1, 0, duplicate)
    return duplicate
  }

  for (const entry of entries) {
    const duplicate = insertDuplicateIntoList(entry.children || [], sourceId, createId, reservedIds)
    if (duplicate) return duplicate
  }
  return null
}

function duplicateEntryTree(
  source: VaultEntry,
  createId: IdFactory,
  reservedIds: Set<string>,
  root: boolean
): VaultEntry {
  const duplicate: VaultEntry = {
    ...source,
    id: nextUniqueId(createId, reservedIds),
    title: root ? `${source.title || '未命名'} 副本` : source.title,
    status: 'active',
    statusReason: '',
    statusUpdatedAt: 0,
    deletedAt: 0,
    domains: [...(source.domains || [])],
    history: [],
    children: []
  }
  duplicate.children = (source.children || [])
    .filter((child) => !child.status || child.status === 'active')
    .map((child) => duplicateEntryTree(child, createId, reservedIds, false))
  return duplicate
}

function collectEntryIds(entries: VaultEntry[], result = new Set<string>()) {
  for (const entry of entries) {
    result.add(entry.id)
    collectEntryIds(entry.children || [], result)
  }
  return result
}

function nextUniqueId(createId: IdFactory, reservedIds: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = String(createId() || '')
    if (!id || reservedIds.has(id)) continue
    reservedIds.add(id)
    return id
  }
  throw new Error('无法为副本生成唯一标识')
}
