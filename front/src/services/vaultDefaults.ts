import type { LoginAccountSource, VaultEntry, VaultPayload } from '../types'

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])

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
        objectName: 'mypwdmg-vault.json'
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
    domains: Array.isArray(entry.domains) ? entry.domains.filter(Boolean) : [],
    username: entry.username || '',
    email: entry.email || '',
    password: entry.password || '',
    phone: entry.phone || '',
    loginAccountSource: normalizeLoginAccountSource(entry.loginAccountSource),
    note: entry.note || '',
    totpSecret: entry.totpSecret || '',
    children: normalizeEntries(entry.children || [])
  }))
}

function normalizeLoginAccountSource(value: unknown): LoginAccountSource {
  return typeof value === 'string' && LOGIN_ACCOUNT_SOURCES.has(value as LoginAccountSource)
    ? (value as LoginAccountSource)
    : 'auto'
}

function makeId() {
  return crypto.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
