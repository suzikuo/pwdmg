import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { RemoteVaultStatus as Status } from '../src/services/cloud/remoteVaultStore.ts'
import {
  DEVICE_HISTORY_GRACE_MS,
  loadDeviceVault,
  loadDeviceVaultCommonAncestor,
  makeDeviceCheckpointBasis,
  pruneDeviceVaultHistory,
  publishDeviceVault,
  validateDeviceVaultCheckpoint
} from '../src/services/sync/deviceRemoteVault.ts'
import { publishLocalDeviceVault } from '../src/services/sync/deviceSyncWriter.ts'
import { readSyncCheckpoint, writeSyncCheckpoint } from '../src/services/sync/syncCheckpointStore.ts'
import { createSyncEngine, readCloudVaultForSync } from '../src/services/sync/syncEngine.ts'
import { api } from '../src/services/api.ts'
import { AutoSyncPasswordGate } from '../src/services/autoSyncPasswordGate.ts'
import { recordPermanentEntryDeletions } from '../src/services/entryTombstones.ts'
import { mergeVaultPayloads } from '../src/services/sync/threeWayVaultMerge.ts'
import { defaultVaultPayload, normalizeVaultPayload } from '../src/services/vaultDefaults.ts'

const baseName = 'pwd/vault.json'
const prefix = `${baseName}.sync-v4/`
const deviceA = 'a'.repeat(32)
const deviceB = 'b'.repeat(32)

class MemoryStore {
  constructor(objects = new Map()) {
    this.objects = objects
    this.calls = []
    this.modified = new Map()
  }

  async listObjects(name, limit, cursor = '') {
    this.calls.push(['list', name])
    const names = [...this.objects.keys()].filter((key) => key.startsWith(name) && key > cursor).sort()
    return {
      status: Status.Success,
      nextCursor: names.length > limit ? names[limit - 1] : undefined,
      content: names.slice(0, limit).map((key) => ({
        name: key,
        etag: `"${digest(this.objects.get(key))}"`,
        lastModified: this.modified.get(key) || '2020-01-01T00:00:00.000Z'
      }))
    }
  }

  async readObject(name) {
    this.calls.push(['get', name])
    const content = this.objects.get(name)
    return content === undefined ? { status: Status.NotFound, content: '' }
      : { status: Status.Success, content, etag: digest(content) }
  }

  async writeObject(name, content, _type, options) {
    this.calls.push(['put', name])
    if (options?.forbidOverwrite && this.objects.has(name)) return { status: Status.Conflict, content: 'exists' }
    this.objects.set(name, content)
    this.modified.set(name, new Date(Date.UTC(2020, 0, 1) + this.calls.length * 1000).toISOString())
    return { status: Status.Success, content: '' }
  }

  async deleteObject(name) {
    this.calls.push(['delete', name])
    this.objects.delete(name)
    return { status: Status.Success, content: '' }
  }
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex')
}

function publish(store, deviceId, content, expected = [], callbacks = {}) {
  return publishDeviceVault(store, baseName, content, expected, {
    deviceId,
    startIndexWrite: callbacks.start ?? (() => {}),
    confirmIndexWrite: callbacks.confirm ?? (() => {})
  })
}

function headIds(result) {
  return result.heads.map((head) => head.id)
}

test('managed sync only lists v4 device indices and skips downloads on a warm no-change read', async () => {
  const writer = new MemoryStore(new Map([[`${baseName}.sync-v3/commits/old.json`, 'legacy']]))
  assert.equal((await readCloudVaultForSync(writer, baseName, baseName)).response.status, Status.NotFound)
  const first = await publish(writer, deviceA, 'ciphertext 1')
  assert.equal(first.status, 'success')
  assert.deepEqual(writer.calls.filter(([type]) => type === 'put').map(([, name]) => name), [
    `${prefix}snapshots/${first.commitId}.vault`, `${prefix}versions/${first.commitId}.json`, `${prefix}heads/${deviceA}.json`
  ])
  const reader = new MemoryStore(writer.objects)
  assert.equal((await readCloudVaultForSync(reader, baseName, baseName)).response.content, 'ciphertext 1')
  reader.calls.length = 0
  await readCloudVaultForSync(reader, baseName, baseName)
  assert.deepEqual(reader.calls, [['list', `${prefix}heads/`]])

  const second = await publish(writer, deviceA, 'ciphertext 2', [first.commitId])
  reader.calls.length = 0
  assert.equal((await readCloudVaultForSync(reader, baseName, baseName)).response.content, 'ciphertext 2')
  assert.deepEqual(reader.calls, [
    ['list', `${prefix}heads/`], ['get', `${prefix}heads/${deviceA}.json`], ['get', `${prefix}snapshots/${second.commitId}.vault`]
  ])
  assert.equal(writer.objects.get(`${baseName}.sync-v3/commits/old.json`), 'legacy')
})

