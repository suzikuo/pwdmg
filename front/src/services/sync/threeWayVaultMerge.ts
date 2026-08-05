import type { VaultEntry, VaultEntryHistory, VaultEntrySnapshot, VaultPayload } from '../../types'
import { canonicalJson } from './canonicalJson.ts'
import { mergePasskeyState, type PasskeyMergeConflict } from './passkeyRemoteGate.ts'

export type VaultMergeConflict = {
  scope: 'entry' | 'passkey' | 'order'
  id: string
  field: string
  reason: 'concurrent-update' | 'delete-update' | 'parent-missing' | 'order-cycle' | PasskeyMergeConflict['reason']
}

export type VaultMergeResult = {
  payload: VaultPayload
  conflicts: VaultMergeConflict[]
}

type FlatEntry = Omit<VaultEntry, 'children'> & { parentId: string }

const ENTRY_FIELDS: (keyof FlatEntry)[] = [
  'kind', 'title', 'status', 'statusReason', 'statusUpdatedAt', 'deletedAt', 'domains',
  'username', 'email', 'password', 'phone', 'loginAccountSource', 'note', 'totpSecret',
  'history', 'parentId'
]

export function mergeVaultPayloads(
  ancestor: VaultPayload,
  local: VaultPayload,
  remote: VaultPayload
): VaultMergeResult {
  const conflicts: VaultMergeConflict[] = []
  const baseIndex = flattenEntries(ancestor.entries)
  const localIndex = flattenEntries(local.entries)
  const remoteIndex = flattenEntries(remote.entries)
  const merged = new Map<string, FlatEntry>()
  const ids = new Set([...baseIndex.nodes.keys(), ...localIndex.nodes.keys(), ...remoteIndex.nodes.keys()])

  for (const id of [...ids].sort()) {
    const value = mergeEntry(
      id,
      baseIndex.nodes.get(id),
      localIndex.nodes.get(id),
      remoteIndex.nodes.get(id),
      remote.updatedAt,
      conflicts
    )
    if (value) merged.set(id, value)
  }

  for (const entry of merged.values()) {
    if (entry.parentId && (!merged.has(entry.parentId) || merged.get(entry.parentId)?.kind !== 'folder')) {
      conflicts.push({ scope: 'entry', id: entry.id, field: 'parentId', reason: 'parent-missing' })
      entry.parentId = ''
    }
  }

  const entries = rebuildEntries(merged, baseIndex.orders, localIndex.orders, remoteIndex.orders, conflicts)
  const passkeys = mergePasskeyState(ancestor, local, remote)
  conflicts.push(...passkeys.conflicts.map((conflict) => ({
    scope: 'passkey' as const,
    id: conflict.id,
    field: conflict.field,
    reason: conflict.reason
  })))

  return {
    payload: {
      ...clone(local),
      version: passkeys.version,
      ...(passkeys.version === 2 ? { passkeySchemaVersion: 1 as const } : { passkeySchemaVersion: undefined }),
      revision: local.revision,
      entries,
      passkeys: passkeys.passkeys,
      passkeyTombstones: passkeys.passkeyTombstones,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    },
    conflicts
  }
}

function mergeEntry(
  id: string,
  base: FlatEntry | undefined,
  local: FlatEntry | undefined,
  remote: FlatEntry | undefined,
  remoteUpdatedAt: number,
  conflicts: VaultMergeConflict[]
): FlatEntry | undefined {
  if (same(local, remote)) return cloneOptional(local)
  if (same(local, base)) return cloneOptional(remote)
  if (same(remote, base)) return cloneOptional(local)

  if (!local || !remote) {
    conflicts.push({ scope: 'entry', id, field: '*', reason: 'delete-update' })
    return cloneOptional(local || remote)
  }

  const result = clone(local)
  let hasRestorableConcurrentWrite = false
  for (const field of ENTRY_FIELDS) {
    const baseValue = base?.[field]
    const localValue = local[field]
    const remoteValue = remote[field]
    if (same(localValue, remoteValue)) setField(result, field, cloneOptional(localValue))
    else if (same(localValue, baseValue)) setField(result, field, cloneOptional(remoteValue))
    else if (same(remoteValue, baseValue)) setField(result, field, cloneOptional(localValue))
    else if (field === 'history') {
      setField(result, field, mergeHistory(local.history, remote.history))
    } else if (field === 'parentId') {
      // Parent changes are structural and still require an explicit conflict.
      conflicts.push({ scope: 'entry', id, field, reason: 'concurrent-update' })
    } else {
      // Keep the local value active, but retain the complete remote snapshot so
      // the losing write remains encrypted and restorable from entry history.
      hasRestorableConcurrentWrite = true
    }
  }
  if (hasRestorableConcurrentWrite) {
    result.history = appendSyncConflictHistory(result.history, id, remote, remoteUpdatedAt)
  }
  return result
}

function rebuildEntries(
  nodes: Map<string, FlatEntry>,
  baseOrders: Map<string, string[]>,
  localOrders: Map<string, string[]>,
  remoteOrders: Map<string, string[]>,
  conflicts: VaultMergeConflict[]
): VaultEntry[] {
  const byParent = new Map<string, string[]>()
  for (const entry of nodes.values()) {
    const siblings = byParent.get(entry.parentId) || []
    siblings.push(entry.id)
    byParent.set(entry.parentId, siblings)
  }

  const build = (parentId: string): VaultEntry[] => {
    const ids = byParent.get(parentId) || []
    const order = mergeSiblingOrder(
      parentId,
      ids,
      baseOrders.get(parentId) || [],
      localOrders.get(parentId) || [],
      remoteOrders.get(parentId) || [],
      conflicts
    )
    return order.map((id) => {
      const flat = nodes.get(id) as FlatEntry
      const { parentId: _parentId, ...entry } = clone(flat)
      return {
        ...entry,
        children: flat.kind === 'folder' ? build(id) : []
      }
    })
  }
  return build('')
}

