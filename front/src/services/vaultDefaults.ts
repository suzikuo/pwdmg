import type { EntryStatus, LoginAccountSource, VaultEntry, VaultPayload } from '../types'

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])

export function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function defaultVaultPayload(entries: VaultEntry[] = []): VaultPayload {
  return {
    version: 1,
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

function normalizeEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.map((entry) => ({
    id: entry.id || makeId(),
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
    children: normalizeEntries(entry.children || [])
  }))
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
