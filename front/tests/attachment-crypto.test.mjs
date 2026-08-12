import assert from 'node:assert/strict'
import test from 'node:test'

import { decryptAttachmentObject, encryptAttachmentObject, generateAttachmentKey, importAttachmentKey, MAX_ATTACHMENT_BYTES, validateEncryptedAttachmentObject } from '../src/services/attachmentCrypto.ts'
import { decryptPayload, encryptPayload } from '../src/services/vaultCrypto.ts'
import { defaultVaultPayload, normalizeVaultPayload } from '../src/services/vaultDefaults.ts'

const attachmentId = '123e4567-e89b-42d3-a456-426614174000'

async function key() {
  return generateAttachmentKey()
}

test('attachment objects round trip and authenticate ID, ciphertext, size, and plaintext hash', async () => {
  const { key: attachmentKey } = await key()
  const bytes = new TextEncoder().encode('recovery code: alpha-beta')
  const encrypted = await encryptAttachmentObject(attachmentKey, attachmentId, bytes, 'codes.txt', 'text/plain', 100)
  assert.equal(encrypted.reference.size, bytes.byteLength)
  assert.equal(encrypted.reference.name, 'codes.txt')
  assert.deepEqual(await decryptAttachmentObject(attachmentKey, encrypted.reference, encrypted.objectText), bytes)

  const wrongSize = { ...encrypted.reference, size: encrypted.reference.size + 1 }
  await assert.rejects(() => decryptAttachmentObject(attachmentKey, wrongSize, encrypted.objectText), /plaintext verification/i)
  const tampered = encrypted.objectText.replace('ciphertext":"', 'ciphertext":"A')
  await assert.rejects(() => decryptAttachmentObject(attachmentKey, encrypted.reference, tampered), /ciphertext hash/i)
})

test('attachment input and references are bounded and strictly normalized', async () => {
  const { encoded, key: attachmentKey } = await key()
  await assert.rejects(() => encryptAttachmentObject(attachmentKey, 'bad-id', new Uint8Array(), 'x', 'text/plain'))
  await assert.rejects(() => encryptAttachmentObject(attachmentKey, attachmentId, new Uint8Array(MAX_ATTACHMENT_BYTES + 1), 'x', 'text/plain'))

  const normalized = normalizeVaultPayload({
    ...defaultVaultPayload(),
    attachmentKey: encoded,
    entries: [{
      id: 'entry-1', kind: 'secure-note', title: 'Recovery', domains: [],
      attachments: [{
        id: attachmentId,
        name: 'codes.txt',
        mimeType: 'text/plain',
        size: 10,
        sha256: 'a'.repeat(64),
        ciphertextSha256: 'b'.repeat(64),
        createdAt: 100
      }]
    }]
  })
  assert.equal(normalized.entries[0].attachments?.[0].id, attachmentId)
  assert.throws(() => normalizeVaultPayload({
    ...defaultVaultPayload(),
    entries: normalized.entries
  }), /key is missing/i)
  assert.throws(() => normalizeVaultPayload({
    ...defaultVaultPayload(),
    entries: [{ id: 'entry-1', kind: 'secure-note', title: 'Bad', domains: [], attachments: [{ id: 'bad' }] }]
  }), /attachment/i)
})

test('attachment object validation rejects malformed base64 before storage', async () => {
  const { key: attachmentKey } = await key()
  const encrypted = await encryptAttachmentObject(
    attachmentKey,
    attachmentId,
    new TextEncoder().encode('bounded object'),
    'object.txt',
    'text/plain',
    100
  )
  const object = JSON.parse(encrypted.objectText)
  object.nonce = 'not-base64!'
  assert.throws(() => validateEncryptedAttachmentObject(JSON.stringify(object), attachmentId), /malformed/i)
})

test('attachment data key survives master-password rotation inside the encrypted vault', async () => {
  const generated = await generateAttachmentKey()
  const bytes = new TextEncoder().encode('certificate bytes')
  const encrypted = await encryptAttachmentObject(generated.key, attachmentId, bytes, 'cert.bin', 'application/octet-stream', 100)
  const payload = { ...defaultVaultPayload(), attachmentKey: generated.encoded }
  const oldEnvelope = await encryptPayload('old-password', payload)
  const unlocked = await decryptPayload('old-password', oldEnvelope.envelope)
  const newEnvelope = await encryptPayload('new-password', unlocked.payload)
  const rotated = await decryptPayload('new-password', newEnvelope.envelope)
  const restoredKey = await importAttachmentKey(rotated.payload.attachmentKey)
  assert.deepEqual(await decryptAttachmentObject(restoredKey, encrypted.reference, encrypted.objectText), bytes)
})
