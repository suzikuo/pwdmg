import { RemoteVaultStatus, type RemoteVaultStore } from '../cloud/remoteVaultStore.ts'
import { secureRandomId } from '../secureRandom.ts'
import { sha256Hex } from '../shared/encoding.ts'

const PROTOCOL = 'mypwdmg-sync-v4'
const MAX_RECORD_BYTES = 64 * 1024
const MAX_PREVIOUS_PUBLISHED_IDS = 128
const MAX_DEVICES = 256
const MAX_CACHED_SNAPSHOT_BYTES = 32 * 1024 * 1024
const ID_RE = /^[a-f0-9]{32}$/
const SHA256_RE = /^[a-f0-9]{64}$/
export const DEVICE_HISTORY_CLEANUP_THRESHOLD = 90
export const DEVICE_HISTORY_GRACE_MS = 24 * 60 * 60 * 1000
const HISTORY_OBJECT_TARGET = 70
const HISTORY_MAX_RECORDS_PER_BATCH = 20

type DeviceVersion = { id: string; sequence: number }
type DeviceVersions = Record<string, DeviceVersion>

export type DeviceSnapshotRecord = {
  protocol: typeof PROTOCOL
  id: string
  deviceId: string
  rootId: string
  versions: DeviceVersions
  previousPublishedIds?: string[]
  contentSha256: string
}

export type DeviceVaultHead = DeviceSnapshotRecord & { content: string }
export type DeviceCheckpointBasis = Pick<DeviceSnapshotRecord, 'rootId' | 'versions'>
export type DeviceHistoryObservation = { headId: string; basis: DeviceCheckpointBasis; observedAt: number }

export type DeviceVaultRead = {
  status: 'success' | 'not-found' | 'conflict' | 'error'
  heads: DeviceVaultHead[]
  message: string
}

type DeviceVaultWrite =
  | { status: 'success'; commitId: string; record: DeviceSnapshotRecord; message: string }
  | { status: 'conflict' | 'error'; message: string }

type VaultCache = {
  indices: Map<string, { etag: string; record: DeviceSnapshotRecord }>
  records: Map<string, DeviceSnapshotRecord>
  snapshots: Map<string, string>
  snapshotBytes: number
}

const sharedCaches = new Map<string, VaultCache>()
const unscopedCaches = new WeakMap<RemoteVaultStore, Map<string, VaultCache>>()

export function newDeviceSyncId(): string {
  return secureRandomId().replaceAll('-', '')
}

export function deviceVaultPrefix(baseObjectName: string): string {
  return `${baseObjectName}.sync-v4/`
}

export async function loadDeviceVault(store: RemoteVaultStore, baseObjectName: string): Promise<DeviceVaultRead> {
  try {
    const records = await readDeviceIndices(store, baseObjectName)
    const heads = await Promise.all(records.tips.map(async (record) => ({
      ...record,
      content: await readSnapshot(store, baseObjectName, record)
    })))
    if (!heads.length) return { status: 'not-found', heads, message: '新格式云端保险库尚未初始化' }
    return heads.length === 1
      ? { status: 'success', heads, message: '' }
      : { status: 'conflict', heads, message: `检测到 ${heads.length} 个并发远端分支` }
  } catch (error) {
    return { status: 'error', heads: [], message: String(error instanceof Error ? error.message : error) }
  }
}

