import type { VaultPayload } from '../types'

export type VaultEnvelope = {
  format: 'mypwdmg-vault'
  version: 1 | 2
  revision?: number
  cipher: 'AES-256-GCM'
  passwordless?: boolean
  kdf: {
    name: 'PBKDF2-HMAC-SHA256'
    iterations: number
    salt: string
  }
  nonce: string
  ciphertext: string
}

export type VaultKey = {
  key: CryptoKey
  salt: Uint8Array
  iterations: number
}

const AAD_BY_VERSION = {
  1: new TextEncoder().encode('mypwdmg-vault-v1'),
  2: new TextEncoder().encode('mypwdmg-vault-v2')
} as const
const DEFAULT_ITERATIONS = 390_000
const MIN_ITERATIONS = 10_000
const MAX_ITERATIONS = 2_000_000
const SALT_BYTES = 16
const NONCE_BYTES = 12
const MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024 + 16
const MAX_PLAINTEXT_BYTES = MAX_CIPHERTEXT_BYTES - 16

export async function encryptPayload(password: string, payload: VaultPayload) {
  const salt = randomBytes(16)
  const key = await deriveVaultKey(password, salt, DEFAULT_ITERATIONS)
  const vaultKey = { key, salt, iterations: DEFAULT_ITERATIONS }
  const envelope = await encryptPayloadWithKey(vaultKey, payload)
  setEnvelopePasswordless(envelope, (password || '') === '')
  return {
    envelope,
    vaultKey
  }
}

export function setEnvelopePasswordless(envelope: VaultEnvelope, passwordless: boolean): VaultEnvelope {
  envelope.passwordless = passwordless === true
  return envelope
}

export async function encryptPayloadWithKey(vaultKey: VaultKey, payload: VaultPayload): Promise<VaultEnvelope> {
  const nonce = randomBytes(12)
  const version = readPayloadVersionForEncryption(payload)
  const raw = new TextEncoder().encode(JSON.stringify(payload))
  if (raw.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('Vault payload is too large')
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(AAD_BY_VERSION[version]) },
    vaultKey.key,
    toArrayBuffer(raw)
  )

  return {
    format: 'mypwdmg-vault',
    version,
    revision: Math.max(1, Math.floor(Number(payload.revision || 1))),
    cipher: 'AES-256-GCM',
    kdf: {
      name: 'PBKDF2-HMAC-SHA256',
      iterations: vaultKey.iterations,
      salt: bytesToBase64(vaultKey.salt)
    },
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  }
}

export async function decryptPayload(password: string, envelope: VaultEnvelope) {
  validateEnvelope(envelope)
  const salt = base64ToBytes(envelope.kdf.salt)
  const iterations = Number(envelope.kdf.iterations)
  const key = await deriveVaultKey(password, salt, iterations)
  const payload = await decryptPayloadWithKey({ key, salt, iterations }, envelope)
  return {
    payload,
    vaultKey: { key, salt, iterations }
  }
}

export async function decryptPayloadWithKey(vaultKey: VaultKey, envelope: VaultEnvelope): Promise<VaultPayload> {
  validateEnvelope(envelope)
  const salt = base64ToBytes(envelope.kdf.salt)
  const iterations = Number(envelope.kdf.iterations)
  if (iterations !== vaultKey.iterations || !sameBytes(salt, vaultKey.salt)) {
    throw new Error('Vault password changed; unlock again')
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(envelope.nonce)),
      additionalData: toArrayBuffer(AAD_BY_VERSION[envelope.version])
    },
    vaultKey.key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext))
  )
  const payload = JSON.parse(new TextDecoder().decode(decrypted)) as VaultPayload
  assertEnvelopePayloadVersion(envelope, payload)
  assertEnvelopeRevision(envelope, payload)
  return payload
}

export async function importVaultKeyMaterial(
  rawKeyBase64: string,
  saltBase64: string,
  iterations: number
): Promise<VaultKey> {
  assertWebCrypto()
  const rawKey = base64ToBytes(rawKeyBase64)
  const salt = base64ToBytes(saltBase64)
  if (rawKey.byteLength !== 32 || salt.byteLength !== 16) throw new Error('设备解锁密钥无效')
  if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    throw new Error('设备解锁参数无效')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
  rawKey.fill(0)
  return { key, salt, iterations }
}

