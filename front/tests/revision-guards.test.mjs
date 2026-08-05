import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readPersistedRevision,
  requireCurrentRevision,
  requireNextRevision
} from '../src/services/revisionGuards.ts'

test('normal saves require a matching current revision and exactly one-step advance', () => {
  const current = requireCurrentRevision({ revision: 7 }, true, 7)
  assert.equal(requireNextRevision({ revision: 8 }, current), 8)
  assert.throws(() => requireCurrentRevision({ revision: 8 }, true, 7), /conflict/)
  assert.throws(() => requireNextRevision({ revision: 9 }, current), /exactly one/)
})

test('backup replacement checks the current revision without constraining backup revision', () => {
  assert.equal(requireCurrentRevision({ revision: 7 }, true, 7), 7)
  assert.equal(readPersistedRevision({ revision: 2 }), 2)
})

test('missing and malformed persisted revisions fail closed', () => {
  assert.equal(readPersistedRevision(null, false), 0)
  assert.throws(() => readPersistedRevision({ revision: 0 }), /invalid/)
  assert.throws(() => readPersistedRevision({ revision: Number.NaN }), /invalid/)
})