export async function publishDeviceVault(
  store: RemoteVaultStore,
  baseObjectName: string,
  content: string,
  expectedHeadIds: string[],
  writer: { deviceId: string; startIndexWrite(): void | Promise<void>; confirmIndexWrite(): void }
): Promise<DeviceVaultWrite> {
  try {
    if (!ID_RE.test(writer.deviceId)) throw new Error('同步设备标识无效')
    const stagingStartedAt = Date.now()
    const { indices, tips } = await readDeviceIndices(store, baseObjectName)
    if (tips.map((tip) => tip.id).sort().join(',') !== [...expectedHeadIds].sort().join(',')) {
      return { status: 'conflict', message: '远端提交头已变化，请重新同步后再上传' }
    }
    const previous = indices.find((item) => item.deviceId === writer.deviceId)
    const id = newDeviceSyncId()
    const versions = joinVersions(tips)
    const sequence = (versions[writer.deviceId]?.sequence ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new Error('同步设备版本超出上限')
    if (previous && versions[writer.deviceId]?.id !== previous.id) throw new Error('同步设备索引落后，已停止发布')
    if (!previous && versions[writer.deviceId]) throw new Error('同步设备索引缺失，已停止发布')
    versions[writer.deviceId] = { id, sequence }
    if (Object.keys(versions).length > MAX_DEVICES) throw new Error('同步设备数量超过上限')

    const record: DeviceSnapshotRecord = {
      protocol: PROTOCOL,
      id,
      deviceId: writer.deviceId,
      rootId: tips[0]?.rootId ?? id,
      versions,
      ...(previous ? {
        previousPublishedIds: [previous.id, ...(previous.previousPublishedIds ?? [])].slice(0, MAX_PREVIOUS_PUBLISHED_IDS)
      } : {}),
      contentSha256: await sha256Hex(content)
    }
    const recordText = JSON.stringify(record)
    const prefix = deviceVaultPrefix(baseObjectName)
    await writeImmutableObject(store, `${prefix}snapshots/${id}.vault`, content)
    await writeImmutableObject(store, `${prefix}versions/${id}.json`, recordText, MAX_RECORD_BYTES)

    const indexName = `${prefix}heads/${writer.deviceId}.json`
    await writer.startIndexWrite()
    if (Date.now() - stagingStartedAt >= DEVICE_HISTORY_GRACE_MS / 2) {
      writer.confirmIndexWrite()
      return { status: 'conflict', message: '同步暂存已超时，请重新同步后再上传' }
    }
    try {
      const written = await store.writeObject(indexName, recordText, 'application/json')
      if (written.status === RemoteVaultStatus.AuthError || written.status === RemoteVaultStatus.QuotaExceeded) {
        writer.confirmIndexWrite()
        return { status: 'error', message: String(written.content) }
      }
    } catch {
      // A request can reach OSS even when the response is lost.
    }
    const verified = await store.readObject(indexName, MAX_RECORD_BYTES)
    if (verified.status !== RemoteVaultStatus.Success || verified.content !== recordText) {
      return { status: 'error', message: '无法确认设备索引已发布；加密快照已保留，请重新同步' }
    }
    writer.confirmIndexWrite()
    const cache = vaultCache(store, baseObjectName)
    if (verified.etag) cache.indices.set(writer.deviceId, { etag: normalizeEtag(verified.etag), record })
    rememberRecord(cache, record)
    rememberSnapshot(cache, record.id, content)
    return { status: 'success', commitId: id, record, message: '加密快照与设备索引已发布' }
  } catch (error) {
    return { status: 'error', message: String(error instanceof Error ? error.message : error) }
  }
}

export function makeDeviceCheckpointBasis(heads: DeviceSnapshotRecord[]): DeviceCheckpointBasis | undefined {
  const rootId = heads[0]?.rootId
  if (!rootId || heads.some((head) => head.rootId !== rootId)) return undefined
  return { rootId, versions: joinVersions(heads) }
}

export function normalizeDeviceCheckpointBasis(value: unknown, headIds: string[]): DeviceCheckpointBasis | undefined {
  if (!value || typeof value !== 'object' || !headIds.length) return undefined
  const basis = value as Partial<DeviceCheckpointBasis>
  if (typeof basis.rootId !== 'string' || !ID_RE.test(basis.rootId) || !validDeviceVersions(basis.versions)) return undefined
  const ids = new Set(Object.values(basis.versions).map((version) => version.id))
  if (headIds.some((id) => !ids.has(id))) return undefined
  return { rootId: basis.rootId, versions: basis.versions }
}

export async function validateDeviceVaultCheckpoint(
  store: RemoteVaultStore,
  baseObjectName: string,
  heads: DeviceSnapshotRecord[],
  checkpointIds: string[],
  checkpointBasis?: DeviceCheckpointBasis
): Promise<boolean> {
  if (!heads.length || !checkpointIds.length || checkpointIds.length > MAX_DEVICES) return false
  if (checkpointIds.some((id) => !ID_RE.test(id))) return false
  const current = makeDeviceCheckpointBasis(heads)
  if (!current) return false
  if (checkpointBasis) {
    const saved = normalizeDeviceCheckpointBasis(checkpointBasis, checkpointIds)
    return Boolean(saved && saved.rootId === current.rootId && includesVersions(current.versions, saved.versions))
  }
  const known = new Map(heads.map((head) => [head.id, head]))
  const checkpointRecords = await Promise.all(checkpointIds.map((id) => known.get(id) ?? readRecord(store, baseObjectName, id)))
  return checkpointRecords.every((record) => record.rootId === current.rootId && includesVersions(current.versions, record.versions))
}

export async function loadDeviceVaultCommonAncestor(
  store: RemoteVaultStore,
  baseObjectName: string,
  left: DeviceSnapshotRecord[],
  right: DeviceSnapshotRecord
): Promise<DeviceVaultHead | null> {
  if (!left.length || left.some((head) => head.rootId !== right.rootId)) return null
  // The lower version for each writer is included in both inputs. A single
  // candidate must cover all of them before its snapshot can anchor a merge.
  const leftVersions = joinVersions(left)
  const common = Object.entries(right.versions).flatMap(([deviceId, rightVersion]) => {
    const leftVersion = leftVersions[deviceId]
    if (!leftVersion) return []
    if (leftVersion.sequence === rightVersion.sequence && leftVersion.id !== rightVersion.id) {
      throw new Error('同一设备版本引用了不同的快照')
    }
    return [leftVersion.sequence < rightVersion.sequence ? leftVersion.id : rightVersion.id]
  })
  const cache = vaultCache(store, baseObjectName)
  const known = new Map([...left, right].map((head) => [head.id, head]))
  const candidates = await Promise.all(common.map((id) => known.get(id) ?? readRecord(store, baseObjectName, id)))
  const matches = candidates.filter((candidate) => candidate.rootId === right.rootId && candidates.every((other) =>
    includesVersions(candidate.versions, other.versions)
  ))
  if (matches.length !== 1) return null
  const record = matches[0]
  rememberRecord(cache, record)
  return { ...record, content: await readSnapshot(store, baseObjectName, record) }
}

export function estimateDeviceVaultHistory(head: DeviceCheckpointBasis) {
  const versions = Object.values(head.versions)
  const commits = versions.reduce((total, version) => total + version.sequence, 0)
  return { commits, objects: versions.length + commits * 2 }
}

export type DeviceHistoryCleanupResult = {
  removed: number
  remaining?: number
  error?: string
}

export async function pruneDeviceVaultHistory(
  store: RemoteVaultStore,
  baseObjectName: string,
  expectedHeadId: string,
  cutoff: DeviceHistoryObservation,
  canContinue: () => boolean
): Promise<DeviceHistoryCleanupResult> {
  let removed = 0
  let remaining: number | undefined
  try {
    const cutoffBasis = normalizeDeviceCheckpointBasis(cutoff.basis, [cutoff.headId])
    if (!store.deleteObject || !canContinue() || !cutoffBasis || !Number.isSafeInteger(cutoff.observedAt) ||
      cutoff.observedAt <= 0 || Date.now() - cutoff.observedAt < DEVICE_HISTORY_GRACE_MS) return { removed }
    const { indices, tips } = await readDeviceIndices(store, baseObjectName)
    const tip = tips[0]
    if (tips.length !== 1 || tip.id !== expectedHeadId || !canContinue()) return { removed }
    if (estimateDeviceVaultHistory(tip).objects < DEVICE_HISTORY_CLEANUP_THRESHOLD || tip.rootId !== cutoffBasis.rootId ||
      !includesVersions(tip.versions, cutoffBasis.versions)) return { removed }

    const prefix = deviceVaultPrefix(baseObjectName)
    const history = await listDeviceHistory(store, prefix)
    remaining = indices.length
    for (const pair of history.values()) remaining += Number(Boolean(pair.record)) + Number(Boolean(pair.snapshot))
    if (remaining < DEVICE_HISTORY_CLEANUP_THRESHOLD || !canContinue()) return { removed, remaining }

    const protectedIds = new Set([tip.rootId, ...indices.map((index) => index.id)])
    const publishedIds = new Set(indices.flatMap((index) => [
      ...(index.previousPublishedIds ?? []), ...Object.values(index.versions).map((version) => version.id)
    ]))
    const candidates = [...history].flatMap(([id, pair]) => {
      const modifiedAt = Math.max(pair.record?.modifiedAt ?? NaN, pair.snapshot?.modifiedAt ?? 0)
      return publishedIds.has(id) && !protectedIds.has(id) && modifiedAt <= cutoff.observedAt
        ? [{ id, pair, modifiedAt }]
        : []
    }).sort((left, right) => left.modifiedAt - right.modifiedAt || left.id.localeCompare(right.id))

    const eligible = []
    let projectedCount = remaining
    for (const candidate of candidates) {
      if (eligible.length >= HISTORY_MAX_RECORDS_PER_BATCH || projectedCount <= HISTORY_OBJECT_TARGET || !canContinue()) break
      let record: DeviceSnapshotRecord
      try {
        record = await readRecord(store, baseObjectName, candidate.id)
      } catch {
        continue
      }
      // Recent uploads can still branch from an older snapshot. Use the versions already
      // superseded at the earlier observation to keep those potential merge bases available.
      const replacement = cutoffBasis.versions[record.deviceId]
      if (record.rootId !== tip.rootId || !replacement || replacement.sequence <= record.versions[record.deviceId].sequence ||
        !includesVersions(cutoffBasis.versions, record.versions)) continue
      eligible.push(candidate)
      projectedCount -= candidate.pair.snapshot ? 2 : 1
    }
    if (!eligible.length || !canContinue()) return { removed, remaining }

    const refreshed = await readDeviceIndices(store, baseObjectName)
    if (refreshed.tips.length !== 1 || refreshed.tips[0].id !== expectedHeadId ||
      refreshed.indices.length !== indices.length || refreshed.indices.some((index) => !protectedIds.has(index.id))) {
      return { removed, remaining }
    }
    for (const { pair } of eligible) {
      for (const item of [pair.snapshot, pair.record]) {
        if (!item) continue
        if (!canContinue()) return { removed, remaining }
        const result = await store.deleteObject(item.name)
        if (result.status !== RemoteVaultStatus.Success && result.status !== RemoteVaultStatus.NotFound) {
          throw new Error(String(result.content || '无法删除旧同步对象'))
        }
        removed += 1
        remaining -= 1
      }
    }
    return { removed, remaining }
  } catch (error) {
    return { removed, remaining, error: error instanceof Error ? error.message : String(error) }
  }
}

type DeviceHistoryObject = { name: string; modifiedAt: number }
type DeviceHistoryPair = { record?: DeviceHistoryObject; snapshot?: DeviceHistoryObject }

async function listDeviceHistory(store: RemoteVaultStore, prefix: string): Promise<Map<string, DeviceHistoryPair>> {
  const history = new Map<string, DeviceHistoryPair>()
  const cursors = new Set<string>()
  let cursor = ''
  do {
    const result = await store.listObjects(prefix, 100, cursor)
    if (result.status !== RemoteVaultStatus.Success || !Array.isArray(result.content)) {
      throw new Error(String(result.content || '无法读取同步历史列表'))
    }
    for (const item of result.content) {
      if (!item.name.startsWith(prefix)) throw new Error('同步历史对象位于协议目录之外')
      const relativeName = item.name.slice(prefix.length)
      const snapshot = /^snapshots\/([a-f0-9]{32})\.vault$/.exec(relativeName)
      const version = /^versions\/([a-f0-9]{32})\.json$/.exec(relativeName)
      const id = snapshot?.[1] ?? version?.[1]
      if (!id) continue
      const pair = history.get(id) ?? {}
      const kind = snapshot ? 'snapshot' : 'record'
      if (pair[kind]) throw new Error('同步历史列表包含重复对象')
      pair[kind] = { name: item.name, modifiedAt: Date.parse(item.lastModified) }
      history.set(id, pair)
    }
    cursor = result.nextCursor || ''
    if (cursor && cursors.has(cursor)) throw new Error('同步历史分页游标重复')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return history
}

async function readDeviceIndices(store: RemoteVaultStore, baseObjectName: string) {
  const prefix = `${deviceVaultPrefix(baseObjectName)}heads/`
  const cache = vaultCache(store, baseObjectName)
  const listed = new Map<string, string>()
  const cursors = new Set<string>()
  let cursor = ''
  do {
    const response = await store.listObjects(prefix, 100, cursor)
    if (response.status !== RemoteVaultStatus.Success || !Array.isArray(response.content)) {
      throw new Error(String(response.content || '无法读取设备索引列表'))
    }
    for (const item of response.content) {
      if (!item.name.startsWith(prefix)) throw new Error('设备索引位于协议目录之外')
      const deviceId = item.name.slice(prefix.length, -'.json'.length)
      if (!item.name.endsWith('.json') || !ID_RE.test(deviceId) || listed.has(deviceId)) throw new Error('设备索引名称无效')
      listed.set(deviceId, normalizeEtag(item.etag))
    }
    if (listed.size > MAX_DEVICES) throw new Error('同步设备数量超过上限')
    cursor = response.nextCursor || ''
    if (cursor && cursors.has(cursor)) throw new Error('设备索引分页游标重复')
    if (cursor) cursors.add(cursor)
  } while (cursor)

  const indices = await Promise.all([...listed.entries()].map(async ([deviceId, etag]) => {
    const cached = cache.indices.get(deviceId)
    if (etag && cached?.etag === etag) return cached.record
    const objectName = `${prefix}${deviceId}.json`
    const response = await store.readObject(objectName, MAX_RECORD_BYTES)
    if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
      throw new Error(`无法读取设备索引 ${objectName}`)
    }
    const record = parseRecord(response.content)
    if (record.deviceId !== deviceId) throw new Error('设备索引内容与路径不匹配')
    if (cached && !includesVersions(record.versions, cached.record.versions)) {
      throw new Error('设备索引版本回退，已停止同步')
    }
    const responseTag = normalizeEtag(response.etag)
    cache.indices.set(deviceId, { etag: responseTag || etag, record })
    rememberRecord(cache, record)
    return record
  }))
  if (indices.some((record) => record.rootId !== indices[0].rootId)) {
    throw new Error('发现多个独立初始化的云端保险库，已停止自动同步')
  }
  const combined = joinVersions(indices)
  for (const [deviceId, version] of Object.entries(combined)) {
    if (!indices.some((item) => item.deviceId === deviceId && item.id === version.id)) {
      throw new Error('云端设备索引缺失或在分页期间发生变化，请重新同步')
    }
  }
  if ([...cache.indices.keys()].some((deviceId) => !listed.has(deviceId))) {
    throw new Error('已知设备索引缺失，已停止自动同步')
  }
  const tips = indices.filter((record) => !indices.some((other) =>
    other.id !== record.id && includesVersions(other.versions, record.versions)
  )).sort((left, right) => left.id.localeCompare(right.id))
  if (indices.length && !tips.length) throw new Error('云端设备版本关系无有效分支')
  return { indices, tips }
}

function joinVersions(records: DeviceSnapshotRecord[]): DeviceVersions {
  const result: DeviceVersions = Object.create(null)
  for (const record of records) {
    for (const [deviceId, version] of Object.entries(record.versions)) {
      const previous = result[deviceId]
      if (previous?.sequence === version.sequence && previous.id !== version.id) {
        throw new Error('同一设备版本引用了不同的快照')
      }
      if (!previous || previous.sequence < version.sequence) result[deviceId] = version
    }
  }
  return result
}

function includesVersions(available: DeviceVersions, required: DeviceVersions): boolean {
  return Object.entries(required).every(([deviceId, version]) => {
    const current = available[deviceId]
    return current && (current.sequence > version.sequence || (current.sequence === version.sequence && current.id === version.id))
  })
}

async function writeImmutableObject(store: RemoteVaultStore, name: string, content: string, maxBytes?: number) {
  const written = await store.writeObject(name, content, 'application/json', { forbidOverwrite: true })
  if (written.status !== RemoteVaultStatus.Success) throw new Error(String(written.content || '写入加密快照失败'))
  const verified = await store.readObject(name, maxBytes)
  if (verified.status !== RemoteVaultStatus.Success || verified.content !== content) {
    throw new Error('远端快照或版本记录写入后校验失败')
  }
}

async function readRecord(store: RemoteVaultStore, baseObjectName: string, id: string): Promise<DeviceSnapshotRecord> {
  const cache = vaultCache(store, baseObjectName)
  const cached = cache.records.get(id)
  if (cached) return cached
  const response = await store.readObject(`${deviceVaultPrefix(baseObjectName)}versions/${id}.json`, MAX_RECORD_BYTES)
  if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
    throw new Error('无法读取同步版本记录')
  }
  const record = parseRecord(response.content)
  if (record.id !== id) throw new Error('同步版本记录的标识不匹配')
  rememberRecord(cache, record)
  return record
}

