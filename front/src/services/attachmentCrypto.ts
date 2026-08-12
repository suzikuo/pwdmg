import type { VaultAttachment } from '../types'

export type EncryptedAttachmentObject = {
  format: 'mypwdmg-attachment'
  version: 1
  cipher: 'AES-256-GCM'
  attachmentId: string
  nonce: string
  ciphertext: string
}

export type EncryptedAttachment = {
  reference: VaultAttachment
  objectText: string
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_CIPHERTEXT_BYTES = MAX_ATTACHMENT_BYTES + 16
export const MAX_ATTACHMENT_OBJECT_BYTES = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 + 1024
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_RE = /^[0-9a-f]{64}$/

export async function encryptAttachmentObject(
  attachmentKey: CryptoKey,
  attachmentId: string,
  bytes: Uint8Array,
  name: string,
  mimeType: string,
  createdAt = Math.floor(Date.now() / 1000)
): Promise<EncryptedAttachment> {
  const id = validateAttachmentId(attachmentId)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment is too large')
  const normalizedName = normalizeAttachmentName(name)
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType)
  const nonce = randomBytes(12)
  const plaintextSha256 = await sha256Hex(bytes)
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: attachmentAad(id) },
    attachmentKey,
    toArrayBuffer(bytes)
  ))
  const object: EncryptedAttachmentObject = {
    format: 'mypwdmg-attachment',
    version: 1,
    cipher: 'AES-256-GCM',
    attachmentId: id,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(encrypted)
  }
  const objectText = JSON.stringify(object)
  const ciphertextSha256 = await sha256Hex(new TextEncoder().encode(objectText))
  encrypted.fill(0)
  return {
    reference: {
      id,
      name: normalizedName,
      mimeType: normalizedMimeType,
      size: bytes.byteLength,
      sha256: plaintextSha256,
      ciphertextSha256,
      createdAt: normalizeTimestamp(createdAt)
    },
    objectText
  }
}

export async function decryptAttachmentObject(
  attachmentKey: CryptoKey,
  reference: VaultAttachment,
  objectText: string
): Promise<Uint8Array> {
  validateAttachmentReference(reference)
  const encoded = new TextEncoder().encode(String(objectText || ''))
  if (await sha256Hex(encoded) !== reference.ciphertextSha256) throw new Error('Attachment ciphertext hash does not match')
  const object = parseAttachmentObject(objectText, reference.id)
  const nonce = base64ToBytesBounded(object.nonce, 12)
  const ciphertext = base64ToBytesBounded(object.ciphertext, MAX_CIPHERTEXT_BYTES)
  let plaintext: Uint8Array
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: attachmentAad(reference.id) },
      attachmentKey,
      toArrayBuffer(ciphertext)
    ))
  } catch {
    throw new Error('Attachment authentication failed')
  } finally {
    ciphertext.fill(0)
  }
  if (plaintext.byteLength !== reference.size || await sha256Hex(plaintext) !== reference.sha256) {
    plaintext.fill(0)
    throw new Error('Attachment plaintext verification failed')
  }
  return plaintext
}

export async function generateAttachmentKey() {
  const raw = randomBytes(32)
  const encoded = bytesToBase64(raw)
  try {
    return { encoded, key: await importAttachmentKey(encoded) }
  } finally {
    raw.fill(0)
  }
}

export async function importAttachmentKey(encoded: string) {
  const raw = base64ToBytesBounded(encoded, 32)
  if (raw.byteLength !== 32 || bytesToBase64(raw) !== encoded) {
    raw.fill(0)
    throw new Error('Vault attachment key is invalid')
  }
  try {
    return await crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  } finally {
    raw.fill(0)
  }
}

export async function verifyAttachmentCiphertext(reference: VaultAttachment, objectText: string) {
  validateAttachmentReference(reference)
  const encoded = new TextEncoder().encode(String(objectText || ''))
  if (await sha256Hex(encoded) !== reference.ciphertextSha256) throw new Error('Attachment ciphertext hash does not match')
  validateEncryptedAttachmentObject(objectText, reference.id)
  return objectText
}

export function validateEncryptedAttachmentObject(value: string, expectedId: string): EncryptedAttachmentObject {
  const object = parseAttachmentObject(value, validateAttachmentId(expectedId))
  const nonce = base64ToBytesBounded(object.nonce, 12)
  const ciphertext = base64ToBytesBounded(object.ciphertext, MAX_CIPHERTEXT_BYTES)
  try {
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error('Attachment object is malformed')
  } finally {
    nonce.fill(0)
    ciphertext.fill(0)
  }
  return object
}

export function validateAttachmentReference(reference: VaultAttachment): VaultAttachment {
  validateAttachmentId(reference?.id)
  normalizeAttachmentName(reference?.name)
  normalizeAttachmentMimeType(reference?.mimeType)
  if (!Number.isSafeInteger(reference?.size) || reference.size < 0 || reference.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment size is invalid')
  if (!SHA256_RE.test(String(reference?.sha256 || '')) || !SHA256_RE.test(String(reference?.ciphertextSha256 || ''))) throw new Error('Attachment hash is invalid')
  normalizeTimestamp(reference?.createdAt)
  return reference
}

function parseAttachmentObject(value: string, expectedId: string): EncryptedAttachmentObject {
  let object: unknown
  try {
    object = JSON.parse(String(value || ''))
  } catch {
    throw new Error('Attachment object is malformed')
  }
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Attachment object is malformed')
  const record = object as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== ['attachmentId', 'cipher', 'ciphertext', 'format', 'nonce', 'version'].sort().join(',')) throw new Error('Attachment object is malformed')
  if (record.format !== 'mypwdmg-attachment' || record.version !== 1 || record.cipher !== 'AES-256-GCM' || record.attachmentId !== expectedId) throw new Error('Attachment object format is invalid')
  if (typeof record.nonce !== 'string' || typeof record.ciphertext !== 'string') throw new Error('Attachment object is malformed')
  return record as EncryptedAttachmentObject
}

export function validateAttachmentId(value: string) {
  const id = String(value || '').toLowerCase()
  if (!UUID_V4_RE.test(id)) throw new Error('Attachment ID is invalid')
  return id
}

function normalizeAttachmentName(value: string) {
  const name = String(value || '').replace(/\0/g, '').split(/[\\/]/).pop()?.trim() || 'attachment'
  if (name.length > 255) throw new Error('Attachment name is too long')
  return name
}

function normalizeAttachmentMimeType(value: string) {
  const mimeType = String(value || 'application/octet-stream').trim().toLowerCase() || 'application/octet-stream'
  if (mimeType.length > 127 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)) return 'application/octet-stream'
  return mimeType
}

function normalizeTimestamp(value: number) {
  const timestamp = Number(value)
  if (!Number.isSafeInteger(timestamp) || timestamp < 1) throw new Error('Attachment timestamp is invalid')
  return timestamp
}

function attachmentAad(attachmentId: string) {
  return new TextEncoder().encode(`mypwdmg-attachment-v1:${attachmentId}`)
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomBytes(size: number) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  return btoa(binary)
}

function base64ToBytesBounded(value: string, maxBytes: number) {
  const text = String(value || '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0 || text.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error('Attachment object is malformed')
  const binary = atob(text)
  if (binary.length > maxBytes) throw new Error('Attachment is too large')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