test('concurrent independent publishers keep both tips and find their real common ancestor without listing history', async () => {
  const primary = new MemoryStore()
  const base = await publish(primary, deviceA, 'base')
  const secondary = new MemoryStore(primary.objects)
  const [left, right] = await Promise.all([
    publish(primary, deviceA, 'left', [base.commitId]),
    publish(secondary, deviceB, 'right', [base.commitId])
  ])
  assert.equal(left.status, 'success')
  assert.equal(right.status, 'success')
  const reader = new MemoryStore(primary.objects)
  const branches = await loadDeviceVault(reader, baseName)
  assert.equal(branches.status, 'conflict')
  assert.deepEqual(branches.heads.map((head) => head.content).sort(), ['left', 'right'])
  assert.equal(await validateDeviceVaultCheckpoint(reader, baseName, [branches.heads[0]], [branches.heads[1].id]), false)
  const common = await loadDeviceVaultCommonAncestor(reader, baseName, branches.heads.slice(0, 1), branches.heads[1])
  assert.equal(common.id, base.commitId)
  assert.equal(common.content, 'base')
  assert.ok(reader.calls.filter(([method]) => method === 'list').every(([, name]) => name === `${prefix}heads/`))
  assert.equal((await publish(primary, deviceA, 'stale', [left.commitId])).status, 'conflict')
  const merged = await publish(primary, deviceA, 'left + right', headIds(branches))
  assert.equal(merged.status, 'success')
  const settled = await loadDeviceVault(reader, baseName)
  assert.deepEqual(headIds(settled), [merged.commitId])
  assert.equal(await validateDeviceVaultCheckpoint(reader, baseName, settled.heads, [right.commitId]), true)
})

async function publishHistory(store, count, firstDevice = deviceA) {
  const commits = []
  for (let index = 0; index < count; index += 1) {
    const written = await publish(store, index === 0 ? firstDevice : deviceA, `snapshot ${index}`, commits.length ? [commits.at(-1).commitId] : [])
    assert.equal(written.status, 'success')
    commits.push(written)
  }
  return commits
}

function observedHistory(commit) {
  return { headId: commit.commitId, basis: commit.record, observedAt: Date.now() - DEVICE_HISTORY_GRACE_MS }
}

test('v4 retention skips listing history below the threshold', async () => {
  const store = new MemoryStore()
  const commits = await publishHistory(store, 44)
  store.calls.length = 0
  const latest = commits.at(-1)
  assert.deepEqual(await pruneDeviceVaultHistory(store, baseName, latest.commitId, observedHistory(latest), () => true), { removed: 0 })
  assert.deepEqual(store.calls, [['list', `${prefix}heads/`]])
})