export function validateEnvelope(value: unknown): VaultEnvelope {
  const envelope = value as VaultEnvelope
  const iterations = Number(envelope?.kdf?.iterations)
  const revision = envelope?.revision === undefined ? 1 : Number(envelope.revision)
  if (
    !envelope ||
    envelope.format !== 'mypwdmg-vault' ||
    (envelope.version !== 1 && envelope.version !== 2) ||
    envelope.cipher !== 'AES-256-GCM' ||
    envelope.kdf?.name !== 'PBKDF2-HMAC-SHA256' ||
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !envelope.kdf?.salt ||
    !envelope.nonce ||
    !envelope.ciphertext
  ) {
    throw new Error('Vault file is malformed')
  }
  const salt = decodeBase64Bounded(envelope.kdf.salt, SALT_BYTES)
  const nonce = decodeBase64Bounded(envelope.nonce, NONCE_BYTES)
  const ciphertext = decodeBase64Bounded(envelope.ciphertext, MAX_CIPHERTEXT_BYTES)
  if (salt.byteLength !== SALT_BYTES || nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) {
    throw new Error('Vault file is malformed')
  }
  return envelope
}

async function deriveVaultKey(password: string, salt: Uint8Array, iterations: number) {
  assertWebCrypto()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(password || '')),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function assertWebCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('当前 WebView 不支持 WebCrypto，无法使用纯前端加密保险库')
  }
}

function randomBytes(size: number) {
  assertWebCrypto()
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function decodeBase64Bounded(value: string, maxBytes: number) {
  const text = String(value || '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new Error('Vault file is malformed')
  }
  if (text.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error('Vault file is too large')
  try {
    const bytes = base64ToBytes(text)
    if (bytes.byteLength > maxBytes) throw new Error('Vault file is too large')
    return bytes
  } catch (error) {
    if (error instanceof Error && error.message === 'Vault file is too large') throw error
    throw new Error('Vault file is malformed')
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

function assertEnvelopeRevision(envelope: VaultEnvelope, payload: VaultPayload) {
  if (envelope.revision === undefined) return
  const payloadRevision = Math.max(1, Math.floor(Number(payload?.revision || 1)))
  if (payloadRevision !== envelope.revision) throw new Error('Vault revision metadata does not match its payload')
}

function assertEnvelopePayloadVersion(envelope: VaultEnvelope, payload: VaultPayload) {
  if (readDeclaredPayloadVersion(payload) !== envelope.version) {
    throw new Error('Vault version metadata does not match its payload')
  }
  if (envelope.version === 2) requirePasskeyCollections(payload)
}

function readDeclaredPayloadVersion(payload: Pick<VaultPayload, 'version'>): 1 | 2 {
  const version: unknown = payload?.version ?? 1
  if (version !== 1 && version !== 2) throw new Error('Unsupported vault payload version')
  return version
}

function readPayloadVersionForEncryption(payload: VaultPayload): 1 | 2 {
  const version = readDeclaredPayloadVersion(payload)
  const collections = requirePasskeyCollections(payload, version === 2)
  if (version === 1 && collections.some((collection) => collection.length > 0)) {
    throw new Error('Vault payload version 1 cannot contain passkey state')
  }
  if (version === 2 && payload.passkeySchemaVersion !== 1) {
    throw new Error('Vault payload version 2 requires passkeySchemaVersion 1')
  }
  return version
}

function requirePasskeyCollections(payload: VaultPayload, required = true): unknown[][] {
  const value = payload as unknown as Record<string, unknown>
  return ['passkeys', 'passkeyTombstones'].map((field) => {
    if (required && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Vault payload version 2 requires ${field}`)
    }
    const collection = value[field]
    if (collection === undefined && !required) return []
    if (!Array.isArray(collection)) throw new Error(`Vault ${field} must be an array`)
    return collection
  })
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
