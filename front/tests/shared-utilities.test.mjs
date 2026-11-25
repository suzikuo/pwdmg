import assert from 'node:assert/strict'
import test from 'node:test'

import {
  base64ToBytes,
  bytesToBase64,
  sha256Base64,
  sha256Bytes,
  sha256Hex,
  toArrayBuffer
} from '../src/services/shared/encoding.ts'
import {
  collectEntryIds,
  countEntries,
  findEntryById,
  findParentEntryId,
  flattenEntries,
  walkEntries
} from '../src/services/shared/entryTree.ts'

test('encoding helpers round-trip bytes, subarrays, base64, and SHA-256 digests', async () => {
  const full = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
  const slice = full.subarray(2, 7)
  const buffer = toArrayBuffer(slice)
  assert.equal(buffer.byteLength, 5)
  assert.deepEqual(new Uint8Array(buffer), new Uint8Array([2, 3, 250, 251, 252]))

  const encoded = bytesToBase64(full)
  assert.deepEqual(base64ToBytes(encoded), full)

  // Known SHA-256 vector for "abc"
  const hex = await sha256Hex('abc')
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const bytes = await sha256Bytes(new TextEncoder().encode('abc'))
  assert.equal(bytes.byteLength, 32)
  assert.equal(await sha256Base64('abc'), bytesToBase64(bytes))
})

test('entryTree helpers traverse, locate, count, and flatten nested vault entries', () => {
  const tree = [
    {
      id: 'folder-1',
      kind: 'folder',
      title: 'Work',
      domains: [],
      children: [
        { id: 'login-1', kind: 'login', title: 'Mail', domains: [], children: [] },
        {
          id: 'folder-2',
          kind: 'folder',
          title: 'Cloud',
          domains: [],
          children: [
            { id: 'key-1', kind: 'api-key', title: 'OSS', domains: [], children: [] }
          ]
        }
      ]
    },
    { id: 'note-1', kind: 'secure-note', title: 'Recovery', domains: [], children: [] }
  ]

  assert.deepEqual(collectEntryIds(tree), ['folder-1', 'login-1', 'folder-2', 'key-1', 'note-1'])
  assert.equal(countEntries(tree), 5)
  assert.deepEqual(flattenEntries(tree).map((entry) => entry.id), ['folder-1', 'login-1', 'folder-2', 'key-1', 'note-1'])
  assert.equal(findEntryById(tree, 'key-1')?.title, 'OSS')
  assert.equal(findEntryById(tree, 'missing'), null)
  assert.equal(findParentEntryId(tree, 'folder-1'), '')
  assert.equal(findParentEntryId(tree, 'login-1'), 'folder-1')
  assert.equal(findParentEntryId(tree, 'key-1'), 'folder-2')
  assert.equal(findParentEntryId(tree, 'missing'), null)

  const visited = []
  walkEntries(tree, (entry, parentId) => visited.push(`${parentId}->${entry.id}`))
  assert.deepEqual(visited, [
    '->folder-1',
    'folder-1->login-1',
    'folder-1->folder-2',
    'folder-2->key-1',
    '->note-1'
  ])
})