test('retention reclaims old pairs and a dormant device verifies its local baseline without history requests', async () => {
  const writer = new MemoryStore()
  const commits = await publishHistory(writer, 50, deviceB)
  const early = commits[1]
  const latest = commits.at(-1)
  const abandonedId = 'f'.repeat(32)
  const abandoned = {
    ...early.record,
    id: abandonedId,
    versions: { ...early.record.versions, [deviceA]: { id: abandonedId, sequence: 1 } },
    contentSha256: digest('abandoned snapshot')
  }
  writer.objects.set(`${prefix}versions/${abandonedId}.json`, JSON.stringify(abandoned))
  writer.objects.set(`${prefix}snapshots/${abandonedId}.vault`, 'abandoned snapshot')
  const pending = await publish(writer, deviceA, 'unpublished snapshot', [latest.commitId], { start: () => { throw Error('staged only') } })
  assert.equal(pending.status, 'error')
  const pendingRecord = [...writer.objects].find(([key, value]) => key.startsWith(`${prefix}versions/`) && JSON.parse(value).contentSha256 === digest('unpublished snapshot'))
  const pendingId = JSON.parse(pendingRecord[1]).id
  const backup = 'pwd/backup/manual.json'
  const attachment = `${baseName}.attachments/v1/attachment.json`
  writer.objects.set(backup, 'backup')
  writer.objects.set(attachment, 'attachment')
  writer.modified.set(`${prefix}snapshots/${commits[2].commitId}.vault`, new Date().toISOString())
  const cleanupStore = new MemoryStore(writer.objects)
  cleanupStore.modified = writer.modified

  const cleanup = await pruneDeviceVaultHistory(cleanupStore, baseName, latest.commitId, observedHistory(commits[40]), () => true)
  assert.deepEqual(cleanup, { removed: 36, remaining: 70 })
  for (const commit of [commits[0], commits[2], latest, { commitId: pendingId }, { commitId: abandonedId }]) {
    assert.ok(writer.objects.has(`${prefix}versions/${commit.commitId}.json`))
    assert.ok(writer.objects.has(`${prefix}snapshots/${commit.commitId}.vault`))
  }
  assert.ok(writer.objects.has(`${prefix}heads/${deviceA}.json`))
  assert.ok(writer.objects.has(`${prefix}heads/${deviceB}.json`))
  assert.ok(writer.objects.has(backup))
  assert.ok(writer.objects.has(attachment))
  assert.ok(!writer.objects.has(`${prefix}versions/${early.commitId}.json`))
  assert.ok(!writer.objects.has(`${prefix}snapshots/${early.commitId}.vault`))
  assert.ok(cleanupStore.calls.filter(([type, path]) => type === 'list' && path === prefix).length > 1)

  const reader = new MemoryStore(writer.objects)
  const current = await loadDeviceVault(reader, baseName)
  assert.equal(current.heads[0].id, latest.commitId)
  reader.calls.length = 0
  const basis = makeDeviceCheckpointBasis([early.record])
  assert.equal(await validateDeviceVaultCheckpoint(reader, baseName, current.heads, [early.commitId], basis), true)
  assert.equal(await validateDeviceVaultCheckpoint(reader, baseName, current.heads, [early.commitId], { ...basis, rootId: 'f'.repeat(32) }), false)
  assert.deepEqual(reader.calls, [])
  await assert.rejects(validateDeviceVaultCheckpoint(reader, baseName, current.heads, [early.commitId]), /无法读取同步版本记录/)
})

test('retention preserves legacy snapshots when their publication cannot be verified', async () => {
  const writer = new MemoryStore()
  const commits = await publishHistory(writer, 45)
  const latest = commits.at(-1)
  const legacyIndex = { ...latest.record }
  delete legacyIndex.previousPublishedIds
  writer.objects.set(`${prefix}heads/${deviceA}.json`, JSON.stringify(legacyIndex))
  writer.objects.set(`${prefix}versions/${latest.commitId}.json`, JSON.stringify(legacyIndex))
  const cleaner = new MemoryStore(writer.objects)
  assert.deepEqual(await pruneDeviceVaultHistory(cleaner, baseName, latest.commitId, observedHistory(latest), () => true), {
    removed: 0, remaining: 91
  })
  assert.equal((await loadDeviceVault(cleaner, baseName)).status, 'success')
  assert.equal(cleaner.calls.some(([verb]) => verb === 'delete'), false)
})

test('retention skips deletion if a concurrent branch appears while the batch is prepared', async () => {
  const writer = new MemoryStore()
  const latest = (await publishHistory(writer, 45)).at(-1)
  const sibling = new MemoryStore(writer.objects)
  let releaseBranch
  let branchStaged
  const staged = new Promise((resolve) => { branchStaged = resolve })
  const waitForCleanup = new Promise((resolve) => { releaseBranch = resolve })
  const branchWrite = publish(sibling, deviceB, 'concurrent branch', [latest.commitId], { start: () => {
    branchStaged()
    return waitForCleanup
  } })
  await staged
  const main = await publish(writer, deviceA, 'new main', [latest.commitId])
  assert.equal(main.status, 'success')
  const cleaner = new MemoryStore(writer.objects)
  const list = cleaner.listObjects.bind(cleaner)
  cleaner.listObjects = async (...args) => {
    const response = await list(...args)
    if (args[0] === prefix) {
      releaseBranch()
      await branchWrite
    }
    return response
  }
  assert.equal((await pruneDeviceVaultHistory(cleaner, baseName, main.commitId, observedHistory(latest), () => true)).removed, 0)
  assert.equal(cleaner.calls.some(([type]) => type === 'delete'), false)
  assert.equal((await loadDeviceVault(cleaner, baseName)).status, 'conflict')
})

