import { hasCloudSyncPositionChanged } from '../cloudSyncPosition.ts'
import type { EntryStatus, LoginAccountSource, VaultEntry, VaultPayload } from '../../types.ts'
import {
  CLOUD_SYNC_CHANGE_LABELS,
  CLOUD_SYNC_ENTRY_CHANGE_FIELDS,
  CLOUD_SYNC_MANUAL_REVIEW_FIELDS,
  type CloudSyncChangeDetail,
  type CloudSyncChangeField,
  type CloudSyncChangeType,
  type CloudSyncDiffItem,
  type EntryIndexMeta
} from './types.ts'

export type {
  CloudSyncChangeDetail,
  CloudSyncChangeField,
  CloudSyncChangeType,
  CloudSyncDiffItem,
  CloudSyncDirection,
  CloudSyncEntryChangeField,
  CloudSyncPreview,
  EntryIndexMeta
} from './types.ts'

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])
const LOGIN_ACCOUNT_SOURCE_LABELS: Record<LoginAccountSource, string> = {
  auto: '自动',
  username: '账号',
  email: '邮箱',
  phone: '手机'
}

export function buildCloudSyncDiff(sourcePayload: VaultPayload, basePayload: VaultPayload): CloudSyncDiffItem[] {
  const sourceIndex = indexEntries(sourcePayload.entries || [])
  const baseIndex = indexEntries(basePayload.entries || [])
  const ids = new Set<string>([...sourceIndex.keys(), ...baseIndex.keys()])
  const items: CloudSyncDiffItem[] = []

  for (const id of ids) {
    const sourceMeta = sourceIndex.get(id)
    const baseMeta = baseIndex.get(id)
    if (sourceMeta && !baseMeta) {
      if (hasMissingAncestor(sourceMeta, baseIndex)) continue
      items.push(makeCloudSyncDiffItem('added', sourceMeta, null))
      continue
    }
    if (!sourceMeta && baseMeta) {
      if (hasMissingAncestor(baseMeta, sourceIndex)) continue
      items.push(makeCloudSyncDiffItem('deleted', null, baseMeta))
      continue
    }
    if (sourceMeta && baseMeta) {
      const changes = diffEntryChanges(sourceMeta, baseMeta, sourceIndex, baseIndex)
      if (changes.length) items.push(makeCloudSyncDiffItem('modified', sourceMeta, baseMeta, changes))
    }
  }

  return items
}

export function applyCloudSyncDiffItem(targetEntries: VaultEntry[], sourceEntries: VaultEntry[], item: CloudSyncDiffItem) {
  if (item.changeType === 'deleted') {
    removeEntryCopies(targetEntries, item.id)
    return
  }

  const sourceEntry = findEntry(sourceEntries, item.id)
  if (!sourceEntry) return
  if (item.changeType === 'added') {
    removeEntryCopies(targetEntries, item.id)
    insertEntryAt(targetEntries, item.sourceParentId, cloneValue(sourceEntry), item.sourceIndex)
    return
  }

  const currentEntry = findEntry(targetEntries, item.id)
  if (!currentEntry) return
  for (const detail of item.details) {
    if (detail.checked && detail.key !== 'position') {
      applyCloudSyncEntryField(currentEntry, sourceEntry, detail.key)
    }
  }
  if (item.details.some((detail) => detail.checked && detail.key === 'position')) {
    const moved = takeEntry(targetEntries, item.id)
    if (moved) insertEntryAt(targetEntries, item.sourceParentId, moved.entry, item.sourceIndex)
  }
}

export function cloudSyncSelectionStats(items: CloudSyncDiffItem[]) {
  let selected = 0
  let total = 0
  for (const item of items) {
    if (item.changeType === 'modified') {
      total += item.details.length
      selected += item.details.filter((detail) => detail.checked).length
      continue
    }
    total += 1
    if (item.checked) selected += 1
  }
  return { selected, total }
}

export function countCloudSyncSelections(items: CloudSyncDiffItem[]) {
  return cloudSyncSelectionStats(items).selected
}

export function cloudSyncItemSummary(item: CloudSyncDiffItem) {
  if (item.changeType === 'modified') {
    const stats = cloudSyncSelectionStats([item])
    const summary = stats.total ? `已选 ${stats.selected}/${stats.total} 处` : '无可选字段'
    const fields = item.details.map((detail) => detail.label).join(' · ')
    return [summary, fields].filter(Boolean).join(' · ')
  }
  return `${cloudSyncChangeLabel(item.changeType)} · ${cloudSyncEntryLabel(item)}`
}

export function cloudSyncDiffCountsForItems(items: CloudSyncDiffItem[]) {
  return {
    added: items.filter((item) => item.changeType === 'added').length,
    modified: items.filter((item) => item.changeType === 'modified').length,
    deleted: items.filter((item) => item.changeType === 'deleted').length
  }
}

