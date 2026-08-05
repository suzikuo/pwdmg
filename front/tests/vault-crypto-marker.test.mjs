import assert from 'node:assert/strict'
import test from 'node:test'

import { setEnvelopePasswordless } from '../src/services/vaultCrypto.ts'

function envelope() {
  return {
    format: 'mypwdmg-vault',
    version: 1,
    revision: 1,
    cipher: 'AES-256-GCM',
    kdf: { name: 'PBKDF2-HMAC-SHA256', iterations: 390000, salt: 'AA==' },
    nonce: 'AA==',
    ciphertext: 'AA=='
  }
}

test('schema rewrites preserve the actual passwordless mode', () => {
  const protectedEnvelope = setEnvelopePasswordless(envelope(), false)
  assert.equal(protectedEnvelope.passwordless, false)

  const passwordlessEnvelope = setEnvelopePasswordless(envelope(), true)
  assert.equal(passwordlessEnvelope.passwordless, true)
})