test('retention keeps a recently superseded merge base when a staged branch publishes during deletion', async () => {
  const writer = new MemoryStore()
  const commits = await publishHistory(writer, 49)
  const base = commits.at(-1)
  let resumeBranch
  let branchStaged
  const staged = new Promise((resolve) => { branchStaged = resolve })
  const waitForCleanup = new Promise((resolve) => { resumeBranch = resolve })
  const branchWrite = publish(new MemoryStore(writer.objects), deviceB, 'branch', [base.commitId], { start: () => {
    branchStaged()
    return waitForCleanup
  } })
  await staged
  const main = await publish(writer, deviceA, 'new main', [base.commitId])
  const remove = writer.deleteObject.bind(writer)
  writer.deleteObject = async (name) => {
    resumeBranch()
    await branchWrite
    return remove(name)
  }

  const cleanup = await pruneDeviceVaultHistory(writer, baseName, main.commitId, observedHistory(commits[40]), () => true)
  assert.ok(cleanup.removed > 0)
  const reader = new MemoryStore(writer.objects)
  const current = await loadDeviceVault(reader, baseName)
  assert.equal(current.status, 'conflict')
  const common = await loadDeviceVaultCommonAncestor(reader, baseName, [current.heads[0]], current.heads[1])
  assert.equal(common.id, base.commitId)
})

test('retention can retry an interrupted pair deletion', async () => {
  const writer = new MemoryStore()
  const commits = await publishHistory(writer, 50)
  const latest = commits.at(-1)
  const cutoff = observedHistory(commits[40])
  const deleteObject = writer.deleteObject.bind(writer)
  writer.deleteObject = (name) => name.includes('/versions/')
    ? { status: Status.Error, content: 'interrupted' }
    : deleteObject(name)
  assert.deepEqual(await pruneDeviceVaultHistory(writer, baseName, latest.commitId, cutoff, () => true), {
    removed: 1, remaining: 100, error: 'interrupted'
  })

  writer.deleteObject = deleteObject
  const retry = await pruneDeviceVaultHistory(writer, baseName, latest.commitId, cutoff, () => true)
  assert.deepEqual(retry, { removed: 31, remaining: 69 })
  assert.equal(writer.objects.has(`${prefix}versions/${commits[1].commitId}.json`), false)
  assert.equal((await loadDeviceVault(writer, baseName)).status, 'success')
})

test('an expired staged publication cannot move a device index', async (t) => {
  const writer = new MemoryStore()
  const first = await publish(writer, deviceA, 'base')
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  let released = false
  const staged = await publish(writer, deviceB, 'expired', [first.commitId], {
    start: () => { now += DEVICE_HISTORY_GRACE_MS },
    confirm: () => { released = true }
  })
  assert.equal(staged.status, 'conflict')
  assert.equal(released, true)
  assert.equal(writer.objects.has(`${prefix}heads/${deviceB}.json`), false)
})

test('a corrupt new snapshot cannot be published or opened by another device', async () => {
  const broken = new MemoryStore()
  const write = broken.writeObject.bind(broken)
  broken.writeObject = (key, content, ...args) => write(key, key.includes('/snapshots/') ? 'altered' : content, ...args)
  assert.equal((await publish(broken, deviceA, 'original')).status, 'error')
  assert.equal((await loadDeviceVault(broken, baseName)).status, 'not-found')

  const good = new MemoryStore()
  const result = await publish(good, deviceA, 'original')
  good.objects.set(`${prefix}snapshots/${result.commitId}.vault`, 'altered')
  assert.equal((await loadDeviceVault(new MemoryStore(good.objects), baseName)).status, 'error')
})

