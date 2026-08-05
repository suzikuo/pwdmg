import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { RemoteVaultStatus } from '../src/services/cloud/remoteVaultStore.ts'
import { validateLegacyRemoteObjectRevision } from '../src/services/sync/legacyRemoteValidation.ts'

function storeReturning(response, onRead = () => {}) {
  return {
    readObject: async (objectName) => {
      onRead(objectName)
      return response
    }
  }
}

test('accepts an unchanged existing remote object by its content revision', async () => {
  const result = await validateLegacyRemoteObjectRevision(
    storeReturning({
      status: RemoteVaultStatus.Success,
      content: '{"version":1}',
      revision: 'expected-revision'
    }),
    'vault.json',
    'expected-revision',
    true
  )

  assert.deepEqual(result, { ok: true, message: '' })
})

test('rejects a remote object changed after preview', async () => {
  const result = await validateLegacyRemoteObjectRevision(
    storeReturning({
      status: RemoteVaultStatus.Success,
      content: '{"version":2}',
      revision: 'new-revision'
    }),
    'vault.json',
    'old-revision',
    true
  )

  assert.deepEqual(result, {
    ok: false,
    message: '云端保险库在确认期间已变化，请重新检测同步差异'
  })
})

test('rejects a remote object created after a missing-object preview', async () => {
  const result = await validateLegacyRemoteObjectRevision(
    storeReturning({
      status: RemoteVaultStatus.Success,
      content: '{"version":1}',
      revision: 'created-revision'
    }),
    'vault.json',
    'missing',
    false
  )

  assert.deepEqual(result, {
    ok: false,
    message: '云端文件在确认期间已创建，请重新检测同步差异'
  })
})

test('accepts a remote object that remains missing after preview', async () => {
  const result = await validateLegacyRemoteObjectRevision(
    storeReturning({ status: RemoteVaultStatus.NotFound, content: '文件未找到' }),
    'vault.json',
    'missing',
    false
  )

  assert.deepEqual(result, { ok: true, message: '' })
})

test('falls back to a SHA-256 fingerprint when the provider omits a revision', async () => {
  const content = '{"version":1,"entries":[]}'
  const expectedFingerprint = createHash('sha256').update(content).digest('hex')

  const result = await validateLegacyRemoteObjectRevision(
    storeReturning({ status: RemoteVaultStatus.Success, content }),
    'vault.json',
    expectedFingerprint,
    true
  )

  assert.deepEqual(result, { ok: true, message: '' })
})

test('characterizes transient remote read failures as a single attempt without retry', async () => {
  let readCount = 0
  const result = await validateLegacyRemoteObjectRevision(
    storeReturning(
      { status: RemoteVaultStatus.Error, content: 'temporary network failure' },
      () => { readCount += 1 }
    ),
    'vault.json',
    'expected-revision',
    true
  )

  assert.equal(readCount, 1)
  assert.deepEqual(result, { ok: false, message: 'temporary network failure' })
})
