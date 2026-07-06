import type { VaultPayload } from '../types'

export type VaultEnvelope = {
  format: 'mypwdmg-vault'
  version: 1
  cipher: 'AES-256-GCM'
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

const AAD = new TextEncoder().encode('mypwdmg-vault-v1')
const DEFAULT_ITERATIONS = 390_000

export async function encryptPayload(password: string, payload: VaultPayload) {
  const salt = randomBytes(16)
  const key = await deriveVaultKey(password, salt, DEFAULT_ITERATIONS)
  const vaultKey = { key, salt, iterations: DEFAULT_ITERATIONS }
  return {
    envelope: await encryptPayloadWithKey(vaultKey, payload),
    vaultKey
  }
}

export async function encryptPayloadWithKey(vaultKey: VaultKey, payload: VaultPayload): Promise<VaultEnvelope> {
  const nonce = randomBytes(12)
  const raw = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(AAD) },
    vaultKey.key,
    toArrayBuffer(raw)
  )

  return {
    format: 'mypwdmg-vault',
    version: 1,
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
      additionalData: toArrayBuffer(AAD)
    },
    vaultKey.key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext))
  )
  return JSON.parse(new TextDecoder().decode(decrypted)) as VaultPayload
}

export function validateEnvelope(value: unknown): VaultEnvelope {
  const envelope = value as VaultEnvelope
  if (
    !envelope ||
    envelope.format !== 'mypwdmg-vault' ||
    envelope.version !== 1 ||
    envelope.cipher !== 'AES-256-GCM' ||
    envelope.kdf?.name !== 'PBKDF2-HMAC-SHA256' ||
    !Number.isFinite(Number(envelope.kdf?.iterations)) ||
    !envelope.kdf?.salt ||
    !envelope.nonce ||
    !envelope.ciphertext
  ) {
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

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