test('losing the PUT response can be recovered from index readback and failed readback does not confirm it', async () => {
  const store = new MemoryStore()
  const base = await publish(store, deviceA, 'base')
  const write = store.writeObject.bind(store)
  store.writeObject = async (key, ...args) => {
    const response = await write(key, ...args)
    if (key.includes('/heads/')) throw new Error('connection dropped after commit')
    return response
  }
  let confirmed = false
  const result = await publish(store, deviceA, 'new', [base.commitId], { confirm: () => { confirmed = true } })
  assert.equal(result.status, 'success')
  assert.equal(confirmed, true)
  store.writeObject = (key, ...args) => key.includes('/heads/') ? { status: Status.Error, content: 'timeout' } : write(key, ...args)
  confirmed = false
  const failed = await publish(store, deviceA, 'not visible', [result.commitId], { confirm: () => { confirmed = true } })
  assert.equal(failed.status, 'error')
  assert.equal(confirmed, false)
  assert.equal((await loadDeviceVault(store, baseName)).heads[0].content, 'new')
})

test('a writer with an uncertain initial publication does not create a second root on retry', async () => {
  const store = new MemoryStore()
  const objectName = 'uncertain-bootstrap.json'
  const write = store.writeObject.bind(store)
  store.writeObject = (key, ...args) => key.includes('/heads/') ? { status: Status.Error, content: 'timeout' } : write(key, ...args)
  const first = await publishLocalDeviceVault(store, objectName, 'first', [])
  assert.equal(first.status, 'error')
  const count = store.calls.filter(([method]) => method === 'put').length
  assert.match((await publishLocalDeviceVault(store, objectName, 'second', [])).message, /上次初始化/)
  assert.equal(store.calls.filter(([method]) => method === 'put').length, count)
})

function createCheckpointIndexedDB() {
  const stores = new Map()
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => stores.set(name, new Map()),
    close() {},
    transaction(name) {
      const values = stores.get(name)
      const transaction = {
        objectStore() {
          return {
            get(key) {
              const request = { result: structuredClone(values.get(key)) }
              queueMicrotask(() => request.onsuccess())
              return request
            },
            put: (value) => {
              values.set(value.key, structuredClone(value))
              queueMicrotask(() => transaction.oncomplete())
            }
          }
        }
      }
      return transaction
    }
  }
  return {
    open() {
      const request = { result: database }
      queueMicrotask(() => {
        if (!stores.size) request.onupgradeneeded()
        request.onsuccess()
      })
      return request
    }
  }
}