export function cloudSyncChangeLabel(changeType: CloudSyncChangeType) {
  if (changeType === 'added') return '新增'
  if (changeType === 'modified') return '修改'
  return '删除'
}

export function cloudSyncEntryLabel(item: CloudSyncDiffItem) {
  return item.entryKind === 'folder' ? '分组' : '登录'
}

export function autoCloudSyncManualReviewLabels(items: CloudSyncDiffItem[]) {
  const labels = new Set<string>()
  for (const item of items) {
    if (item.changeType !== 'modified') continue
    for (const detail of item.details) {
      if (CLOUD_SYNC_MANUAL_REVIEW_FIELDS.has(detail.key)) labels.add(CLOUD_SYNC_CHANGE_LABELS[detail.key])
    }
  }
  return [...labels]
}

function makeCloudSyncDiffItem(
  changeType: CloudSyncChangeType,
  sourceMeta: EntryIndexMeta | null,
  baseMeta: EntryIndexMeta | null,
  changes: CloudSyncChangeDetail[] = []
): CloudSyncDiffItem {
  const meta = sourceMeta || baseMeta
  const entry = meta?.entry
  return {
    id: entry?.id || '',
    changeType,
    entryKind: entry?.kind === 'folder' ? 'folder' : 'login',
    title: entry?.title || '未命名',
    path: meta?.path || '未命名',
    checked: true,
    details: changes,
    sourceParentId: sourceMeta?.parentId || '',
    sourceIndex: sourceMeta?.index || 0
  }
}

function indexEntries(entries: VaultEntry[], parentId = '', parents: string[] = [], ancestorIds: string[] = [], result = new Map<string, EntryIndexMeta>()) {
  const siblingIds = entries.map((entry) => entry.id)
  entries.forEach((entry, index) => {
    const title = entry.title || '未命名'
    const path = [...parents, title].join(' / ') || title
    result.set(entry.id, {
      entry,
      parentId,
      index,
      path,
      ancestorIds,
      siblingIds
    })
    indexEntries(entry.children || [], entry.id, [...parents, title], [...ancestorIds, entry.id], result)
  })
  return result
}

function hasMissingAncestor(meta: EntryIndexMeta, otherIndex: Map<string, EntryIndexMeta>) {
  return meta.ancestorIds.some((ancestorId) => !otherIndex.has(ancestorId))
}

function diffEntryChanges(
  sourceMeta: EntryIndexMeta,
  baseMeta: EntryIndexMeta,
  sourceIndex: ReadonlyMap<string, EntryIndexMeta>,
  baseIndex: ReadonlyMap<string, EntryIndexMeta>
) {
  const changes: CloudSyncChangeDetail[] = []
  if (hasCloudSyncPositionChanged(sourceMeta.entry.id, sourceMeta, baseMeta, sourceIndex, baseIndex)) {
    changes.push(makeCloudSyncChangeDetail('position', sourceMeta.path, baseMeta.path))
  }
  const source = comparableCloudSyncEntry(sourceMeta.entry)
  const base = comparableCloudSyncEntry(baseMeta.entry)
  for (const key of CLOUD_SYNC_ENTRY_CHANGE_FIELDS) {
    if (JSON.stringify(source[key as keyof typeof source]) !== JSON.stringify(base[key as keyof typeof base])) {
      changes.push(makeCloudSyncChangeDetail(key, source[key as keyof typeof source], base[key as keyof typeof base]))
    }
  }
  return changes
}

function makeCloudSyncChangeDetail(key: CloudSyncChangeField, sourceValue: unknown, baseValue: unknown): CloudSyncChangeDetail {
  return {
    key,
    label: CLOUD_SYNC_CHANGE_LABELS[key],
    sourceText: formatCloudSyncValue(key, sourceValue),
    baseText: formatCloudSyncValue(key, baseValue),
    checked: true
  }
}

function formatCloudSyncValue(key: CloudSyncChangeField, value: unknown) {
  if (key === 'password' || key === 'totpSecret') {
    const text = String(value || '')
    return text ? `已设置（${text.length} 字符）` : '空'
  }
  if (key === 'domains') {
    const domains = Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
    return domains.length ? domains.join('、') : '空'
  }
  if (key === 'deletedAt') {
    return formatUnixTime(Number(value || 0)) || '空'
  }
  if (key === 'kind') {
    return value === 'folder' ? '分组' : '登录'
  }
  if (key === 'status') {
    return cloudSyncStatusLabel(normalizeEntryStatus(value))
  }
  if (key === 'loginAccountSource') {
    return cloudSyncLoginAccountSourceLabel(normalizeLoginAccountSource(value))
  }
  return compactCloudSyncText(String(value || ''))
}

