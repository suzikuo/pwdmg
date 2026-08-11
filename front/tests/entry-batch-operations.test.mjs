import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectEntryIds,
  isEntryInsideAny,
  moveSelectedEntries,
  normalizeSelectedRootIds,
  removeSelectedEntries
} from '../src/services/entryBatchOperations.ts'

function fixture() {
  return [
    {
      id: 'folder-a', kind: 'folder', title: 'A', children: [
        { id: 'login-a', kind: 'login', title: 'A login', children: [] },
        { id: 'folder-b', kind: 'folder', title: 'B', children: [
          { id: 'login-b', kind: 'login', title: 'B login', children: [] }
        ] }
      ]
    },
    { id: 'login-root', kind: 'login', title: 'Root login', children: [] },
    { id: 'folder-c', kind: 'folder', title: 'C', children: [] }
  ]
}

test('selection normalization keeps root-most IDs in tree order', () => {
  const entries = fixture()
  assert.deepEqual(
    normalizeSelectedRootIds(entries, ['login-b', 'folder-a', 'login-root', 'missing']),
    ['folder-a', 'login-root']
  )
  assert.deepEqual(collectEntryIds(entries), ['folder-a', 'login-a', 'folder-b', 'login-b', 'login-root', 'folder-c'])
})

test('batch move appends selected roots in traversal order', () => {
  const entries = fixture()
  const result = moveSelectedEntries(entries, ['login-root', 'login-a'], 'folder-c')

  assert.deepEqual(result, { movedIds: ['login-a', 'login-root'], error: '' })
  assert.deepEqual(entries.map((entry) => entry.id), ['folder-a', 'folder-c'])
  assert.deepEqual(entries[1].children.map((entry) => entry.id), ['login-a', 'login-root'])
})

test('batch move initializes missing children on an empty destination folder', () => {
  const entries = [
    { id: 'login', kind: 'login', title: 'Login' },
    { id: 'folder', kind: 'folder', title: 'Folder' }
  ]
  assert.deepEqual(moveSelectedEntries(entries, ['login'], 'folder'), {
    movedIds: ['login'],
    error: ''
  })
  assert.deepEqual(entries[0].children.map((entry) => entry.id), ['login'])
})

test('batch move rejects a selected folder descendant as destination without mutation', () => {
  const entries = fixture()
  const before = structuredClone(entries)
  assert.deepEqual(moveSelectedEntries(entries, ['folder-a'], 'folder-b'), {
    movedIds: [],
    error: 'invalid-destination'
  })
  assert.deepEqual(entries, before)
  assert.equal(isEntryInsideAny(entries, ['folder-a'], 'login-b'), true)
})

test('batch removal counts selected subtrees once', () => {
  const entries = fixture()
  assert.equal(removeSelectedEntries(entries, ['folder-a', 'login-b', 'login-root']), 5)
  assert.deepEqual(entries.map((entry) => entry.id), ['folder-c'])
})