async function readSnapshot(store: RemoteVaultStore, baseObjectName: string, record: DeviceSnapshotRecord): Promise<string> {
  const cache = vaultCache(store, baseObjectName)
  const cached = cache.snapshots.get(record.id)
  if (cached !== undefined) {
    if (cache.records.get(record.id)?.contentSha256 !== record.contentSha256) throw new Error('远端快照的摘要已变化')
    cache.snapshots.delete(record.id)
    cache.snapshots.set(record.id, cached)
    return cached
  }
  const response = await store.readObject(`${deviceVaultPrefix(baseObjectName)}snapshots/${record.id}.vault`)
  if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string' || await sha256Hex(response.content) !== record.contentSha256) {
    throw new Error('远端加密快照不可读或摘要不匹配')
  }
  rememberRecord(cache, record)
  rememberSnapshot(cache, record.id, response.content)
  return response.content
}

function validDeviceVersions(versions: unknown): versions is DeviceVersions {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return false
  const entries = Object.entries(versions)
  return entries.length > 0 && entries.length <= MAX_DEVICES && entries.every(([deviceId, version]) =>
    ID_RE.test(deviceId) && version && typeof version.id === 'string' && ID_RE.test(version.id) &&
    Number.isSafeInteger(version.sequence) && version.sequence > 0
  )
}