test('the app bootstraps explicitly and continues syncing after opportunistic pruning', { timeout: 5000 }, async (t) => {
  const store = new MemoryStore()
  const globals = {
    fetch: globalThis.fetch, DOMParser: globalThis.DOMParser, window: globalThis.window,
    indexedDB: globalThis.indexedDB, localStorage: globalThis.localStorage
  }
  const methods = { getVault: api.getVault, previewVaultBackup: api.previewVaultBackup, exportVaultBackupForPayload: api.exportVaultBackupForPayload }
  t.after(() => {
    Object.assign(globalThis, globals)
    Object.assign(api, methods)
  })
  globalThis.window = { setTimeout, clearTimeout }
  globalThis.DOMParser = class {
    parseFromString(value) {
      const { items, cursor } = JSON.parse(value)
      const element = (localName, textContent = '', children = []) => {
        const childrenByName = (name) => children.filter((child) => child.localName === name)
        return { localName, textContent, getElementsByTagNameNS: (_namespace, name) => childrenByName(name), getElementsByTagName: childrenByName }
      }
      return {
        getElementsByTagName: () => [],
        getElementsByTagNameNS: (_namespace, name) => {
          if (name === 'IsTruncated') return [element(name, String(Boolean(cursor)))]
          if (name === 'NextMarker') return [element(name, cursor)]
          if (name !== 'Contents') return []
          return items.map((item) => element('Contents', '', [
            element('Key', item.name), element('ETag', item.etag), element('LastModified', item.lastModified)
          ]))
        }
      }
    }
  }
  globalThis.fetch = async (address, options) => {
    const url = new URL(address)
    const key = decodeURIComponent(url.pathname.slice(1))
    if (!key) {
      const result = await store.listObjects(url.searchParams.get('prefix'), 100, url.searchParams.get('marker') || '')
      return new Response(JSON.stringify({ items: result.content, cursor: result.nextCursor }))
    }
    if (options.method === 'PUT') {
      const result = await store.writeObject(key, options.body, '', {
        forbidOverwrite: new Headers(options.headers).get('x-oss-forbid-overwrite') === 'true'
      })
      return new Response('', { status: result.status === Status.Success ? 200 : 409 })
    }
    if (options.method === 'DELETE') {
      await store.deleteObject(key)
      return new Response(null, { status: 204 })
    }
    const result = await store.readObject(key)
    return result.status === Status.Success
      ? new Response(result.content, { headers: { ETag: result.etag } })
      : new Response('', { status: 404 })
  }

  const objectName = 'bootstrap/vault.json'
  const settings = { oss: { ...defaultVaultPayload().settings.oss, bucketName: 'sync-test', region: 'oss-cn-test', objectName } }
  Object.assign(settings.oss, { accessKeyId: 'test-id', accessKeySecret: 'test-key' })
  const entry = { id: 'demo', kind: 'login', title: 'Demo', domains: [] }
  let vault = { ...defaultVaultPayload([entry]), settings }
  let preview = null
  let confirmed = 0
  let status = ''
  let cleanupEnabled = false
  let cleanupLogged
  const cleanupFinished = new Promise((resolve) => { cleanupLogged = resolve })
  api.getVault = async () => ({ ok: true, data: vault })
  api.previewVaultBackup = async (content) => ({ ok: true, data: JSON.parse(content) })
  api.exportVaultBackupForPayload = async (payload) => ({ ok: true, data: { content: JSON.stringify(payload) } })
  const noop = () => {}
  const sync = createSyncEngine({
    feedback: { confirm: async () => { confirmed += 1 }, toast: noop, successToast: noop, failToast: noop },
    autoSyncPasswordGate: new AutoSyncPasswordGate(),
    getSettings: () => settings,
    getVault: () => vault,
    isLocked: () => false,
    isPasswordless: () => false,
    isCloudBusy: () => false,
    hasCompleteOssSettings: () => true,
    validateOssSettings: () => true,
    isSettingsChanged: () => false,
    isHistoryCleanupEnabled: () => cleanupEnabled,
    captureSessionGeneration: () => 1,
    getSessionGeneration: () => 1,
    isSessionGenerationCurrent: () => true,
    setCloudSyncPreview: (value) => { preview = value },
    getCloudSyncPreview: () => preview,
    hasPendingCloudSyncReview: () => Boolean(preview),
    isCloudSyncReviewOpen: () => Boolean(preview),
    showCloudSyncReview: noop,
    closeCloudSyncReview: () => { preview = null },
    getSelectedCloudObjectName: () => '',
    setSelectedCloudObjectName: noop,
    bumpCloudEncryptionBindingVersion: noop,
    setCloudInfo: noop,
    setBackupStatus: (message) => { status = message },
    beginCloudOperation: () => ({}),
    markCloudOperation: noop,
    finishCloudOperation: noop,
    appendCloudSyncLog: (log) => {
      if (log.direction === 'history') cleanupLogged(log)
    },
    getSignal: () => undefined,
    syncSettings: noop,
    publishVaultPayload: (payload) => { vault = payload; return true },
    collectLocalAttachmentObjects: noop,
    reconcileSelectedEntryAfterVaultUpdate: noop,
    saveVaultForCurrentSession: async (payload) => ({ ok: true, data: payload })
  })

  await sync.prepareCloudSyncReview({ direction: 'upload', automatic: true })
  assert.match(status, /尚未初始化/)
  assert.equal(store.objects.size, 0)
  await sync.prepareCloudSyncReview({ direction: 'upload' })
  assert.equal(confirmed, 1)
  assert.equal(preview.items[0].id, entry.id)
  await sync.applyCloudSyncPreview()
  assert.equal([...store.objects.keys()].filter((key) => key.includes('/heads/')).length, 1)

  vault = { ...defaultVaultPayload(), settings }
  const writeCount = store.calls.filter(([verb]) => verb === 'put').length
  await sync.prepareCloudSyncReview({ direction: 'upload' })
  assert.equal(preview, null)
  assert.equal(store.calls.filter(([verb]) => verb === 'put').length, writeCount)
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.equal(preview.items[0].id, entry.id)
  await sync.applyCloudSyncPreview()
  assert.equal(vault.entries[0].id, entry.id)
  assert.equal(store.calls.filter(([verb]) => verb === 'put').length, writeCount)

  globalThis.indexedDB = createCheckpointIndexedDB()
  const localValues = new Map()
  globalThis.localStorage = {
    getItem: (key) => localValues.get(key) ?? null,
    setItem: (key, value) => localValues.set(key, value)
  }
  const historyPrefix = `${objectName}.sync-v4/`
  const firstIndex = [...store.objects].find(([name]) => name.startsWith(`${historyPrefix}heads/`))[1]
  let { deviceId, id: headId } = JSON.parse(firstIndex)
  const advance = async (payload = vault) => {
    const written = await publishDeviceVault(store, objectName, JSON.stringify(payload), [headId], {
      deviceId, startIndexWrite: noop, confirmIndexWrite: noop
    })
    assert.equal(written.status, 'success')
    headId = written.commitId
  }
  await advance()
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.equal(preview, null)
  const checkpointKey = `${sync.cloudSyncStateKey(objectName)}/sync-v4`
  const dormant = await readSyncCheckpoint(checkpointKey)
  assert.equal(dormant.remoteHeadIds[0], headId)
  assert.ok(dormant.deviceBasis)

  for (let index = 2; index < 48; index += 1) await advance()
  cleanupEnabled = true
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  store.calls.length = 0
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.equal(store.calls.some(([verb, name]) => verb === 'list' && name === historyPrefix), false)
  assert.equal(store.calls.some(([verb]) => verb === 'delete'), false)

  now += DEVICE_HISTORY_GRACE_MS + 1
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.equal((await cleanupFinished).status, 'success')
  assert.equal(store.objects.size, 69)
  assert.equal(store.objects.has(`${historyPrefix}versions/${dormant.remoteHeadIds[0]}.json`), false)
  store.calls.length = 0
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.deepEqual(store.calls, [['list', `${historyPrefix}heads/`]])

  cleanupEnabled = false
  await writeSyncCheckpoint(dormant)
  const remoteEntry = { ...entry, id: 'remote-entry' }
  await advance({ ...vault, entries: [...vault.entries, remoteEntry] })
  const localEntry = { ...entry, id: 'local-entry' }
  vault = { ...vault, entries: [...vault.entries, localEntry] }
  store.calls.length = 0
  await sync.prepareCloudSyncReview({ direction: 'download' })
  assert.deepEqual(new Set(preview.sourcePayload.entries.map(({ id }) => id)), new Set([entry.id, localEntry.id, remoteEntry.id]))
  await sync.applyCloudSyncPreview()
  assert.deepEqual(new Set(vault.entries.map(({ id }) => id)), new Set([entry.id, localEntry.id, remoteEntry.id]))
  assert.equal(store.calls.some(([verb, name]) => verb === 'get' && name.startsWith(`${historyPrefix}versions/`)), false)
})

