import type { EntryKind, EntryStatus, LoginAccountSource, VaultAttachment, VaultCustomField, VaultCustomFieldType, VaultEntry, VaultPayload } from '../types'
import { normalizeAutofillMatchMode } from './autofillRules.ts'
import { limitEntryHistory } from './entryHistory.ts'
import { normalizePasskeyState } from './passkeySchema.ts'
import { secureRandomId } from './secureRandom.ts'

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])
const ENTRY_KINDS = new Set<EntryKind>(['login', 'secure-note', 'card', 'identity', 'api-key', 'folder'])
const CUSTOM_FIELD_TYPES = new Set<VaultCustomFieldType>(['text', 'secret', 'date', 'url', 'email', 'phone'])

export function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function defaultVaultPayload(entries: VaultEntry[] = []): VaultPayload {
  return {
    version: 1,
    revision: 1,
    entries,
    passkeys: [],
    passkeyTombstones: [],
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
  const passkeyState = normalizePasskeyState(payload as unknown as Record<string, unknown>)
  const attachmentKey = normalizeAttachmentKey(payload.attachmentKey)
  const entries = normalizeEntries(payload.entries || [])
  if (!attachmentKey && entriesContainAttachments(entries)) throw new Error('Vault attachment key is missing')
  return {
    version: passkeyState.version,
    ...(attachmentKey ? { attachmentKey } : {}),
    ...(passkeyState.passkeySchemaVersion ? { passkeySchemaVersion: passkeyState.passkeySchemaVersion } : {}),
    revision: normalizeRevision(payload.revision),
    entries,
    passkeys: passkeyState.passkeys,
    passkeyTombstones: passkeyState.passkeyTombstones,
    settings: {
      oss: {
        ...defaults.settings.oss,
        ...(payload.settings?.oss || {})
      }
    },
    updatedAt: Number(payload.updatedAt || nowSeconds())
  }
}

function entriesContainAttachments(entries: VaultEntry[]): boolean {
  return entries.some((entry) => Boolean(entry.attachments?.length) || entriesContainAttachments(entry.children || []))
}

function normalizeAttachmentKey(value: unknown) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Vault attachment key is invalid')
  try {
    const binary = atob(value)
    if (binary.length !== 32 || btoa(binary) !== value) throw new Error('invalid')
  } catch {
    throw new Error('Vault attachment key is invalid')
  }
  return value
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
      kind: normalizeEntryKind(entry.kind),
      title: entry.title || 'Untitled',
      status: normalizeEntryStatus(entry.status),
      statusReason: entry.statusReason || '',
      statusUpdatedAt: Number(entry.statusUpdatedAt || 0),
      deletedAt: Number(entry.deletedAt || 0),
      domains: Array.isArray(entry.domains) ? entry.domains.filter(Boolean) : [],
      autofillMatchMode: normalizeAutofillMatchMode(entry.autofillMatchMode),
      username: entry.username || '',
      email: entry.email || '',
      password: entry.password || '',
      phone: entry.phone || '',
      loginAccountSource: normalizeLoginAccountSource(entry.loginAccountSource),
      note: entry.note || '',
      totpSecret: entry.totpSecret || '',
      customFields: normalizeCustomFields(entry.customFields),
      attachments: normalizeAttachments(entry.attachments),
      history: Array.isArray(entry.history) ? limitEntryHistory(entry.history) : [],
      children: entry.kind === 'folder' ? normalizeEntries(entry.children || [], seenIds, path) : []
    }
  })
}

function normalizeAttachments(value: unknown): VaultAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Vault entry attachments must be an array')
  if (value.length > 100) throw new Error('Vault entry attachment limit exceeded')
  const seen = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Vault attachment reference is malformed')
    const attachment = raw as Partial<VaultAttachment>
    const id = String(attachment.id || '').toLowerCase()
    const name = String(attachment.name || '').trim()
    const mimeType = String(attachment.mimeType || '').toLowerCase()
    const size = Number(attachment.size)
    const createdAt = Number(attachment.createdAt)
    const sha256 = String(attachment.sha256 || '').toLowerCase()
    const ciphertextSha256 = String(attachment.ciphertextSha256 || '').toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Vault attachment ID is invalid')
    if (seen.has(id)) throw new Error('Duplicate attachment reference')
    if (!name || name.length > 255 || /[\0\\/]/.test(name)) throw new Error('Vault attachment name is invalid')
    if (!mimeType || mimeType.length > 127 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)) throw new Error('Vault attachment MIME type is invalid')
    if (!Number.isSafeInteger(size) || size < 0 || size > 10 * 1024 * 1024) throw new Error('Vault attachment size is invalid')
    if (!Number.isSafeInteger(createdAt) || createdAt < 1) throw new Error('Vault attachment timestamp is invalid')
    if (!/^[0-9a-f]{64}$/.test(sha256) || !/^[0-9a-f]{64}$/.test(ciphertextSha256)) throw new Error('Vault attachment hash is invalid')
    seen.add(id)
    return { id, name, mimeType, size, sha256, ciphertextSha256, createdAt }
  })
}

function normalizeEntryKind(value: unknown): EntryKind {
  return typeof value === 'string' && ENTRY_KINDS.has(value as EntryKind) ? value as EntryKind : 'login'
}

function normalizeCustomFields(value: unknown): VaultCustomField[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const field = raw as Partial<VaultCustomField>
    const type = typeof field.type === 'string' && CUSTOM_FIELD_TYPES.has(field.type as VaultCustomFieldType)
      ? field.type as VaultCustomFieldType
      : 'text'
    return [{
      id: String(field.id || `field-${index + 1}`).slice(0, 128),
      label: String(field.label || '自定义字段').slice(0, 200),
      value: String(field.value || '').slice(0, 65_536),
      type,
      protected: field.protected === true || type === 'secret'
    }]
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
  return secureRandomId()
}
