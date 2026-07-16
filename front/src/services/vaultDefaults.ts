import type { EntryStatus, LoginAccountSource, VaultEntry, VaultPayload } from '../types'

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])

export function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function defaultVaultPayload(entries: VaultEntry[] = []): VaultPayload {
  return {
    version: 1,
    revision: 1,
    entries,
    settings: {
      oss: {
        bucketName: '',
        accessKeyId: '',
        accessKeySecret: '',
        region: '',
        objectName: 'mypwdmg-vault.json',
        autoSync: false,
        autoSyncIntervalMinutes: 1
      }
    },
    updatedAt: nowSeconds()
  }
}

export function cloneVaultPayload(payload: VaultPayload): VaultPayload {
  return JSON.parse(JSON.stringify(payload)) as VaultPayload
}

export function normalizeVaultPayload(payload: Partial<VaultPayload>): VaultPayload {
  const defaults = defaultVaultPayload()
  return {
    version: 1,
    revision: normalizeRevision(payload.revision),
    entries: normalizeEntries(payload.entries || []),
    settings: {
      oss: {
        ...defaults.settings.oss,
        ...(payload.settings?.oss || {})
      }
    },
    updatedAt: Number(payload.updatedAt || nowSeconds())
  }
}

function normalizeEntries(entries: VaultEntry[], seenIds = new Set<string>(), parentPath: number[] = []): VaultEntry[] {
  return entries.map((entry, index) => {
    const path = [...parentPath, index]
    const originalId = String(entry.id || `entry-missing-${path.join('-')}`)
    let id = originalId
    let duplicateIndex = 2
    while (seenIds.has(id)) {
      id = `${originalId}-duplicate-${duplicateIndex}`
      duplicateIndex += 1
    }
    seenIds.add(id)
    return {
      id,
      kind: entry.kind === 'folder' ? 'folder' : 'login',
      title: entry.title || 'Untitled',
      status: normalizeEntryStatus(entry.status),
      statusReason: entry.statusReason || '',
      statusUpdatedAt: Number(entry.statusUpdatedAt || 0),
      deletedAt: Number(entry.deletedAt || 0),
      domains: Array.isArray(entry.domains) ? entry.domains.filter(Boolean) : [],
      username: entry.username || '',
      email: entry.email || '',
      password: entry.password || '',
      phone: entry.phone || '',
      loginAccountSource: normalizeLoginAccountSource(entry.loginAccountSource),
      note: entry.note || '',
      totpSecret: entry.totpSecret || '',
      history: Array.isArray(entry.history) ? entry.history : [],
      children: normalizeEntries(entry.children || [], seenIds, path)
    }
  })
}

function normalizeRevision(value: unknown) {
  const revision = Math.floor(Number(value || 1))
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 1
}

function normalizeEntryStatus(value: unknown): EntryStatus {
  return typeof value === 'string' && ENTRY_STATUSES.has(value as EntryStatus)
    ? (value as EntryStatus)
    : 'active'
}

function normalizeLoginAccountSource(value: unknown): LoginAccountSource {
  return typeof value === 'string' && LOGIN_ACCOUNT_SOURCES.has(value as LoginAccountSource)
    ? (value as LoginAccountSource)
    : 'auto'
}

function makeId() {
  return crypto.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
