import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PasskeyOperationError,
  bindNativePasskeyOperation,
  createCancelledPasskeyOperationOutcome,
  createSucceededPasskeyOperationOutcome,
  isPasskeyOperationExpired,
  parsePasskeyOperation,
  toPasskeyOperationDiagnostic
} from '../src/services/passkeyOperation.ts'

const vectors = JSON.parse(readFileSync(
  new URL('../../test-vectors/passkey-operation-contract.json', import.meta.url),
  'utf8'
))

for (const vector of vectors.valid) {
  test(`normalizes shared passkey operation vector: ${vector.name}`, () => {
    const operation = parsePasskeyOperation(vector.kind, vectorInput(vector))
    assert.equal(operation.origin, vector.expect.origin)
    assert.equal(operation.rpId, vector.expect.rpId)
    assert.equal(operation.challenge, vector.expect.challenge)
    assert.equal(operation.timeoutMs, vector.expect.timeoutMs)
    assert.deepEqual(operation.credentialIds, vector.expect.credentialIds)
    assert.equal(operation.requiresUserVerification, vector.expect.requiresUserVerification)
    if (operation.kind === 'create') {
      assert.equal(operation.rpName, vector.expect.rpName)
      assert.equal(operation.user.name, vector.expect.userName)
      assert.equal(operation.algorithm, -7)
      assert.equal(operation.discoverable, vector.expect.discoverable)
    }
  })
}

for (const vector of vectors.invalid) {
  test(`rejects shared passkey operation vector: ${vector.name}`, () => {
    assert.throws(
      () => parsePasskeyOperation(vector.kind, vectorInput(vector)),
      (error) => error instanceof PasskeyOperationError && error.code === vector.errorCode
    )
  })
}

test('native operation ticket expiry and diagnostic projection keep ceremony data out of diagnostics', () => {
  const operation = parsePasskeyOperation('get', vectorInput(vectors.valid[1]))
  const ticket = bindNativePasskeyOperation(
    operation,
    'AAECAwQFBgcICQoLDA0ODw',
    1_000_000
  )
  assert.equal(ticket.expiresAt, 1_015_000)
  assert.equal(isPasskeyOperationExpired(ticket, 1_014_999), false)
  assert.equal(isPasskeyOperationExpired(ticket, 1_015_000), true)

  const cancelled = toPasskeyOperationDiagnostic(createCancelledPasskeyOperationOutcome(ticket))
  assert.deepEqual(cancelled, { kind: 'get', status: 'cancelled', code: 'CANCELLED' })

  const successful = toPasskeyOperationDiagnostic(createSucceededPasskeyOperationOutcome(
    ticket,
    '{"id":"AQIDBA","response":{"userHandle":"dXNlci0x"}}'
  ))
  assert.deepEqual(successful, { kind: 'get', status: 'succeeded', code: 'SUCCESS' })
  assert.doesNotMatch(JSON.stringify(successful), /AQIDBA|dXNlci0x|AAECAwQF/)
})

function vectorInput(vector) {
  return {
    requestJson: vector.requestJson || JSON.stringify(vector.request),
    trustedOrigin: vector.origin,
    clientDataHash: vector.clientDataHash
  }
}
