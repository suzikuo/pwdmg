import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  DEFAULT_COMMIT_FETCH_CONCURRENCY,
  appendOnlyObjectPrefixes,
  appendRemoteVaultCommit,
  createMemoryCommitCache,
  loadAppendOnlyVault
} from '../src/services/sync/appendOnlyRemoteVault.ts'
import { createPersistentCommitCache } from '../src/services/sync/commitCacheStore.ts'

class MemoryStore {
  objects = new Map()
  writes = []
  reads = []
  listPrefixes = []
  cacheScope

  constructor({ cacheScope } = {}) {
    this.cacheScope = cacheScope
  }

  async readObject(name) {
    this.reads.push(name)
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
    this.listPrefixes.push(prefix)
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

test('migrates a legacy object into a verified immutable generation and commit when legacyObjectNames is explicitly passed', async () => {
  const store = new MemoryStore()
  store.objects.set('vault.json', 'legacy-envelope')

  const before = await loadAppendOnlyVault(store, 'vault.json', { legacyObjectNames: ['vault.json'] })
  assert.equal(before.status, 'success')
  assert.equal(before.heads[0].content, 'legacy-envelope')

  const written = await appendRemoteVaultCommit(store, 'vault.json', 'new-envelope', {
    legacyObjectNames: ['vault.json'],
    expectedHeadIds: before.heads.map((head) => head.id),
    now: () => 1_000,
    randomId: () => 'client-write-0001'
  })
  assert.equal(written.status, 'success')
  assert.ok(store.writes.every((write) => write.options.forbidOverwrite === true))

  const after = await loadAppendOnlyVault(store, 'vault.json', { legacyObjectNames: ['vault.json'] })
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

test('an old client write after migration is exposed as a branch when legacyObjectNames is passed', async () => {
  const store = new MemoryStore()
  store.objects.set('vault.json', 'legacy-envelope')
  const initial = await loadAppendOnlyVault(store, 'vault.json', { legacyObjectNames: ['vault.json'] })
  assert.equal((await appendRemoteVaultCommit(store, 'vault.json', 'managed-envelope', {
    legacyObjectNames: ['vault.json'],
    expectedHeadIds: initial.heads.map((head) => head.id),
    now: () => 3_000,
    randomId: () => 'managed-client-1'
  })).status, 'success')

  store.objects.set('vault.json', 'old-client-new-envelope')
  const read = await loadAppendOnlyVault(store, 'vault.json', { legacyObjectNames: ['vault.json'] })
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

test('caches verified immutable commits across repeated loadAppendOnlyVault calls on the same store', async () => {
  const writerStore = new MemoryStore()
  for (let index = 1; index <= 4; index += 1) {
    const res = await appendRemoteVaultCommit(writerStore, 'vault.json', `envelope-${index}`, {
      now: () => 10_000 + index,
      randomId: () => `commit-cache-${String(index).padStart(4, '0')}`
    })
    assert.equal(res.status, 'success')
  }

  // Seed a fresh reader store so its cache starts cold
  const readerStore = new MemoryStore()
  for (const [key, value] of writerStore.objects.entries()) readerStore.objects.set(key, value)
  const commitPrefix = appendOnlyObjectPrefixes('vault.json').commits

  const first = await loadAppendOnlyVault(readerStore, 'vault.json')
  assert.equal(first.status, 'success')
  assert.equal(first.heads[0].content, 'envelope-4')
  const firstCommitReads = readerStore.reads.filter((name) => name.startsWith(commitPrefix))
  assert.equal(firstCommitReads.length, 4)

  readerStore.reads = []
  const second = await loadAppendOnlyVault(readerStore, 'vault.json')
  assert.equal(second.status, 'success')
  assert.equal(second.heads[0].content, 'envelope-4')
  const secondCommitReads = readerStore.reads.filter((name) => name.startsWith(commitPrefix))
  assert.equal(secondCommitReads.length, 0)

  // Adding a 5th commit externally only fetches the single new uncached commit
  const fifth = await appendRemoteVaultCommit(writerStore, 'vault.json', 'envelope-5', {
    now: () => 10_005,
    randomId: () => 'commit-cache-0005'
  })
  assert.equal(fifth.status, 'success')
  for (const [key, value] of writerStore.objects.entries()) readerStore.objects.set(key, value)

  readerStore.reads = []
  const third = await loadAppendOnlyVault(readerStore, 'vault.json')
  assert.equal(third.status, 'success')
  assert.equal(third.heads[0].content, 'envelope-5')
  const thirdCommitReads = readerStore.reads.filter((name) => name.startsWith(commitPrefix))
  assert.equal(thirdCommitReads.length, 1)
})

test('fetches uncached commits with bounded concurrency instead of serially', async () => {
  assert.equal(DEFAULT_COMMIT_FETCH_CONCURRENCY, 6)
  const seedStore = new MemoryStore()
  for (let index = 1; index <= 14; index += 1) {
    const res = await appendRemoteVaultCommit(seedStore, 'vault.json', `parallel-envelope-${index}`, {
      now: () => 20_000 + index,
      randomId: () => `parallel-id-${String(index).padStart(4, '0')}`
    })
    assert.equal(res.status, 'success')
  }

  const commitPrefix = appendOnlyObjectPrefixes('vault.json').commits
  let inFlightCommitReads = 0
  let maxInFlightCommitReads = 0
  const delayedStore = new MemoryStore()
  for (const [key, value] of seedStore.objects.entries()) delayedStore.objects.set(key, value)
  const baseReadObject = delayedStore.readObject.bind(delayedStore)
  delayedStore.readObject = async (name, maxBytes) => {
    const isCommit = name.startsWith(commitPrefix)
    if (isCommit) {
      inFlightCommitReads += 1
      maxInFlightCommitReads = Math.max(maxInFlightCommitReads, inFlightCommitReads)
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, isCommit ? 15 : 0))
      return await baseReadObject(name, maxBytes)
    } finally {
      if (isCommit) inFlightCommitReads -= 1
    }
  }

  const result = await loadAppendOnlyVault(delayedStore, 'vault.json')
  assert.equal(result.status, 'success')
  assert.equal(result.heads[0].content, 'parallel-envelope-14')
  assert.ok(maxInFlightCommitReads > 1, `expected concurrent reads > 1, got ${maxInFlightCommitReads}`)
  assert.ok(
    maxInFlightCommitReads <= DEFAULT_COMMIT_FETCH_CONCURRENCY,
    `expected bounded concurrency <= ${DEFAULT_COMMIT_FETCH_CONCURRENCY}, got ${maxInFlightCommitReads}`
  )
})

test('isolates commit caches across distinct store instances and supports custom pluggable commitCache', async () => {
  const storeA = new MemoryStore()
  const storeB = new MemoryStore()
  const writeOpts = { now: () => 30_000, randomId: () => 'same-commit-0001' }
  assert.equal((await appendRemoteVaultCommit(storeA, 'vault.json', 'bucket-a-content', writeOpts)).status, 'success')
  assert.equal((await appendRemoteVaultCommit(storeB, 'vault.json', 'bucket-b-content', writeOpts)).status, 'success')

  // Fresh reader instances without cacheScope must never cross-contaminate
  const readerA = new MemoryStore()
  const readerB = new MemoryStore()
  for (const [k, v] of storeA.objects.entries()) readerA.objects.set(k, v)
  for (const [k, v] of storeB.objects.entries()) readerB.objects.set(k, v)

  const readA = await loadAppendOnlyVault(readerA, 'vault.json')
  const readB = await loadAppendOnlyVault(readerB, 'vault.json')
  assert.equal(readA.status, 'success')
  assert.equal(readB.status, 'success')
  assert.equal(readA.heads[0].content, 'bucket-a-content')
  assert.equal(readB.heads[0].content, 'bucket-b-content')

  // Distinct cacheScope values also stay isolated even when sharing the same pluggable CommitCache
  const sharedCache = createMemoryCommitCache(10)
  const scopedA = new MemoryStore({ cacheScope: 'bucket-a' })
  const scopedB = new MemoryStore({ cacheScope: 'bucket-b' })
  for (const [k, v] of storeA.objects.entries()) scopedA.objects.set(k, v)
  for (const [k, v] of storeB.objects.entries()) scopedB.objects.set(k, v)

  const scopedReadA = await loadAppendOnlyVault(scopedA, 'vault.json', { commitCache: sharedCache })
  const scopedReadB = await loadAppendOnlyVault(scopedB, 'vault.json', { commitCache: sharedCache })
  assert.equal(scopedReadA.heads[0].content, 'bucket-a-content')
  assert.equal(scopedReadB.heads[0].content, 'bucket-b-content')

  // Another store with the same cacheScope and pluggable cache hits the cache without reading commits
  const scopedA2 = new MemoryStore({ cacheScope: 'bucket-a' })
  for (const [k, v] of storeA.objects.entries()) scopedA2.objects.set(k, v)
  const commitPrefix = appendOnlyObjectPrefixes('vault.json').commits
  const cachedRead = await loadAppendOnlyVault(scopedA2, 'vault.json', { commitCache: sharedCache })
  assert.equal(cachedRead.status, 'success')
  assert.equal(cachedRead.heads[0].content, 'bucket-a-content')
  assert.equal(scopedA2.reads.filter((name) => name.startsWith(commitPrefix)).length, 0)
})

test('does not probe baseObjectName or any legacy prefix when legacyObjectNames is omitted or empty', async () => {
  const store = new MemoryStore()
  store.objects.set('pwd/mypwdmg-vault.json', 'ancient-legacy-object')
  const written = await appendRemoteVaultCommit(store, 'pwd/mypwdmg-vault.json', 'v3-envelope', {
    now: () => 40_000,
    randomId: () => 'no-legacy-probe-1'
  })
  assert.equal(written.status, 'success')

  const prefixes = appendOnlyObjectPrefixes('pwd/mypwdmg-vault.json')
  store.listPrefixes = []
  store.reads = []

  const readDefault = await loadAppendOnlyVault(store, 'pwd/mypwdmg-vault.json')
  assert.equal(readDefault.status, 'success')
  assert.equal(readDefault.heads[0].content, 'v3-envelope')
  assert.deepEqual(store.listPrefixes, [prefixes.commits])
  assert.ok(!store.reads.includes('pwd/mypwdmg-vault.json'))

  store.listPrefixes = []
  store.reads = []
  const readEmpty = await loadAppendOnlyVault(store, 'pwd/mypwdmg-vault.json', { legacyObjectNames: [] })
  assert.equal(readEmpty.status, 'success')
  assert.deepEqual(store.listPrefixes, [prefixes.commits])
  assert.ok(!store.reads.includes('pwd/mypwdmg-vault.json'))
})

test('persistent IndexedDB commit cache hits across fresh store and cache instances with the same cacheScope', async () => {
  const fakeIdb = createFakeIndexedDB()
  const scope = 'aliyun-oss:cn-hangzhou/persistent-test-bucket'
  const seedStore = new MemoryStore()
  for (let index = 1; index <= 6; index += 1) {
    const res = await appendRemoteVaultCommit(seedStore, 'pwd/mypwdmg-vault.json', `envelope-v${index}`, {
      now: () => 50_000 + index,
      randomId: () => `persist-commit-${String(index).padStart(4, '0')}`
    })
    assert.equal(res.status, 'success')
  }

  const prefixes = appendOnlyObjectPrefixes('pwd/mypwdmg-vault.json')

  // First session: cold L1 + cold IDB fetches all 6 commits and persists them to IDB
  const firstSessionCache = createPersistentCommitCache({ indexedDB: fakeIdb, maxEntries: 2000 })
  const firstStore = new MemoryStore({ cacheScope: scope })
  for (const [key, value] of seedStore.objects.entries()) firstStore.objects.set(key, value)

  const firstRead = await loadAppendOnlyVault(firstStore, 'pwd/mypwdmg-vault.json', { commitCache: firstSessionCache })
  assert.equal(firstRead.status, 'success')
  assert.equal(firstRead.heads[0].content, 'envelope-v6')
  assert.equal(firstStore.reads.filter((name) => name.startsWith(prefixes.commits)).length, 6)
  assert.equal(firstStore.reads.filter((name) => name.startsWith(prefixes.generations)).length, 1)

  // Cold restart: brand-new cache instance (empty L1!) + brand-new store instance with same cacheScope
  const restartedSessionCache = createPersistentCommitCache({ indexedDB: fakeIdb, maxEntries: 2000 })
  const restartedStore = new MemoryStore({ cacheScope: scope })
  for (const [key, value] of seedStore.objects.entries()) restartedStore.objects.set(key, value)

  const coldRestartRead = await loadAppendOnlyVault(restartedStore, 'pwd/mypwdmg-vault.json', {
    commitCache: restartedSessionCache
  })
  assert.equal(coldRestartRead.status, 'success')
  assert.equal(coldRestartRead.heads[0].content, 'envelope-v6')
  // Zero commit GETs and only 1 listObjects + 1 tip generation GET!
  assert.deepEqual(restartedStore.listPrefixes, [prefixes.commits])
  assert.equal(restartedStore.reads.filter((name) => name.startsWith(prefixes.commits)).length, 0)
  assert.equal(restartedStore.reads.filter((name) => name.startsWith(prefixes.generations)).length, 1)

  // Default scopedCommitCache also reuses cached commits across fresh stores with the same cacheScope
  const defaultScope = 'aliyun-oss:cn-hangzhou/default-scoped-cache-test'
  const scopedStore1 = new MemoryStore({ cacheScope: defaultScope })
  const scopedStore2 = new MemoryStore({ cacheScope: defaultScope })
  for (const [key, value] of seedStore.objects.entries()) {
    scopedStore1.objects.set(key, value)
    scopedStore2.objects.set(key, value)
  }
  const warmRead = await loadAppendOnlyVault(scopedStore1, 'pwd/mypwdmg-vault.json')
  assert.equal(warmRead.status, 'success')
  assert.equal(scopedStore1.reads.filter((name) => name.startsWith(prefixes.commits)).length, 6)

  const secondStoreRead = await loadAppendOnlyVault(scopedStore2, 'pwd/mypwdmg-vault.json')
  assert.equal(secondStoreRead.status, 'success')
  assert.equal(secondStoreRead.heads[0].content, 'envelope-v6')
  assert.equal(scopedStore2.reads.filter((name) => name.startsWith(prefixes.commits)).length, 0)
})

function createFakeIndexedDB() {
  const databases = new Map()
  return {
    open(name) {
      const request = { result: null, error: null, transaction: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null }
      queueMicrotask(() => {
        let stores = databases.get(name)
        const isNew = !stores
        if (!stores) {
          stores = new Map()
          databases.set(name, stores)
        }
        const db = {
          onclose: null,
          onversionchange: null,
          close() {},
          objectStoreNames: { contains: (storeName) => stores.has(storeName) },
          createObjectStore(storeName) {
            const data = new Map()
            const indexes = new Set()
            const meta = { data, indexes }
            stores.set(storeName, meta)
            return {
              indexNames: { contains: (idx) => indexes.has(idx) },
              createIndex(idx) {
                indexes.add(idx)
              }
            }
          },
          transaction(storeName) {
            const meta = stores.get(storeName)
            let pending = 0
            let completed = false
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                const finishOne = () => {
                  pending -= 1
                  if (pending === 0 && !completed) {
                    queueMicrotask(() => {
                      if (pending === 0 && !completed) {
                        completed = true
                        tx.oncomplete?.()
                      }
                    })
                  }
                }
                return {
                  indexNames: { contains: (idx) => meta.indexes.has(idx) },
                  get(key) {
                    pending += 1
                    const req = { result: undefined, error: null, onsuccess: null, onerror: null }
                    queueMicrotask(() => {
                      req.result = meta.data.get(key)
                      req.onsuccess?.()
                      finishOne()
                    })
                    return req
                  },
                  put(record) {
                    pending += 1
                    meta.data.set(record.key, structuredClone(record))
                    queueMicrotask(finishOne)
                  },
                  count() {
                    pending += 1
                    const req = { result: 0, error: null, onsuccess: null, onerror: null }
                    queueMicrotask(() => {
                      req.result = meta.data.size
                      req.onsuccess?.()
                      finishOne()
                    })
                    return req
                  },
                  index() {
                    return {
                      openCursor() {
                        pending += 1
                        const req = { result: null, error: null, onsuccess: null, onerror: null }
                        const ordered = [...meta.data.values()].sort((a, b) => a.cachedAt - b.cachedAt)
                        let cursorIndex = 0
                        const emit = () => {
                          if (cursorIndex >= ordered.length) {
                            req.result = null
                            req.onsuccess?.()
                            finishOne()
                            return
                          }
                          const current = ordered[cursorIndex]
                          req.result = {
                            delete() {
                              meta.data.delete(current.key)
                            },
                            continue() {
                              cursorIndex += 1
                              queueMicrotask(emit)
                            }
                          }
                          req.onsuccess?.()
                        }
                        queueMicrotask(emit)
                        return req
                      }
                    }
                  }
                }
              }
            }
            return tx
          }
        }
        request.result = db
        if (isNew) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    }
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
