import assert from 'node:assert/strict'
import test from 'node:test'

import { removeTrashedEntries } from '../src/services/entryTrash.ts'

test('bulk trash removal deletes trashed roots and nested items only', () => {
  const entries = [
    {
      id: 'active-folder',
      kind: 'folder',
      title: 'Active',
      status: 'active',
      children: [
        { id: 'nested-trash', kind: 'login', title: 'Trash', status: 'trashed', children: [] },
        { id: 'nested-archive', kind: 'login', title: 'Archive', status: 'disabled', children: [] }
      ]
    },
    {
      id: 'trashed-folder',
      kind: 'folder',
      title: 'Trash folder',
      status: 'trashed',
      children: [
        { id: 'legacy-active-child', kind: 'login', title: 'Child', status: 'active', children: [] }
      ]
    },
    { id: 'active-login', kind: 'login', title: 'Keep', status: 'active', children: [] }
  ]

  assert.equal(removeTrashedEntries(entries), 3)
  assert.deepEqual(entries.map((entry) => entry.id), ['active-folder', 'active-login'])
  assert.deepEqual(entries[0].children.map((entry) => entry.id), ['nested-archive'])
})

test('bulk trash removal is a no-op when the recycle bin is empty', () => {
  const entries = [{ id: 'active', kind: 'login', title: 'Keep', status: 'active', children: [] }]
  assert.equal(removeTrashedEntries(entries), 0)
  assert.deepEqual(entries.map((entry) => entry.id), ['active'])
})
