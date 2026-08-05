import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCloudSyncDiffItem,
  buildCloudSyncDiff,
  cloudSyncDiffCountsForItems,
  cloudSyncSelectionStats
} from '../src/services/sync/legacyDiff.ts'

function login(id, overrides = {}) {
  return {
    id,
    kind: 'login',
    title: id,
    status: 'active',
    statusReason: '',
    deletedAt: 0,
    domains: [],
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    children: [],
    ...overrides
  }
}

function folder(id, children = [], overrides = {}) {
  return login(id, {
    kind: 'folder',
    domains: [],
    children,
    ...overrides
  })
}

function payload(entries) {
  return {
    version: 1,
    revision: 1,
    entries,
    settings: {
      oss: {
        bucketName: '',
        accessKeyId: '',
        accessKeySecret: '',
        region: '',
        objectName: '',
        autoSync: false,
        autoSyncIntervalMinutes: 1
      }
    },
    updatedAt: 0
  }
}

function itemSummary(items) {
  return items.map((item) => ({
    id: item.id,
    changeType: item.changeType,
    details: item.details.map((detail) => detail.key),
    path: item.path
  }))
}

test('characterizes independent additions as directional add/delete decisions', () => {
  const local = payload([login('local-only')])
  const remote = payload([login('remote-only')])

  const items = buildCloudSyncDiff(local, remote)

  assert.deepEqual(itemSummary(items), [
    { id: 'local-only', changeType: 'added', details: [], path: 'local-only' },
    { id: 'remote-only', changeType: 'deleted', details: [], path: 'remote-only' }
  ])
  assert.deepEqual(cloudSyncDiffCountsForItems(items), { added: 1, modified: 0, deleted: 1 })
})

test('does not mark existing entries as modified when a sibling is added first', () => {
  const source = payload([login('new'), login('alpha'), login('beta')])
  const base = payload([login('alpha'), login('beta')])

  assert.deepEqual(itemSummary(buildCloudSyncDiff(source, base)), [
    { id: 'new', changeType: 'added', details: [], path: 'new' }
  ])
})

test('represents a folder with new descendants as one parent addition', () => {
  const source = payload([folder('folder', [login('child')])])
  const base = payload([])

  assert.deepEqual(itemSummary(buildCloudSyncDiff(source, base)), [
    { id: 'folder', changeType: 'added', details: [], path: 'folder' }
  ])
})

test('represents deleting a folder as one parent deletion', () => {
  const source = payload([])
  const base = payload([folder('folder', [login('child')])])

  assert.deepEqual(itemSummary(buildCloudSyncDiff(source, base)), [
    { id: 'folder', changeType: 'deleted', details: [], path: 'folder' }
  ])
})

test('treats delete-versus-modify as a directional deletion without conflict context', () => {
  const sourceEntries = []
  const targetEntries = [login('shared', { password: 'modified-on-other-side' })]
  const [item] = buildCloudSyncDiff(payload(sourceEntries), payload(targetEntries))

  assert.equal(item.changeType, 'deleted')

  applyCloudSyncDiffItem(targetEntries, sourceEntries, item)

  assert.deepEqual(targetEntries, [])
})

test('treats concurrent same-field values as a selectable directional overwrite', () => {
  const sourceEntries = [login('shared', { password: 'source-password' })]
  const targetEntries = [login('shared', { password: 'target-password' })]
  const [item] = buildCloudSyncDiff(payload(sourceEntries), payload(targetEntries))

  assert.equal(item.changeType, 'modified')
  assert.deepEqual(item.details.map((detail) => detail.key), ['password'])

  applyCloudSyncDiffItem(targetEntries, sourceEntries, item)

  assert.equal(targetEntries[0].password, 'source-password')
})

test('keeps independent field choices selectable for modified entries', () => {
  const source = payload([
    login('shared', { username: 'cloud-user', password: 'cloud-pass' })
  ])
  const base = payload([
    login('shared', { username: 'local-user', password: 'local-pass' })
  ])

  const [item] = buildCloudSyncDiff(source, base)

  assert.equal(item.changeType, 'modified')
  assert.deepEqual(item.details.map((detail) => detail.key), ['username', 'password'])
  assert.deepEqual(cloudSyncSelectionStats([item]), { selected: 2, total: 2 })
})

test('applies only checked modified fields', () => {
  const sourceEntries = [login('shared', { username: 'cloud-user', password: 'cloud-pass' })]
  const targetEntries = [login('shared', { username: 'local-user', password: 'local-pass' })]
  const [item] = buildCloudSyncDiff(payload(sourceEntries), payload(targetEntries))
  item.details.find((detail) => detail.key === 'password').checked = false

  applyCloudSyncDiffItem(targetEntries, sourceEntries, item)

  assert.equal(targetEntries[0].username, 'cloud-user')
  assert.equal(targetEntries[0].password, 'local-pass')
})

test('applies selected position changes without field changes', () => {
  const sourceEntries = [folder('folder', [login('moved')]), login('stable')]
  const targetEntries = [login('moved'), folder('folder'), login('stable')]
  const [item] = buildCloudSyncDiff(payload(sourceEntries), payload(targetEntries))

  assert.equal(item.id, 'moved')
  assert.deepEqual(item.details.map((detail) => detail.key), ['position'])

  applyCloudSyncDiffItem(targetEntries, sourceEntries, item)

  assert.deepEqual(targetEntries.map((entry) => entry.id), ['folder', 'stable'])
  assert.deepEqual(targetEntries[0].children.map((entry) => entry.id), ['moved'])
})
