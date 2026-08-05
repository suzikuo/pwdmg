import type {
  PasskeyTransport,
  VaultPasskey,
  VaultPasskeyTombstone,
  VaultPayloadVersion
} from '../types'

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
const RP_ID_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PASSKEY_TRANSPORTS = new Set<PasskeyTransport>(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])
const PASSKEY_TRANSPORT_ORDER: PasskeyTransport[] = ['internal', 'hybrid', 'usb', 'nfc', 'ble', 'smart-card']
const PASSKEY_FIELDS = new Set([
  'id', 'credentialId', 'rpId', 'rpName', 'userHandle', 'userName', 'userDisplayName',
  'algorithm', 'publicKeyCose', 'privateKeyPkcs8', 'discoverable', 'backupEligible',
  'backupState', 'transports', 'entryId', 'createdAt', 'updatedAt'
])
const TOMBSTONE_FIELDS = new Set(['id', 'credentialId', 'deletedAt'])
export const PASSKEY_SCHEMA_VERSION = 1 as const
const MAX_ID_LENGTH = 128
const MAX_CREDENTIAL_ID_LENGTH = 2048
const MAX_KEY_LENGTH = 16_384
const MAX_USER_HANDLE_LENGTH = 256
const MAX_DISPLAY_LENGTH = 512
const MAX_PASSKEY_ITEMS = 10_000
const UTF8_ENCODER = new TextEncoder()

export type NormalizedPasskeyState = {
  version: VaultPayloadVersion
  passkeySchemaVersion?: typeof PASSKEY_SCHEMA_VERSION
  passkeys: VaultPasskey[]
  passkeyTombstones: VaultPasskeyTombstone[]
}

export function normalizePasskeyState(payload: Record<string, unknown>): NormalizedPasskeyState {
  const declaredVersion = readPayloadVersion(payload.version)
  if (declaredVersion === 2) {
    for (const key of ['passkeys', 'passkeyTombstones']) {
      if (!Object.prototype.hasOwnProperty.call(payload, key) || payload[key] === undefined) {
        throw new Error(`Vault version 2 requires ${key}`)
      }
    }
  }
  const passkeys = normalizePasskeys(readArray(payload, 'passkeys'))
  const passkeyTombstones = normalizePasskeyTombstones(readArray(payload, 'passkeyTombstones'))
  const hasPasskeyState = declaredVersion === 2 || passkeys.length > 0 || passkeyTombstones.length > 0
  const passkeySchemaVersion = readPasskeySchemaVersion(payload.passkeySchemaVersion, hasPasskeyState)
  const liveIds = new Set(passkeys.map((passkey) => passkey.id))
  const liveCredentialIds = new Set(passkeys.map((passkey) => passkey.credentialId))
  for (const tombstone of passkeyTombstones) {
    if (liveIds.has(tombstone.id)) {
      throw new Error(`Passkey ${tombstone.id} cannot be live and deleted`)
    }
    if (liveCredentialIds.has(tombstone.credentialId)) {
      throw new Error(`Passkey credential ${tombstone.credentialId} cannot be live and deleted`)
    }
  }
  return {
    version: hasPasskeyState ? 2 : 1,
    ...(hasPasskeyState ? { passkeySchemaVersion } : {}),
    passkeys,
    passkeyTombstones
  }
}

function normalizePasskeys(values: unknown[]): VaultPasskey[] {
  const ids = new Set<string>()
  const credentialIds = new Set<string>()
  return values.map((value, index) => {
    const raw = readObject(value, `passkeys[${index}]`)
    assertKnownFields(raw, PASSKEY_FIELDS, `passkeys[${index}]`)
    const id = readText(raw.id, `passkeys[${index}].id`, MAX_ID_LENGTH)
    const credentialId = readBase64Url(raw.credentialId, `passkeys[${index}].credentialId`, MAX_CREDENTIAL_ID_LENGTH)
    if (ids.has(id)) throw new Error(`Duplicate passkey id: ${id}`)
    if (credentialIds.has(credentialId)) throw new Error(`Duplicate passkey credentialId: ${credentialId}`)
    ids.add(id)
    credentialIds.add(credentialId)

    const backupEligible = readBoolean(raw.backupEligible, `passkeys[${index}].backupEligible`)
    const backupState = readBoolean(raw.backupState, `passkeys[${index}].backupState`)
    if (backupState && !backupEligible) {
      throw new Error(`passkeys[${index}].backupState requires backupEligible`)
    }
    const createdAt = readTimestamp(raw.createdAt, `passkeys[${index}].createdAt`)
    const updatedAt = readTimestamp(raw.updatedAt, `passkeys[${index}].updatedAt`)
    if (updatedAt < createdAt) throw new Error(`passkeys[${index}].updatedAt predates createdAt`)

    const result: VaultPasskey = {
      id,
      credentialId,
      rpId: readRpId(raw.rpId, `passkeys[${index}].rpId`),
      userHandle: readBase64Url(raw.userHandle, `passkeys[${index}].userHandle`, MAX_USER_HANDLE_LENGTH),
      userName: readText(raw.userName, `passkeys[${index}].userName`, MAX_DISPLAY_LENGTH),
      algorithm: readAlgorithm(raw.algorithm, `passkeys[${index}].algorithm`),
      publicKeyCose: readBase64Url(raw.publicKeyCose, `passkeys[${index}].publicKeyCose`, MAX_KEY_LENGTH),
      privateKeyPkcs8: readBase64Url(raw.privateKeyPkcs8, `passkeys[${index}].privateKeyPkcs8`, MAX_KEY_LENGTH),
      discoverable: readBoolean(raw.discoverable, `passkeys[${index}].discoverable`),
      backupEligible,
      backupState,
      transports: readTransports(raw.transports, `passkeys[${index}].transports`),
      createdAt,
      updatedAt
    }
    const rpName = readOptionalText(raw.rpName, `passkeys[${index}].rpName`, MAX_DISPLAY_LENGTH)
    const userDisplayName = readOptionalText(raw.userDisplayName, `passkeys[${index}].userDisplayName`, MAX_DISPLAY_LENGTH)
    const entryId = readOptionalText(raw.entryId, `passkeys[${index}].entryId`, MAX_ID_LENGTH)
    if (rpName) result.rpName = rpName
    if (userDisplayName) result.userDisplayName = userDisplayName
    if (entryId) result.entryId = entryId
    return result
  })
}