test('permanent deletions survive normalization and stale entries stay deleted during merge', () => {
  const entry = { id: 'entry-1', kind: 'login', title: 'initial', domains: [] }
  const base = defaultVaultPayload([entry])
  const deleted = defaultVaultPayload()
  recordPermanentEntryDeletions(base.entries, deleted)
  assert.deepEqual(normalizeVaultPayload(deleted).entryTombstones, [entry.id])
  assert.deepEqual(mergeVaultPayloads(defaultVaultPayload(), deleted, base, true).payload.entries, [])
  const edited = defaultVaultPayload([{ ...entry, title: 'edited' }])
  assert.equal(mergeVaultPayloads(base, deleted, edited, true).conflicts[0].reason, 'delete-update')
  const alternateEdit = defaultVaultPayload([{ ...entry, title: 'also edited' }])
  assert.equal(mergeVaultPayloads(base, edited, alternateEdit, true).conflicts[0].field, 'title')
})

test('a concurrent pair of folder moves cannot silently remove a folder cycle', () => {
  const a = { id: 'a', kind: 'folder', title: 'A', domains: [] }
  const b = { id: 'b', kind: 'folder', title: 'B', domains: [] }
  const result = mergeVaultPayloads(
    defaultVaultPayload([a, b]),
    defaultVaultPayload([{ ...a, children: [b] }]),
    defaultVaultPayload([{ ...b, children: [a] }]),
    true
  )
  assert.ok(result.conflicts.some((conflict) => conflict.reason === 'parent-cycle'))
})
