import type { EntryHistoryAction, EntryHistoryField, VaultEntry, VaultEntryHistory, VaultEntryHistoryChange, VaultEntrySnapshot } from '../types'

export const ENTRY_HISTORY_LIMIT = 10

const TRACKED_FIELDS: EntryHistoryField[] = [
  'title', 'domains', 'username', 'email', 'password', 'phone',
  'loginAccountSource', 'note', 'totpSecret', 'customFields', 'status'
]

const FIELD_LABELS: Record<EntryHistoryField, string> = {
  title: '名称',
  domains: '域名',
  username: '账号',
  email: '邮箱',
  password: '密码',
  phone: '手机号',
  loginAccountSource: '自动填充账号',
  note: '备注',
  totpSecret: 'TOTP',
  customFields: '自定义字段',
  status: '状态'
}

const OPTIONAL_SNAPSHOT_FIELDS: Array<keyof VaultEntrySnapshot> = [
  'status', 'statusReason', 'statusUpdatedAt', 'deletedAt', 'username', 'email',
  'password', 'phone', 'loginAccountSource', 'note', 'totpSecret', 'customFields'
]

export function createEntrySnapshot(entry: VaultEntry): VaultEntrySnapshot {
  const copy = JSON.parse(JSON.stringify(entry)) as VaultEntry
  delete copy.history
  delete copy.children
  return copy as VaultEntrySnapshot
}

export function restoreEntrySnapshot(entry: VaultEntry, snapshot: VaultEntrySnapshot): void {
  for (const field of OPTIONAL_SNAPSHOT_FIELDS) {
    if (!(field in snapshot)) delete entry[field]
  }
  entry.title = snapshot.title
  entry.domains = [...(snapshot.domains || [])]
  for (const field of OPTIONAL_SNAPSHOT_FIELDS) {
    if (field in snapshot) (entry as unknown as Record<string, unknown>)[field] = snapshot[field]
  }
}

export function entryHistoryFieldLabel(field: EntryHistoryField): string {
  return FIELD_LABELS[field] || field
}

export function limitEntryHistory(history: VaultEntryHistory[]): VaultEntryHistory[] {
  return history.slice(0, ENTRY_HISTORY_LIMIT)
}

export function shouldRecordEntryHistory(action: EntryHistoryAction, changeCount: number): boolean {
  if (action === 'created') return false
  return action !== 'updated' || changeCount > 0
}

export function clearEntryHistoryRecords(entry: VaultEntry): number {
  const count = Array.isArray(entry.history) ? entry.history.length : 0
  entry.history = []
  return count
}

export function buildEntryHistoryChanges(
  before: VaultEntry | VaultEntrySnapshot | null | undefined,
  after: VaultEntry | VaultEntrySnapshot
): VaultEntryHistoryChange[] {
  const changes: VaultEntryHistoryChange[] = []
  for (const field of TRACKED_FIELDS) {
    if (!before && (field === 'loginAccountSource' || field === 'status')) continue
    const previous = historyFieldValue(before, field)
    const next = historyFieldValue(after, field)
    if (previous.key === next.key) continue
    changes.push({ field, before: previous.display, after: next.display })
  }
  return changes
}

function historyFieldValue(
  entry: VaultEntry | VaultEntrySnapshot | null | undefined,
  field: EntryHistoryField
): { key: string; display: string } {
  if (!entry) return { key: '', display: '未设置' }

  if (field === 'domains') {
    const values = [...new Set((entry.domains || []).map((value) => String(value).trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
    return {
      key: values.map((value) => value.toLocaleLowerCase()).join('\n'),
      display: values.length ? values.join(', ') : '未设置'
    }
  }

  if (field === 'password' || field === 'totpSecret') {
    const value = String(entry[field] || '')
    return {
      key: value,
      display: value ? `已设置（${value.length} 位）` : '未设置'
    }
  }

  if (field === 'customFields') {
    const fields = Array.isArray(entry.customFields) ? entry.customFields : []
    const key = JSON.stringify(fields.map((item) => ({
      id: item.id,
      label: item.label,
      value: item.value,
      type: item.type,
      protected: item.protected
    })))
    const labels = fields.map((item) => item.label).filter(Boolean)
    return { key, display: labels.length ? `${labels.length} 项：${labels.join('、')}` : '未设置' }
  }

  if (field === 'loginAccountSource') {
    const value = entry.loginAccountSource || 'auto'
    const labels = { auto: '自动', username: '账号', email: '邮箱', phone: '手机号' }
    return { key: value, display: labels[value] }
  }

  if (field === 'status') {
    const value = entry.status || 'active'
    const labels = { active: '正常', disabled: '已归档', trashed: '回收站' }
    return { key: value, display: labels[value] }
  }

  const value = String(entry[field] || '').replace(/\r\n/g, '\n').trim()
  return { key: value, display: summarizeValue(value) }
}

function summarizeValue(value: string): string {
  if (!value) return '未设置'
  const limit = 240
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value
}