function normalizePasskeyTombstones(values: unknown[]): VaultPasskeyTombstone[] {
  const ids = new Set<string>()
  const credentialIds = new Set<string>()
  return values.map((value, index) => {
    const raw = readObject(value, `passkeyTombstones[${index}]`)
    assertKnownFields(raw, TOMBSTONE_FIELDS, `passkeyTombstones[${index}]`)
    const id = readText(raw.id, `passkeyTombstones[${index}].id`, MAX_ID_LENGTH)
    const credentialId = readBase64Url(
      raw.credentialId,
      `passkeyTombstones[${index}].credentialId`,
      MAX_CREDENTIAL_ID_LENGTH
    )
    if (ids.has(id)) throw new Error(`Duplicate passkey tombstone id: ${id}`)
    if (credentialIds.has(credentialId)) throw new Error(`Duplicate passkey tombstone credentialId: ${credentialId}`)
    ids.add(id)
    credentialIds.add(credentialId)
    return {
      id,
      credentialId,
      deletedAt: readTimestamp(raw.deletedAt, `passkeyTombstones[${index}].deletedAt`)
    }
  })
}

function readPayloadVersion(value: unknown): VaultPayloadVersion {
  const version = value === undefined ? 1 : value
  if (typeof version !== 'number') throw new Error('Unsupported vault payload version')
  if (!Number.isSafeInteger(version) || (version !== 1 && version !== 2)) {
    throw new Error('Unsupported vault payload version')
  }
  return version
}

function readArray(payload: Record<string, unknown>, key: string): unknown[] {
  const value = payload[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`Vault ${key} must be an array`)
  if (value.length > MAX_PASSKEY_ITEMS) throw new Error(`Vault ${key} exceeds the supported item limit`)
  return value
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const text = value.trim()
  if (!text || UTF8_ENCODER.encode(text).byteLength > maxLength) throw new Error(`${field} has an invalid length`)
  return text
}

function readOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') return ''
  return readText(value, field, maxLength)
}

function readBase64Url(value: unknown, field: string, maxLength: number): string {
  const text = readText(value, field, maxLength)
  if (!BASE64URL_RE.test(text)) throw new Error(`${field} must be unpadded base64url`)
  try {
    const padding = '='.repeat((4 - (text.length % 4)) % 4)
    const decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/') + padding)
    const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    if (canonical !== text) throw new Error('non-canonical')
  } catch {
    throw new Error(`${field} must be canonical unpadded base64url`)
  }
  return text
}

function readRpId(value: unknown, field: string): string {
  const rpId = readText(value, field, 253).toLowerCase().replace(/\.$/, '')
  const labels = rpId.split('.')
  if (labels.some((label) => !RP_ID_LABEL_RE.test(label))) throw new Error(`${field} is invalid`)
  return rpId
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

function readAlgorithm(value: unknown, field: string): number {
  if (value !== -7) throw new Error(`${field} supports ES256 (-7) only`)
  return -7
}

function readTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`${field} is invalid`)
  const timestamp = value
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error(`${field} is invalid`)
  return timestamp
}

function readTransports(value: unknown, field: string): PasskeyTransport[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const transports: PasskeyTransport[] = []
  for (const rawTransport of value) {
    if (typeof rawTransport !== 'string' || !PASSKEY_TRANSPORTS.has(rawTransport as PasskeyTransport)) {
      throw new Error(`${field} contains an unsupported transport`)
    }
    const transport = rawTransport as PasskeyTransport
    if (!transports.includes(transport)) transports.push(transport)
  }
  return PASSKEY_TRANSPORT_ORDER.filter((transport) => transports.includes(transport))
}

function readPasskeySchemaVersion(value: unknown, required: boolean): typeof PASSKEY_SCHEMA_VERSION | undefined {
  if (!required && value === undefined) return undefined
  const version = value === undefined ? PASSKEY_SCHEMA_VERSION : value
  if (version !== PASSKEY_SCHEMA_VERSION) throw new Error('Unsupported passkey schema version')
  return PASSKEY_SCHEMA_VERSION
}

function assertKnownFields(raw: Record<string, unknown>, known: Set<string>, field: string): void {
  const unknown = Object.keys(raw).filter((key) => !known.has(key))
  if (unknown.length) throw new Error(`${field} contains unsupported fields: ${unknown.sort().join(', ')}`)
}