function parseRecord(text: string): DeviceSnapshotRecord {
  const record = JSON.parse(text) as DeviceSnapshotRecord
  if (!record || record.protocol !== PROTOCOL || typeof record.id !== 'string' || !ID_RE.test(record.id) ||
    typeof record.deviceId !== 'string' || !ID_RE.test(record.deviceId) || typeof record.rootId !== 'string' || !ID_RE.test(record.rootId) ||
    typeof record.contentSha256 !== 'string' || !SHA256_RE.test(record.contentSha256) || !validDeviceVersions(record.versions)) {
    throw new Error('设备索引或版本记录格式无效')
  }
  const ownVersion = record.versions[record.deviceId]
  if (ownVersion?.id !== record.id ||
    (record.rootId === record.id && (Object.keys(record.versions).length !== 1 || ownVersion.sequence !== 1))) {
    throw new Error('设备因果版本记录无效')
  }
  const previousIds = record.previousPublishedIds
  if (previousIds !== undefined && (!Array.isArray(previousIds) || previousIds.length > MAX_PREVIOUS_PUBLISHED_IDS ||
    previousIds.length >= ownVersion.sequence || new Set(previousIds).size !== previousIds.length ||
    previousIds.some((id) => typeof id !== 'string' || !ID_RE.test(id) || id === record.id))) {
    throw new Error('设备已发布快照记录无效')
  }
  return record
}

