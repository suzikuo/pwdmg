import assert from 'node:assert/strict'
import test from 'node:test'

import { encryptAttachmentObject, generateAttachmentKey } from '../src/services/attachmentCrypto.ts'
import { attachmentRemoteObjectName, ensureLocalAttachmentObjects, ensureRemoteAttachmentObjects } from '../src/services/sync/attachmentObjectSync.ts'
import { buildCloudSyncDiff } from '../src/services/sync/legacyDiff.ts'
import { mergeVaultPayloads } from '../src/services/sync/threeWayVaultMerge.ts'
import { createCloudSyncPlan } from '../src/services/sync/cloudSyncPlan.ts'
import { RemoteVaultStatus } from '../src/services/cloud/remoteVaultStore.ts'
import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'

const id = '123e4567-e89b-42d3-a456-426614174000'

async function fixture() {
  const generated = await generateAttachmentKey()
  const encrypted = await encryptAttachmentObject(generated.key, id, new TextEncoder().encode('secret'), 'secret.txt', 'text/plain', 100)
  const payload = { ...defaultVaultPayload([{ id: 'entry-1', kind: 'secure-note', title: 'Note', domains: [], attachments: [encrypted.reference] }]), attachmentKey: generated.encoded }
  return { encrypted, payload }
}

function fakeRemote() {
  const objects = new Map()
  return {
    objects,
    readObject: async (name) => objects.has(name)
      ? { status: RemoteVaultStatus.Success, content: objects.get(name) }
      : { status: RemoteVaultStatus.NotFound, content: 'missing' },
    writeObject: async (name, content, _type, options = {}) => {
      if (options.forbidOverwrite && objects.has(name)) return { status: RemoteVaultStatus.Conflict, content: 'exists' }
      objects.set(name, content)
      return { status: RemoteVaultStatus.Success, content: 'ok' }
    },
    getObjectInfo: async () => ({ status: RemoteVaultStatus.NotFound, content: 'missing' }),
    listObjects: async () => ({ status: RemoteVaultStatus.Success, content: [] })
  }
}

function fakeLocal(initial = new Map()) {
  const objects = initial
  return {
    objects,
    readAttachmentCiphertext: async (reference) => objects.has(reference.id)
      ? { ok: true, data: objects.get(reference.id) }
      : { ok: false, code: 'NOT_FOUND', message: 'missing' },
    writeAttachmentCiphertext: async (reference, content) => {
      objects.set(reference.id, content)
      return { ok: true, data: null }
    }
  }
}

test('attachment upload precedes vault metadata and accepts only identical immutable conflicts', async () => {
  const { encrypted, payload } = await fixture()
  const remote = fakeRemote()
  const local = fakeLocal(new Map([[id, encrypted.objectText]]))
  assert.equal(await ensureRemoteAttachmentObjects(remote, 'vault.json', payload, local), 1)
  const objectName = attachmentRemoteObjectName('vault.json', id)
  assert.equal(remote.objects.get(objectName), encrypted.objectText)
  assert.equal(await ensureRemoteAttachmentObjects(remote, 'vault.json', payload, local), 1)
  remote.objects.set(objectName, encrypted.objectText + ' ')
  await assert.rejects(() => ensureRemoteAttachmentObjects(remote, 'vault.json', payload, local), /hash/i)
})

test('attachment download verifies ciphertext before publishing a local object', async () => {
  const { encrypted, payload } = await fixture()
  const remote = fakeRemote()
  remote.objects.set(attachmentRemoteObjectName('vault.json', id), encrypted.objectText)
  const local = fakeLocal()
  assert.equal(await ensureLocalAttachmentObjects(remote, 'vault.json', payload, local), 1)
  assert.equal(local.objects.get(id), encrypted.objectText)
})

test('cloud review and three-way merge preserve attachment reference changes', async () => {
  const { encrypted, payload } = await fixture()
  const base = { ...defaultVaultPayload([{ id: 'entry-1', kind: 'secure-note', title: 'Note', domains: [], attachments: [] }]), attachmentKey: payload.attachmentKey }
  const diff = buildCloudSyncDiff(payload, base)
  assert.equal(diff[0].details.find((detail) => detail.key === 'attachments')?.label, '附件')

  const local = structuredClone(base)
  local.entries[0].note = 'local note'
  const merged = mergeVaultPayloads(base, local, payload)
  assert.equal(merged.payload.entries[0].note, 'local note')
  assert.deepEqual(merged.payload.entries[0].attachments, [encrypted.reference])
})

test('sync refuses independently created attachment data keys', async () => {
  const first = await generateAttachmentKey()
  const second = await generateAttachmentKey()
  const base = defaultVaultPayload()
  const local = { ...defaultVaultPayload(), attachmentKey: first.encoded }
  const remote = { ...defaultVaultPayload(), attachmentKey: second.encoded }
  const plan = await createCloudSyncPlan({
    requestedDirection: 'download',
    localPayload: local,
    remotePayload: remote,
    ancestorPayload: base,
    fingerprint: async (value) => JSON.stringify(value)
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'conflict')
  assert.match(plan.message, /附件数据密钥/)
})