function compactCloudSyncText(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return '空'
  return text.length > 96 ? `${text.slice(0, 96)}...` : text
}

function cloudSyncStatusLabel(status: EntryStatus) {
  if (status === 'disabled') return '已归档'
  if (status === 'trashed') return '回收站'
  return '正常'
}

function cloudSyncLoginAccountSourceLabel(source: LoginAccountSource) {
  return LOGIN_ACCOUNT_SOURCE_LABELS[source] || LOGIN_ACCOUNT_SOURCE_LABELS.auto
}

export function comparableCloudSyncEntry(entry: VaultEntry) {
  return {
    kind: entry.kind === 'folder' ? 'folder' : 'login',
    title: entry.title || '',
    status: normalizeEntryStatus(entry.status),
    statusReason: entry.statusReason || '',
    deletedAt: Number(entry.deletedAt || 0),
    domains: Array.isArray(entry.domains) ? [...entry.domains] : [],
    username: entry.username || '',
    email: entry.email || '',
    password: entry.password || '',
    phone: entry.phone || '',
    loginAccountSource: normalizeLoginAccountSource(entry.loginAccountSource),
    note: entry.note || '',
    totpSecret: entry.totpSecret || ''
  }
}

function applyCloudSyncEntryField(target: VaultEntry, source: VaultEntry, key: CloudSyncChangeField) {
  switch (key) {
    case 'position':
      return
    case 'kind':
      target.kind = source.kind === 'folder' ? 'folder' : 'login'
      if (target.kind === 'folder') target.children = target.children || []
      return
    case 'title':
      target.title = source.title || ''
      return
    case 'status':
      target.status = normalizeEntryStatus(source.status)
      target.statusUpdatedAt = Number(source.statusUpdatedAt || target.statusUpdatedAt || 0)
      return
    case 'statusReason':
      target.statusReason = source.statusReason || ''
      return
    case 'deletedAt':
      target.deletedAt = Number(source.deletedAt || 0)
      return
    case 'domains':
      target.domains = Array.isArray(source.domains) ? [...source.domains] : []
      return
    case 'username':
      target.username = source.username || ''
      return
    case 'email':
      target.email = source.email || ''
      return
    case 'password':
      target.password = source.password || ''
      return
    case 'phone':
      target.phone = source.phone || ''
      return
    case 'loginAccountSource':
      target.loginAccountSource = normalizeLoginAccountSource(source.loginAccountSource)
      return
    case 'note':
      target.note = source.note || ''
      return
    case 'totpSecret':
      target.totpSecret = source.totpSecret || ''
      return
  }
}

function normalizeLoginAccountSource(value: unknown): LoginAccountSource {
  return typeof value === 'string' && LOGIN_ACCOUNT_SOURCES.has(value as LoginAccountSource)
    ? (value as LoginAccountSource)
    : 'auto'
}

function normalizeEntryStatus(value: unknown): EntryStatus {
  return typeof value === 'string' && ENTRY_STATUSES.has(value as EntryStatus)
    ? (value as EntryStatus)
    : 'active'
}

function removeEntryCopies(entries: VaultEntry[], entryId: string) {
  while (removeEntry(entries, entryId)) {
    // Keep removing stale duplicate IDs left by older drag operations.
  }
}

function removeEntry(entries: VaultEntry[], entryId: string): boolean {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    entries.splice(index, 1)
    return true
  }
  return entries.some((entry) => removeEntry(entry.children || [], entryId))
}

function takeEntry(entries: VaultEntry[], entryId: string, parentId = ''): { entry: VaultEntry; parentId: string; index: number } | null {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    const [entry] = entries.splice(index, 1)
    return { entry, parentId, index }
  }
  for (const entry of entries) {
    const result = takeEntry(entry.children || [], entryId, entry.id)
    if (result) return result
  }
  return null
}

function insertEntryAt(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  if (!parentId) {
    entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
    return true
  }

  if (insertEntryAtParent(entries, parentId, entry, targetIndex)) return true
  entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
  return false
}

function insertEntryAtParent(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  for (const item of entries) {
    if (item.id === parentId && item.kind === 'folder') {
      item.children = item.children || []
      item.children.splice(clampIndex(targetIndex, item.children.length), 0, entry)
      return true
    }
    if (item.children && insertEntryAtParent(item.children, parentId, entry, targetIndex)) return true
  }
  return false
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(0, index), length)
}

function findEntry(entries: VaultEntry[], entryId: string): VaultEntry | null {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    const child = findEntry(entry.children || [], entryId)
    if (child) return child
  }
  return null
}

function formatUnixTime(value: number) {
  const seconds = Number(value) || 0
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleString()
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