function mergeSiblingOrder(
  parentId: string,
  mergedIds: string[],
  base: string[],
  local: string[],
  remote: string[],
  conflicts: VaultMergeConflict[]
): string[] {
  const ids = new Set(mergedIds)
  const baseFiltered = base.filter((id) => ids.has(id))
  const localFiltered = local.filter((id) => ids.has(id))
  const remoteFiltered = remote.filter((id) => ids.has(id))
  const baseIds = new Set(baseFiltered)
  const commonBase = baseFiltered.filter((id) => localFiltered.includes(id) && remoteFiltered.includes(id))
  const localCommon = localFiltered.filter((id) => commonBase.includes(id))
  const remoteCommon = remoteFiltered.filter((id) => commonBase.includes(id))
  const baseCommon = baseFiltered.filter((id) => commonBase.includes(id))
  const localMoved = !same(localCommon, baseCommon)
  const remoteMoved = !same(remoteCommon, baseCommon)

  const edges = new Map<string, Set<string>>()
  const indegree = new Map(mergedIds.map((id) => [id, 0]))
  const addEdge = (from: string, to: string) => {
    if (from === to || !ids.has(from) || !ids.has(to)) return
    const targets = edges.get(from) || new Set<string>()
    if (!targets.has(to)) {
      targets.add(to)
      edges.set(from, targets)
      indegree.set(to, (indegree.get(to) || 0) + 1)
    }
  }
  const addSequence = (sequence: string[], additionsOnly = false) => {
    for (let index = 1; index < sequence.length; index += 1) {
      const from = sequence[index - 1]
      const to = sequence[index]
      if (!additionsOnly || !baseIds.has(from) || !baseIds.has(to)) addEdge(from, to)
    }
  }

  if (localMoved) addSequence(localFiltered)
  if (remoteMoved) addSequence(remoteFiltered)
  if (!localMoved && !remoteMoved) addSequence(baseFiltered)
  if (!localMoved) addSequence(localFiltered, true)
  if (!remoteMoved) addSequence(remoteFiltered, true)

  const rank = (id: string) => averageRank(id, [baseFiltered, localFiltered, remoteFiltered])
  const ready = mergedIds.filter((id) => (indegree.get(id) || 0) === 0).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const result: string[] = []
  while (ready.length) {
    const id = ready.shift() as string
    result.push(id)
    for (const target of edges.get(id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1)
      if (indegree.get(target) === 0) {
        ready.push(target)
        ready.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      }
    }
  }

  if (result.length !== mergedIds.length) {
    conflicts.push({ scope: 'order', id: parentId || 'root', field: 'position', reason: 'order-cycle' })
    return [...mergedIds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  }
  return result
}

function flattenEntries(entries: VaultEntry[]) {
  const nodes = new Map<string, FlatEntry>()
  const orders = new Map<string, string[]>()
  const visit = (items: VaultEntry[], parentId: string) => {
    orders.set(parentId, items.map((item) => item.id))
    for (const item of items) {
      const { children: _children, ...value } = item
      nodes.set(item.id, { ...clone(value), parentId })
      visit(item.children || [], item.id)
    }
  }
  visit(entries, '')
  return { nodes, orders }
}

function mergeHistory(left: VaultEntry['history'], right: VaultEntry['history']): VaultEntry['history'] {
  const values = new Map<string, NonNullable<VaultEntry['history']>[number]>()
  for (const item of [...(left || []), ...(right || [])]) {
    const current = values.get(item.id)
    if (!current || item.at > current.at || (item.at === current.at && canonicalJson(item) > canonicalJson(current))) {
      values.set(item.id, clone(item))
    }
  }
  return [...values.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 20)
}

function appendSyncConflictHistory(
  history: VaultEntry['history'],
  entryId: string,
  remote: FlatEntry,
  remoteUpdatedAt: number
): VaultEntry['history'] {
  const snapshot = remoteSnapshot(remote)
  const id = `sync-conflict-${stableStringHash(canonicalJson([entryId, snapshot]))}`
  const existing = (history || []).find((item) => item.id === id)
  if (existing) return mergeHistory(history, [])

  const record: VaultEntryHistory = {
    id,
    action: 'updated',
    at: conflictTimestamp(remote, remoteUpdatedAt),
    title: snapshot.title || '',
    username: snapshot.username || '',
    email: snapshot.email || '',
    phone: snapshot.phone || '',
    domains: [...(snapshot.domains || [])],
    note: 'Sync conflict: remote version preserved in history',
    snapshot
  }
  return mergeHistory([...(history || []), record], [])
}

function remoteSnapshot(remote: FlatEntry): VaultEntrySnapshot {
  const { parentId: _parentId, ...value } = clone(remote)
  return value as VaultEntrySnapshot
}

function conflictTimestamp(remote: FlatEntry, remoteUpdatedAt: number): number {
  const candidates = [remoteUpdatedAt, ...(remote.history || []).map((item) => item.at)]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
  return candidates.length ? Math.max(...candidates) : 1
}

function stableStringHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function averageRank(id: string, sequences: string[][]): number {
  const ranks = sequences.map((sequence) => sequence.indexOf(id)).filter((index) => index >= 0)
  return ranks.length ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length : Number.MAX_SAFE_INTEGER
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left === undefined ? null : left) === canonicalJson(right === undefined ? null : right)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value)
}

function setField<K extends keyof FlatEntry>(target: FlatEntry, field: K, value: FlatEntry[K] | undefined) {
  if (value === undefined) delete target[field]
  else target[field] = value
}
