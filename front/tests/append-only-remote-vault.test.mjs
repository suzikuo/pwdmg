import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  appendOnlyObjectPrefixes,
  appendRemoteVaultCommit,
  loadAppendOnlyVault
} from '../src/services/sync/appendOnlyRemoteVault.ts'

class MemoryStore {
  objects = new Map()
  writes = []

  async readObject(name) {
    if (!this.objects.has(name)) return { status: 'not-found', content: 'missing' }
    const content = this.objects.get(name)
    return { status: 'success', content, revision: sha256(content) }
  }

  async writeObject(name, content, _contentType, options = {}) {
    this.writes.push({ name, options })
    if (options.forbidOverwrite && this.objects.has(name)) return { status: 'conflict', content: 'exists' }
    this.objects.set(name, content)
    return { status: 'success', content: 'ok' }
  }

  async getObjectInfo(name) {
    if (!this.objects.has(name)) return { status: 'not-found', content: { name, exists: false, size: 0, lastModified: '' } }
    return { status: 'success', content: { name, exists: true, size: this.objects.get(name).length, lastModified: '' } }
  }

  async listObjects(prefix = '', limit = 100, cursor = '') {
    const names = [...this.objects.keys()].filter((name) => name.startsWith(prefix)).sort()
    const start = cursor ? names.findIndex((name) => name > cursor) : 0
    const safeStart = start < 0 ? names.length : start
    const page = names.slice(safeStart, safeStart + limit)
    const hasMore = safeStart + page.length < names.length
    return {
      status: 'success',
      content: page.map((name) => ({ name, exists: true, size: this.objects.get(name).length, lastModified: '' })),
      nextCursor: hasMore ? page.at(-1) : ''
    }
  }
}

test('migrates a legacy object into a verified immutable generation and commit', async () => {
  const store = new MemoryStore()
  store.objects.set('vault.json', 'legacy-envelope')

  const before = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(before.status, 'success')
  assert.equal(before.heads[0].content, 'legacy-envelope')

  const written = await appendRemoteVaultCommit(store, 'vault.json', 'new-envelope', {
    expectedHeadIds: before.heads.map((head) => head.id),
    now: () => 1_000,
    randomId: () => 'client-write-0001'
  })
  assert.equal(written.status, 'success')
  assert.ok(store.writes.every((write) => write.options.forbidOverwrite === true))

  const after = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(after.status, 'success')
  assert.equal(after.heads[0].content, 'new-envelope')
  assert.equal(after.protocolCommitIds.length, 1)
})

test('concurrent first commits remain as recoverable branches instead of overwriting', async () => {
  const store = new MemoryStore()
  const [left, right] = await Promise.all([
    appendRemoteVaultCommit(store, 'vault.json', 'left-envelope', {
      now: () => 2_000,
      randomId: () => 'left-client-0001'
    }),
    appendRemoteVaultCommit(store, 'vault.json', 'right-envelope', {
      now: () => 2_000,
      randomId: () => 'right-client-001'
    })
  ])
  assert.equal(left.status, 'success')
  assert.equal(right.status, 'success')

  const read = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(read.status, 'conflict')
  assert.deepEqual(read.heads.map((head) => head.content).sort(), ['left-envelope', 'right-envelope'])

  const resolved = await appendRemoteVaultCommit(store, 'vault.json', 'merged-envelope', {
    expectedHeadIds: read.heads.map((head) => head.id),
    now: () => 2_001,
    randomId: () => 'merge-client-0001'
  })
  assert.equal(resolved.status, 'success')
  const converged = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(converged.status, 'success')
  assert.equal(converged.heads[0].content, 'merged-envelope')
})

test('an old client write after migration is exposed as a branch', async () => {
  const store = new MemoryStore()
  store.objects.set('vault.json', 'legacy-envelope')
  const initial = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal((await appendRemoteVaultCommit(store, 'vault.json', 'managed-envelope', {
    expectedHeadIds: initial.heads.map((head) => head.id),
    now: () => 3_000,
    randomId: () => 'managed-client-1'
  })).status, 'success')

  store.objects.set('vault.json', 'old-client-new-envelope')
  const read = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(read.status, 'conflict')
  assert.deepEqual(read.heads.map((head) => head.content).sort(), ['managed-envelope', 'old-client-new-envelope'])
})

test('checks both v2 and v1 migration objects for old-client divergence', async () => {
  const store = new MemoryStore()
  store.objects.set('vault.json', 'v1-envelope')
  store.objects.set('vault.json.passkeys-v2', 'v2-envelope')
  const legacyNames = ['vault.json.passkeys-v2', 'vault.json']
  const initial = await loadAppendOnlyVault(store, 'vault.json.passkeys-v2', { legacyObjectNames: legacyNames })
  assert.equal(initial.status, 'conflict')

  store.objects.set('vault.json', 'v2-envelope')
  const converged = await loadAppendOnlyVault(store, 'vault.json.passkeys-v2', { legacyObjectNames: legacyNames })
  assert.equal(converged.status, 'success')
  const written = await appendRemoteVaultCommit(store, 'vault.json.passkeys-v2', 'managed-envelope', {
    legacyObjectNames: legacyNames,
    expectedHeadIds: converged.heads.map((head) => head.id),
    now: () => 4_000,
    randomId: () => 'managed-client-2'
  })
  assert.equal(written.status, 'success')

  store.objects.set('vault.json', 'old-v1-device-write')
  assert.equal((await loadAppendOnlyVault(store, 'vault.json.passkeys-v2', { legacyObjectNames: legacyNames })).status, 'conflict')
})

test('rejects a corrupted immutable generation', async () => {
  const store = new MemoryStore()
  const result = await appendRemoteVaultCommit(store, 'vault.json', 'valid-envelope', {
    now: () => 5_000,
    randomId: () => 'managed-client-3'
  })
  assert.equal(result.status, 'success')
  const prefixes = appendOnlyObjectPrefixes('vault.json')
  const generation = [...store.objects.keys()].find((name) => name.startsWith(prefixes.generations))
  store.objects.set(generation, 'corrupted-envelope')

  const read = await loadAppendOnlyVault(store, 'vault.json')
  assert.equal(read.status, 'error')
  assert.match(read.message, /摘要不匹配/)
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
