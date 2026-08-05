import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'
import { mergeVaultPayloads } from '../src/services/sync/threeWayVaultMerge.ts'

test('merges independent entry additions and field updates', () => {
  const base = payload([entry('shared', { title: 'Shared' })])
  const local = clone(base)
  const remote = clone(base)
  local.entries[0].username = 'local-user'
  local.entries.push(entry('local'))
  remote.entries[0].note = 'remote-note'
  remote.entries.push(entry('remote'))

  const merged = mergeVaultPayloads(base, local, remote)
  assert.deepEqual(merged.conflicts, [])
  assert.deepEqual(merged.payload.entries.map((item) => item.id), ['shared', 'local', 'remote'])
  assert.equal(merged.payload.entries[0].username, 'local-user')
  assert.equal(merged.payload.entries[0].note, 'remote-note')
})

test('merges independent additions inside the same folder without shifting existing siblings', () => {
  const base = payload([folder('group', [entry('a'), entry('b')])])
  const local = clone(base)
  const remote = clone(base)
  local.entries[0].children.splice(1, 0, entry('local'))
  remote.entries[0].children.splice(1, 0, entry('remote'))

  const merged = mergeVaultPayloads(base, local, remote)
  assert.deepEqual(merged.conflicts, [])
  assert.deepEqual(merged.payload.entries[0].children.map((item) => item.id), ['a', 'local', 'remote', 'b'])
})

test('preserves the losing same-field write as a deterministic restorable history snapshot', () => {
  const base = payload([entry('shared', { title: 'Base' }), entry('deleted')])
  const local = clone(base)
  const remote = clone(base)
  local.entries[0].title = 'Local'
  remote.entries[0].title = 'Remote'
  remote.updatedAt = 123
  local.entries.splice(1, 1)
  remote.entries[1].note = 'changed remotely'

  const merged = mergeVaultPayloads(base, local, remote)
  assert.equal(merged.conflicts.some((item) => item.id === 'shared' && item.field === 'title'), false)
  assert.equal(merged.payload.entries[0].title, 'Local')
  assert.equal(merged.payload.entries[0].history?.length, 1)
  assert.equal(merged.payload.entries[0].history?.[0].title, 'Remote')
  assert.equal(merged.payload.entries[0].history?.[0].snapshot?.title, 'Remote')
  assert.equal(merged.payload.entries[0].history?.[0].at, 123)
  assert.ok(merged.conflicts.some((item) => item.id === 'deleted' && item.reason === 'delete-update'))
})

test('repeating a same-field merge does not duplicate the conflict history record', () => {
  const base = payload([entry('shared', { title: 'Base' })])
  const local = payload([entry('shared', { title: 'Local' })])
  const remote = payload([entry('shared', { title: 'Remote' })])
  local.updatedAt = 100
  remote.updatedAt = 200

  const first = mergeVaultPayloads(base, local, remote)
  const second = mergeVaultPayloads(base, first.payload, remote)
  assert.equal(first.payload.entries[0].history?.length, 1)
  assert.deepEqual(second.payload.entries[0].history, first.payload.entries[0].history)
})

test('reports incompatible concurrent sibling reorders', () => {
  const base = payload([entry('a'), entry('b'), entry('c')])
  const local = clone(base)
  const remote = clone(base)
  local.entries = [local.entries[1], local.entries[0], local.entries[2]]
  remote.entries = [remote.entries[0], remote.entries[2], remote.entries[1]]

  const merged = mergeVaultPayloads(base, local, remote)
  assert.ok(merged.conflicts.some((item) => item.scope === 'order' && item.reason === 'order-cycle'))
})

function payload(entries) {
  return { ...defaultVaultPayload(), entries }
}

function entry(id, overrides = {}) {
  return {
    id,
    kind: 'login',
    title: id,
    status: 'active',
    domains: [],
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    history: [],
    children: [],
    ...overrides
  }
}

function folder(id, children) {
  return { ...entry(id), kind: 'folder', children }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
