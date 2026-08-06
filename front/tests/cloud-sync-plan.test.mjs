import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'
import {
  createCloudSyncPlan,
  hasLocalCloudChanges
} from '../src/services/sync/cloudSyncPlan.ts'

const fingerprint = async (payload) => JSON.stringify({
  version: payload.version,
  passkeySchemaVersion: payload.passkeySchemaVersion,
  entries: payload.entries,
  passkeys: payload.passkeys,
  passkeyTombstones: payload.passkeyTombstones
})

test('keeps a direct local addition on the upload path', async () => {
  const remote = payload([])
  const local = payload([login('local')])

  const result = await createCloudSyncPlan({
    requestedDirection: 'upload',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: null,
    fingerprint
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan.direction, 'upload')
  assert.deepEqual(result.plan.items.map((item) => [item.id, item.changeType]), [['local', 'added']])
  assert.equal(result.plan.targetNeedsWrite, true)
})

test('upload requires pull when the remote advanced after the checkpoint', async () => {
  const ancestor = payload([])
  const local = payload([login('local')])
  const remote = payload([login('remote')])

  const result = await createCloudSyncPlan({
    requestedDirection: 'upload',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    fingerprint
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'pull-required')
  assert.match(result.message, /先下载校验/)
})

test('automatic download integrates independent remote additions without removing local-only work', async () => {
  const ancestor = payload([])
  const local = payload([login('local')])
  const remote = payload([login('remote')])

  const result = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    pullStrategy: 'integrate',
    fingerprint
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan.direction, 'download')
  assert.equal(result.plan.localChangedSinceBase, true)
  assert.equal(result.plan.remoteChangedSinceBase, true)
  assert.equal(result.plan.targetNeedsWrite, true)
  assert.deepEqual(result.plan.items.map((item) => [item.id, item.changeType]), [['remote', 'added']])
})

test('manual download can restore a remote item missing locally while upload can propose its deletion', async () => {
  const ancestor = payload([login('removed-locally')])
  const local = payload([])
  const remote = payload([login('removed-locally')])

  const download = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    fingerprint
  })
  assert.equal(download.ok, true)
  assert.equal(download.plan.direction, 'download')
  assert.equal(download.plan.targetNeedsWrite, true)
  assert.deepEqual(download.plan.items.map((item) => [item.id, item.changeType, item.checked]), [
    ['removed-locally', 'added', true]
  ])

  const upload = await createCloudSyncPlan({
    requestedDirection: 'upload',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    fingerprint
  })
  assert.equal(upload.ok, true)
  assert.equal(upload.plan.direction, 'upload')
  assert.equal(upload.plan.targetNeedsWrite, true)
  assert.deepEqual(upload.plan.items.map((item) => [item.id, item.changeType, item.checked]), [
    ['removed-locally', 'deleted', false]
  ])
})

test('automatic download preserves a local-only deletion for a later explicit upload decision', async () => {
  const ancestor = payload([login('removed-locally')])
  const local = payload([])
  const remote = payload([login('removed-locally')])

  const result = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    pullStrategy: 'integrate',
    fingerprint
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan.direction, 'download')
  assert.equal(result.plan.targetNeedsWrite, false)
  assert.deepEqual(result.plan.items, [])
})

test('passkey schema differences obey the requested direction without no-op uploads', async () => {
  const v1 = payload([])
  const v2 = {
    ...payload([]),
    version: 2,
    passkeySchemaVersion: 1,
    passkeys: [],
    passkeyTombstones: []
  }

  const downloadV2 = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: v1,
    remotePayload: v2,
    ancestorPayload: null,
    fingerprint
  })
  assert.equal(downloadV2.ok, true)
  assert.equal(downloadV2.plan.direction, 'download')
  assert.equal(downloadV2.plan.targetNeedsWrite, true)

  const uploadV1 = await createCloudSyncPlan({
    requestedDirection: 'upload',
    localPayload: v1,
    remotePayload: v2,
    ancestorPayload: null,
    fingerprint
  })
  assert.equal(uploadV1.ok, true)
  assert.equal(uploadV1.plan.direction, 'upload')
  assert.equal(uploadV1.plan.targetNeedsWrite, false)

  const downloadV1 = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: v2,
    remotePayload: v1,
    ancestorPayload: null,
    fingerprint
  })
  assert.equal(downloadV1.ok, true)
  assert.equal(downloadV1.plan.direction, 'download')
  assert.equal(downloadV1.plan.targetNeedsWrite, false)

  const uploadV2 = await createCloudSyncPlan({
    requestedDirection: 'upload',
    localPayload: v2,
    remotePayload: v1,
    ancestorPayload: null,
    fingerprint
  })
  assert.equal(uploadV2.ok, true)
  assert.equal(uploadV2.plan.direction, 'upload')
  assert.equal(uploadV2.plan.targetNeedsWrite, true)
})

test('fails closed on an incompatible concurrent reorder', async () => {
  const ancestor = payload([login('a'), login('b'), login('c')])
  const local = payload([login('b'), login('a'), login('c')])
  const remote = payload([login('a'), login('c'), login('b')])

  const result = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: ancestor,
    pullStrategy: 'integrate',
    fingerprint
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /三方冲突/)
})

test('does not treat timestamp-only local persistence as an upload change', () => {
  assert.equal(hasLocalCloudChanges({
    localFingerprint: 'same-content',
    remoteFingerprint: 'same-content',
    checkpointLocalFingerprint: 'same-content',
    localUpdatedAt: 200,
    remoteUpdatedAt: 100
  }), false)
})

test('uses the checkpoint fingerprint instead of timestamps when deciding local changes', () => {
  assert.equal(hasLocalCloudChanges({
    localFingerprint: 'checkpoint',
    remoteFingerprint: 'remote-change',
    checkpointLocalFingerprint: 'checkpoint',
    localUpdatedAt: 200,
    remoteUpdatedAt: 100
  }), false)
  assert.equal(hasLocalCloudChanges({
    localFingerprint: 'local-change',
    remoteFingerprint: 'remote-change',
    checkpointLocalFingerprint: 'checkpoint',
    localUpdatedAt: 100,
    remoteUpdatedAt: 200
  }), true)
})

function payload(entries) {
  return { ...defaultVaultPayload(), entries }
}

function login(id, title = id) {
  return {
    id,
    kind: 'login',
    title,
    status: 'active',
    statusReason: '',
    statusUpdatedAt: 0,
    deletedAt: 0,
    domains: [],
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    history: [],
    children: []
  }
}
