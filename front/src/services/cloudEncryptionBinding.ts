import { validateEnvelope } from './vaultCrypto.ts'

export type CloudEncryptionParameters = {
  name: 'PBKDF2-HMAC-SHA256'
  iterations: number
  salt: string
}

export type CloudEncryptionBinding = {
  version: 1
  kdf: CloudEncryptionParameters
  verifiedAt: number
  remoteFingerprint?: string
}

const STORAGE_KEY = 'mypwdmg.cloudEncryptionBindings.v1'
const MAX_SCOPE_KEY_LENGTH = 4096
const MAX_FINGERPRINT_LENGTH = 256

/**
 * Extract only the public KDF metadata from a validated vault envelope.
 * The salt is intentionally persisted as metadata; it is not a password or
 * a vault key. The ciphertext is never stored by this module.
 */
export function extractCloudEncryptionParameters(value: unknown): CloudEncryptionParameters {
  const envelope = validateEnvelope(value)
  return {
    name: envelope.kdf.name,
    iterations: envelope.kdf.iterations,
    salt: envelope.kdf.salt
  }
}

export function readCloudEncryptionBinding(scopeKey: string): CloudEncryptionBinding | null {
  const key = normalizeScopeKey(scopeKey)
  if (!key) return null
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return normalizeBinding((raw as Record<string, unknown>)[key])
  } catch {
    return null
  }
}

export function rememberCloudEncryptionBinding(
  scopeKey: string,
  envelope: unknown,
  remoteFingerprint = '',
  verifiedAt = Date.now()
): CloudEncryptionBinding | null {
  const key = normalizeScopeKey(scopeKey)
  if (!key) return null
  const normalizedVerifiedAt = Number(verifiedAt)
  if (!Number.isSafeInteger(normalizedVerifiedAt) || normalizedVerifiedAt <= 0) return null

  const binding: CloudEncryptionBinding = {
    version: 1,
    kdf: extractCloudEncryptionParameters(envelope),
    verifiedAt: normalizedVerifiedAt
  }
  const fingerprint = String(remoteFingerprint || '').trim()
  if (fingerprint && fingerprint.length <= MAX_FINGERPRINT_LENGTH) binding.remoteFingerprint = fingerprint

  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}')
    const records = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    records[key] = binding
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(records))
    return binding
  } catch {
    return null
  }
}

export function clearCloudEncryptionBinding(scopeKey: string) {
  const key = normalizeScopeKey(scopeKey)
  if (!key) return
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    delete (raw as Record<string, unknown>)[key]
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(raw))
  } catch {
    // A stale binding is only a UI hint; storage failures must not block vault use.
  }
}

export function cloudEncryptionParametersEqual(
  left: CloudEncryptionParameters | null | undefined,
  right: CloudEncryptionParameters | null | undefined
) {
  return Boolean(
    left &&
    right &&
    left.name === right.name &&
    left.iterations === right.iterations &&
    left.salt === right.salt
  )
}

function normalizeBinding(value: unknown): CloudEncryptionBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<CloudEncryptionBinding>
  const verifiedAt = Number(item.verifiedAt || 0)
  if (item.version !== 1 || !Number.isSafeInteger(verifiedAt) || verifiedAt <= 0) return null
  try {
    const kdf = extractCloudEncryptionParameters({
      format: 'mypwdmg-vault',
      version: 1,
      cipher: 'AES-256-GCM',
      kdf: item.kdf,
      nonce: 'AAAAAAAAAAAAAAAA',
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
    })
    const fingerprint = typeof item.remoteFingerprint === 'string' && item.remoteFingerprint.length <= MAX_FINGERPRINT_LENGTH
      ? item.remoteFingerprint
      : undefined
    return { version: 1, kdf, verifiedAt, ...(fingerprint ? { remoteFingerprint: fingerprint } : {}) }
  } catch {
    return null
  }
}

function normalizeScopeKey(value: string) {
  const key = String(value || '').trim()
  return key && key.length <= MAX_SCOPE_KEY_LENGTH ? key : ''
}
