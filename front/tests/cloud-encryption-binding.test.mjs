import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cloudEncryptionParametersEqual,
  extractCloudEncryptionParameters,
  readCloudEncryptionBinding,
  rememberCloudEncryptionBinding
} from '../src/services/cloudEncryptionBinding.ts'

const envelope = {
  format: 'mypwdmg-vault',
  version: 1,
  revision: 4,
  cipher: 'AES-256-GCM',
  kdf: {
    name: 'PBKDF2-HMAC-SHA256',
    iterations: 390000,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA=='
  },
  nonce: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
}

test('cloud encryption binding extracts only validated KDF metadata', () => {
  const parameters = extractCloudEncryptionParameters(envelope)

  assert.deepEqual(parameters, envelope.kdf)
  assert.equal(cloudEncryptionParametersEqual(parameters, envelope.kdf), true)
  assert.equal(cloudEncryptionParametersEqual(parameters, { ...parameters, salt: 'different' }), false)
})

test('cloud encryption binding persists by cloud scope without storing ciphertext', () => {
  const values = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  }

  try {
    const binding = rememberCloudEncryptionBinding('["region","bucket","vault.json"]', envelope, 'etag-1', 1700000000000)
    assert.equal(binding?.kdf.salt, envelope.kdf.salt)
    assert.equal(binding?.remoteFingerprint, 'etag-1')
    assert.deepEqual(
      readCloudEncryptionBinding('["region","bucket","vault.json"]'),
      binding
    )
    assert.doesNotMatch(values.get('mypwdmg.cloudEncryptionBindings.v1'), /ciphertext/)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