function vaultCache(store: RemoteVaultStore, baseObjectName: string): VaultCache {
  let caches = sharedCaches
  if (!store.cacheScope) {
    caches = unscopedCaches.get(store) ?? new Map<string, VaultCache>()
    unscopedCaches.set(store, caches)
  }
  const key = JSON.stringify([store.cacheScope, baseObjectName])
  let entry = caches.get(key)
  if (!entry) entry = { indices: new Map(), records: new Map(), snapshots: new Map(), snapshotBytes: 0 }
  caches.delete(key)
  caches.set(key, entry)
  if (caches.size > 2) caches.delete(caches.keys().next().value!)
  return entry
}

function rememberRecord(cache: VaultCache, record: DeviceSnapshotRecord) {
  const { protocol, id, deviceId, rootId, versions, previousPublishedIds, contentSha256 } = record
  const metadata = { protocol, id, deviceId, rootId, versions, previousPublishedIds, contentSha256 }
  const previous = cache.records.get(id)
  if (previous && JSON.stringify(previous) !== JSON.stringify(metadata)) throw new Error('不可变版本记录已变化')
  cache.records.delete(id)
  cache.records.set(id, metadata)
  if (cache.records.size > 512) {
    const oldest = cache.records.keys().next().value!
    cache.records.delete(oldest)
    const snapshot = cache.snapshots.get(oldest)
    if (snapshot !== undefined) {
      cache.snapshotBytes -= snapshot.length * 2
      cache.snapshots.delete(oldest)
    }
  }
}

function rememberSnapshot(cache: VaultCache, id: string, content: string) {
  const previous = cache.snapshots.get(id)
  if (previous !== undefined) cache.snapshotBytes -= previous.length * 2
  cache.snapshots.delete(id)
  cache.snapshots.set(id, content)
  cache.snapshotBytes += content.length * 2
  while (cache.snapshotBytes > MAX_CACHED_SNAPSHOT_BYTES) {
    const oldest = cache.snapshots.keys().next().value!
    cache.snapshotBytes -= cache.snapshots.get(oldest)!.length * 2
    cache.snapshots.delete(oldest)
  }
}

function normalizeEtag(etag?: string): string {
  return etag?.trim().replace(/^"|"$/g, '') ?? ''
}
