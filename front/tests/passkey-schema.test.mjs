import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePasskeyState } from '../src/services/passkeySchema.ts'
import { defaultVaultPayload, normalizeVaultPayload } from '../src/services/vaultDefaults.ts'
import {
  decryptPayload,
  decryptPayloadWithKey,
  encryptPayload,
  encryptPayloadWithKey,
  validateEnvelope
} from '../src/services/vaultCrypto.ts'

function passkey(overrides = {}) {
  return {
    id: 'passkey-1',
    credentialId: 'AQIDBA',
    rpId: 'Login.Example.com.',
    rpName: 'Example',
    userHandle: 'dXNlci0x',
    userName: 'alice@example.com',
    userDisplayName: 'Alice',
    algorithm: -7,
    publicKeyCose: 'cHVibGljLWtleQ',
    privateKeyPkcs8: 'cHJpdmF0ZS1rZXk',
    discoverable: true,
    backupEligible: true,
    backupState: true,
    transports: ['internal', 'hybrid', 'internal'],
    entryId: 'login-1',
    createdAt: 100,
    updatedAt: 101,
    ...overrides
  }
}

test('legacy empty vaults remain v1 while passkey state promotes v2', () => {
  const legacy = normalizeVaultPayload(defaultVaultPayload())
  assert.equal(legacy.version, 1)
  assert.deepEqual(legacy.passkeys, [])
  assert.deepEqual(legacy.passkeyTombstones, [])

  const promoted = normalizeVaultPayload({
    ...defaultVaultPayload(),
    passkeys: [passkey()]
  })
  assert.equal(promoted.version, 2)
  assert.equal(promoted.passkeySchemaVersion, 1)
  assert.equal(promoted.passkeys[0].rpId, 'login.example.com')
  assert.deepEqual(promoted.passkeys[0].transports, ['internal', 'hybrid'])

  const sticky = normalizeVaultPayload({ ...defaultVaultPayload(), version: 2 })
  assert.equal(sticky.version, 2)
})

test('optional user labels are normalized without changing schema version', () => {
  const normalized = normalizePasskeyState({ passkeys: [passkey({ label: '  Work key  ' })] })
  assert.equal(normalized.passkeySchemaVersion, 1)
  assert.equal(normalized.passkeys[0].label, 'Work key')
})

test('normalization rejects unsupported versions and lossy passkey repairs', () => {
  assert.throws(() => normalizePasskeyState({ version: 3 }), /version/i)
  assert.throws(() => normalizePasskeyState({ version: '2' }), /version/i)
  assert.throws(() => normalizePasskeyState({ version: 2, passkeySchemaVersion: 2, passkeys: [], passkeyTombstones: [] }), /schema version/i)
  assert.throws(() => normalizePasskeyState({ version: 2, passkeyTombstones: [] }), /requires passkeys/i)
  assert.throws(() => normalizePasskeyState({ version: 2, passkeys: undefined, passkeyTombstones: [] }), /requires passkeys/i)
  assert.throws(() => normalizePasskeyState({ passkeys: {} }), /array/i)
  assert.throws(() => normalizePasskeyState({ passkeys: Array(10_001).fill(null) }), /item limit/i)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey(), passkey({ credentialId: 'BQYHCA' })]
  }), /Duplicate passkey id/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey(), passkey({ id: 'passkey-2' })]
  }), /Duplicate passkey credentialId/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ privateKeyPkcs8: 'not+base64' })]
  }), /base64url/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ credentialId: 'AB' })]
  }), /canonical/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ backupEligible: false, backupState: true })]
  }), /backupEligible/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ algorithm: '-7' })]
  }), /algorithm/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ algorithm: -257 })]
  }), /ES256/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ futureExtension: true })]
  }), /unsupported fields/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ updatedAt: '101' })]
  }), /updatedAt/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey({ userName: '😀'.repeat(129) })]
  }), /userName/)
})

test('live credentials and tombstones cannot overlap', () => {
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey()],
    passkeyTombstones: [{ id: 'passkey-1', credentialId: 'AQIDBA', deletedAt: 200 }]
  }), /live and deleted/)
  assert.throws(() => normalizePasskeyState({
    passkeys: [passkey()],
    passkeyTombstones: [{ id: 'passkey-2', credentialId: 'AQIDBA', deletedAt: 200 }]
  }), /credential.*live and deleted/)
})

test('v1 and v2 envelopes use distinct authenticated versions', async () => {
  const legacyPayload = defaultVaultPayload()
  const legacy = await encryptPayload('password123', legacyPayload)
  assert.equal(legacy.envelope.version, 1)
  assert.equal((await decryptPayload('password123', legacy.envelope)).payload.version, 1)

  const passkeyPayload = normalizeVaultPayload({
    ...defaultVaultPayload(),
    passkeys: [passkey()]
  })
  const current = await encryptPayload('password123', passkeyPayload)
  assert.equal(current.envelope.version, 2)
  assert.equal(validateEnvelope(current.envelope).version, 2)
  assert.deepEqual((await decryptPayload('password123', current.envelope)).payload.passkeys, passkeyPayload.passkeys)

  const downgraded = { ...current.envelope, version: 1 }
  await assert.rejects(() => decryptPayload('password123', downgraded))

  await assert.rejects(
    () => encryptPayload('password123', { ...legacyPayload, version: '2' }),
    /payload version/i
  )

  await assert.rejects(
    () => encryptPayload('password123', { ...legacyPayload, passkeys: [passkey()] }),
    /version 1/i
  )

  const mismatchPayload = { ...passkeyPayload, version: 1 }
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const mismatchCiphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: new TextEncoder().encode('mypwdmg-vault-v2')
    },
    current.vaultKey.key,
    new TextEncoder().encode(JSON.stringify(mismatchPayload))
  )
  const mismatched = {
    ...current.envelope,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(mismatchCiphertext))
  }
  await assert.rejects(
    () => decryptPayloadWithKey(current.vaultKey, mismatched),
    /version metadata/i
  )
})

test('frontend encryption rejects payloads that exceed its own decryption bound', async () => {
  const legacy = await encryptPayload('password123', defaultVaultPayload())
  const oversized = defaultVaultPayload()
  oversized.settings.oss.accessKeySecret = 'x'.repeat(16 * 1024 * 1024)
  await assert.rejects(() => encryptPayloadWithKey(legacy.vaultKey, oversized), /too large/i)
})

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  }
  return btoa(binary)
}
