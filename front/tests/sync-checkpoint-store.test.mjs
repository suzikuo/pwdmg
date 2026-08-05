import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSyncCheckpoint } from '../src/services/sync/syncCheckpointStore.ts'

test('normalizes encrypted sync checkpoint metadata without exposing payload fields', () => {
  const normalized = normalizeSyncCheckpoint({
    key: 'bucket/vault',
    envelope: '{"ciphertext":"encrypted"}',
    payloadFingerprint: 'A'.repeat(64),
    remoteHeadIds: ['head-b', 'head-a', 'head-a'],
    recordedAt: 123
  })
  assert.deepEqual(normalized, {
    key: 'bucket/vault',
    envelope: '{"ciphertext":"encrypted"}',
    payloadFingerprint: 'a'.repeat(64),
    remoteHeadIds: ['head-a', 'head-b'],
    recordedAt: 123
  })
})

test('rejects malformed or oversized checkpoint records', () => {
  assert.equal(normalizeSyncCheckpoint(null), null)
  assert.equal(normalizeSyncCheckpoint({ key: 'x', envelope: '{}', payloadFingerprint: 'bad', remoteHeadIds: [], recordedAt: 1 }), null)
  assert.equal(normalizeSyncCheckpoint({ key: 'x', envelope: '{}', payloadFingerprint: 'a'.repeat(64), remoteHeadIds: 'head', recordedAt: 1 }), null)
  assert.equal(normalizeSyncCheckpoint({ key: 'x', envelope: 'x'.repeat(24 * 1024 * 1024 + 1), payloadFingerprint: 'a'.repeat(64), remoteHeadIds: [], recordedAt: 1 }), null)
})
