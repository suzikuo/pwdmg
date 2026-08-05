import {
  RemoteVaultStatus,
  type RemoteVaultObjectInfo,
  type RemoteVaultStore
} from '../cloud/remoteVaultStore.ts'
import { canonicalJson } from './canonicalJson.ts'

const PROTOCOL = 'mypwdmg-sync-v3'
const MAX_COMMIT_RECORD_BYTES = 64 * 1024
const MAX_HISTORY_ITEMS = 10_000
const MAX_EPOCH_MILLISECONDS = 9_999_999_999_999
const COMMIT_ID_RE = /^\d{13}-[A-Za-z0-9-]{8,64}$/
const SHA256_RE = /^[a-f0-9]{64}$/

export type RemoteVaultHead = {
  id: string
  content: string
  revision: string
  commitId?: string
  sourceObjectName: string
}

export type AppendOnlyVaultRead = {
  status: 'success' | 'not-found' | 'conflict' | 'error'
  heads: RemoteVaultHead[]
  protocolCommitIds: string[]
  message: string
}

export type AppendOnlyVaultWrite = {
  status: 'success' | 'conflict' | 'error'
  commitId?: string
  revision?: string
  message: string
}

export type AppendOnlyVaultOptions = {
  legacyObjectNames?: string[]
}

export type AppendOnlyVaultWriteOptions = AppendOnlyVaultOptions & {
  expectedHeadIds?: string[]
  clientId?: string
  now?: () => number
  randomId?: () => string
}

type RemoteCommit = {
  protocol: typeof PROTOCOL
  id: string
  generationObjectName: string
  contentSha256: string
  parentCommitIds: string[]
  legacyFingerprints: Record<string, string>
  createdAt: number
  clientId: string
}

export async function loadAppendOnlyVault(
  store: RemoteVaultStore,
  baseObjectName: string,
  options: AppendOnlyVaultOptions = {}
): Promise<AppendOnlyVaultRead> {
  try {
    const commits = await loadCommitHistory(store, baseObjectName)
    const legacyNames = normalizeLegacyNames(baseObjectName, options.legacyObjectNames)
    const legacy = await loadLegacyHeads(store, legacyNames)
    if (legacy.status === 'error') return legacy

    if (!commits.length) return collapseHeads(legacy.heads, [])

    const referenced = new Set(commits.flatMap((commit) => commit.parentCommitIds))
    const tips = commits.filter((commit) => !referenced.has(commit.id))
    if (!tips.length) return errorRead('远端提交历史无有效头节点')

    const protocolHeads = await Promise.all(tips.map((commit) => loadGeneration(store, baseObjectName, commit)))
    const failed = protocolHeads.find((head) => typeof head === 'string')
    if (failed) return errorRead(failed)

    const divergentLegacy = legacy.heads.filter((head) => {
      const baselines = new Set(tips.map((commit) => commit.legacyFingerprints[head.sourceObjectName] || 'missing'))
      return !baselines.has(head.revision)
    })
    for (const objectName of legacyNames) {
      if (legacy.heads.some((head) => head.sourceObjectName === objectName)) continue
      const baselines = new Set(tips.map((commit) => commit.legacyFingerprints[objectName] || 'missing'))
      if (!baselines.has('missing')) {
        return errorRead(`旧版远端对象 ${objectName} 在迁移后被删除，已停止自动同步`)
      }
    }

    return collapseHeads(
      [...protocolHeads as RemoteVaultHead[], ...divergentLegacy],
      tips.map((commit) => commit.id).sort()
    )
  } catch (error) {
    return errorRead(error instanceof Error ? error.message : String(error))
  }
}

export async function appendRemoteVaultCommit(
  store: RemoteVaultStore,
  baseObjectName: string,
  content: string,
  options: AppendOnlyVaultWriteOptions = {}
): Promise<AppendOnlyVaultWrite> {
  const current = await loadAppendOnlyVault(store, baseObjectName, options)
  if (current.status === 'error') return { status: 'error', message: current.message }

  const currentHeadIds = current.heads.map((head) => head.id).sort()
  if (options.expectedHeadIds && !sameStringSet(currentHeadIds, options.expectedHeadIds)) {
    return { status: 'conflict', message: '远端提交头已变化，请重新同步后再上传' }
  }
  if (current.status === 'conflict' && !options.expectedHeadIds) {
    return { status: 'conflict', message: current.message }
  }

  const now = options.now?.() ?? Date.now()
  const randomId = sanitizeRandomId(options.randomId?.() || crypto.randomUUID?.() || randomFallback())
  const commitId = `${String(MAX_EPOCH_MILLISECONDS - Math.max(0, Math.min(MAX_EPOCH_MILLISECONDS, Math.floor(now)))).padStart(13, '0')}-${randomId}`
  const generationObjectName = `${generationPrefix(baseObjectName)}${commitId}.vault`
  const commitObjectName = `${commitPrefix(baseObjectName)}${commitId}.json`
  const contentSha256 = await sha256Text(content)

  const generationWrite = await store.writeObject(
    generationObjectName,
    content,
    'application/json',
    { forbidOverwrite: true }
  )
  if (generationWrite.status === RemoteVaultStatus.Conflict) {
    return { status: 'conflict', message: '远端代际标识发生碰撞，请重试' }
  }
  if (generationWrite.status !== RemoteVaultStatus.Success) {
    return { status: 'error', message: String(generationWrite.content || '写入远端代际失败') }
  }

  const generationVerification = await store.readObject(generationObjectName)
  if (
    generationVerification.status !== RemoteVaultStatus.Success ||
    typeof generationVerification.content !== 'string' ||
    await sha256Text(generationVerification.content) !== contentSha256
  ) {
    return { status: 'error', message: '远端代际写入后校验失败；原始代际已保留用于恢复' }
  }

  const legacyFingerprints = await snapshotLegacyFingerprints(
    store,
    normalizeLegacyNames(baseObjectName, options.legacyObjectNames)
  )
  if (typeof legacyFingerprints === 'string') return { status: 'error', message: legacyFingerprints }

  const commit: RemoteCommit = {
    protocol: PROTOCOL,
    id: commitId,
    generationObjectName,
    contentSha256,
    parentCommitIds: current.protocolCommitIds,
    legacyFingerprints,
    createdAt: Math.floor(now),
    clientId: normalizeClientId(options.clientId || 'unknown-client')
  }
  const commitText = canonicalJson(commit)
  const commitWrite = await store.writeObject(
    commitObjectName,
    commitText,
    'application/json',
    { forbidOverwrite: true }
  )
  if (commitWrite.status === RemoteVaultStatus.Conflict) {
    return { status: 'conflict', message: '远端提交标识发生碰撞；代际已保留用于恢复' }
  }
  if (commitWrite.status !== RemoteVaultStatus.Success) {
    return { status: 'error', message: `${String(commitWrite.content || '提交远端代际失败')}；代际已保留用于恢复` }
  }

  const commitVerification = await store.readObject(commitObjectName, MAX_COMMIT_RECORD_BYTES)
  if (
    commitVerification.status !== RemoteVaultStatus.Success ||
    commitVerification.content !== commitText
  ) {
    return { status: 'error', message: '远端提交记录写入后校验失败；代际已保留用于恢复' }
  }

  return { status: 'success', commitId, revision: contentSha256, message: '远端不可变提交已创建' }
}

export function appendOnlyObjectPrefixes(baseObjectName: string) {
  return {
    commits: commitPrefix(baseObjectName),
    generations: generationPrefix(baseObjectName)
  }
}

async function loadCommitHistory(store: RemoteVaultStore, baseObjectName: string): Promise<RemoteCommit[]> {
  const objects = await listAllObjects(store, commitPrefix(baseObjectName))
  const commits: RemoteCommit[] = []
  for (const object of objects) {
    const id = commitIdFromObjectName(baseObjectName, object.name)
    if (!id) throw new Error(`远端提交记录名称无效: ${object.name}`)
    const response = await store.readObject(object.name, MAX_COMMIT_RECORD_BYTES)
    if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
      throw new Error(`无法读取远端提交记录: ${object.name}`)
    }
    commits.push(parseCommit(response.content, baseObjectName, id))
  }
  const duplicateIds = commits.length !== new Set(commits.map((commit) => commit.id)).size
  if (duplicateIds) throw new Error('远端提交历史包含重复标识')
  return commits
}

async function listAllObjects(store: RemoteVaultStore, prefix: string): Promise<RemoteVaultObjectInfo[]> {
  const objects: RemoteVaultObjectInfo[] = []
  let cursor = ''
  const seenCursors = new Set<string>()
  do {
    const response = await store.listObjects(prefix, 100, cursor)
    if (response.status !== RemoteVaultStatus.Success || !Array.isArray(response.content)) {
      throw new Error(String(response.content || '无法列出远端提交历史'))
    }
    objects.push(...response.content.filter((item) => item.name.startsWith(prefix)))
    if (objects.length > MAX_HISTORY_ITEMS) throw new Error('远端提交历史超过安全扫描上限')
    cursor = response.nextCursor || ''
    if (cursor && seenCursors.has(cursor)) throw new Error('远端提交历史分页游标重复')
    if (cursor) seenCursors.add(cursor)
  } while (cursor)
  return objects
}

async function loadLegacyHeads(
  store: RemoteVaultStore,
  objectNames: string[]
): Promise<AppendOnlyVaultRead> {
  const heads: RemoteVaultHead[] = []
  for (const objectName of objectNames) {
    const response = await store.readObject(objectName)
    if (response.status === RemoteVaultStatus.NotFound) continue
    if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
      return errorRead(String(response.content || `无法读取旧版远端对象 ${objectName}`))
    }
    const revision = response.revision || await sha256Text(response.content)
    heads.push({
      id: `legacy:${objectName}:${revision}`,
      content: response.content,
      revision,
      sourceObjectName: objectName
    })
  }
  return { status: heads.length ? 'success' : 'not-found', heads, protocolCommitIds: [], message: '' }
}

async function loadGeneration(
  store: RemoteVaultStore,
  baseObjectName: string,
  commit: RemoteCommit
): Promise<RemoteVaultHead | string> {
  if (!commit.generationObjectName.startsWith(generationPrefix(baseObjectName))) {
    return `远端提交 ${commit.id} 引用了协议目录外的对象`
  }
  const response = await store.readObject(commit.generationObjectName)
  if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
    return `远端提交 ${commit.id} 的代际对象不可读`
  }
  if (await sha256Text(response.content) !== commit.contentSha256) {
    return `远端提交 ${commit.id} 的代际摘要不匹配`
  }
  return {
    id: commit.id,
    commitId: commit.id,
    content: response.content,
    revision: commit.contentSha256,
    sourceObjectName: commit.generationObjectName
  }
}

async function snapshotLegacyFingerprints(
  store: RemoteVaultStore,
  objectNames: string[]
): Promise<Record<string, string> | string> {
  const result: Record<string, string> = {}
  for (const objectName of objectNames) {
    const response = await store.readObject(objectName)
    if (response.status === RemoteVaultStatus.NotFound) result[objectName] = 'missing'
    else if (response.status === RemoteVaultStatus.Success && typeof response.content === 'string') {
      result[objectName] = response.revision || await sha256Text(response.content)
    } else return String(response.content || `无法检查旧版远端对象 ${objectName}`)
  }
  return result
}

function parseCommit(text: string, baseObjectName: string, expectedId: string): RemoteCommit {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`远端提交 ${expectedId} 不是有效 JSON`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`远端提交 ${expectedId} 格式无效`)
  const value = raw as Record<string, unknown>
  const allowed = new Set([
    'protocol', 'id', 'generationObjectName', 'contentSha256', 'parentCommitIds',
    'legacyFingerprints', 'createdAt', 'clientId'
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`远端提交 ${expectedId} 包含未知字段`)
  if (value.protocol !== PROTOCOL || value.id !== expectedId || !COMMIT_ID_RE.test(expectedId)) {
    throw new Error(`远端提交 ${expectedId} 标识无效`)
  }
  if (typeof value.generationObjectName !== 'string' || !value.generationObjectName.startsWith(generationPrefix(baseObjectName))) {
    throw new Error(`远端提交 ${expectedId} 的代际路径无效`)
  }
  if (typeof value.contentSha256 !== 'string' || !SHA256_RE.test(value.contentSha256)) {
    throw new Error(`远端提交 ${expectedId} 的摘要无效`)
  }
  if (!Array.isArray(value.parentCommitIds) || value.parentCommitIds.some((id) => typeof id !== 'string' || !COMMIT_ID_RE.test(id))) {
    throw new Error(`远端提交 ${expectedId} 的父提交无效`)
  }
  if (!value.legacyFingerprints || typeof value.legacyFingerprints !== 'object' || Array.isArray(value.legacyFingerprints)) {
    throw new Error(`远端提交 ${expectedId} 的迁移基线无效`)
  }
  const legacyFingerprints: Record<string, string> = {}
  for (const [name, fingerprint] of Object.entries(value.legacyFingerprints as Record<string, unknown>)) {
    if (!name || (fingerprint !== 'missing' && (typeof fingerprint !== 'string' || !SHA256_RE.test(fingerprint)))) {
      throw new Error(`远端提交 ${expectedId} 的迁移基线无效`)
    }
    legacyFingerprints[name] = fingerprint as string
  }
  if (!Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0 || typeof value.clientId !== 'string') {
    throw new Error(`远端提交 ${expectedId} 的元数据无效`)
  }
  return {
    protocol: PROTOCOL,
    id: expectedId,
    generationObjectName: value.generationObjectName,
    contentSha256: value.contentSha256,
    parentCommitIds: [...new Set(value.parentCommitIds as string[])].sort(),
    legacyFingerprints,
    createdAt: Number(value.createdAt),
    clientId: normalizeClientId(value.clientId)
  }
}

function collapseHeads(heads: RemoteVaultHead[], protocolCommitIds: string[]): AppendOnlyVaultRead {
  const unique = new Map<string, RemoteVaultHead>()
  for (const head of heads) if (!unique.has(head.revision)) unique.set(head.revision, head)
  const values = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
  if (!values.length) return { status: 'not-found', heads: [], protocolCommitIds, message: '远端保险库不存在' }
  if (values.length === 1) return { status: 'success', heads: values, protocolCommitIds, message: '' }
  return {
    status: 'conflict',
    heads: values,
    protocolCommitIds,
    message: `检测到 ${values.length} 个并发远端分支；所有加密代际均已保留`
  }
}

function errorRead(message: string): AppendOnlyVaultRead {
  return { status: 'error', heads: [], protocolCommitIds: [], message }
}

function normalizeLegacyNames(baseObjectName: string, values?: string[]): string[] {
  return [...new Set((values?.length ? values : [baseObjectName]).map((value) => value.trim()).filter(Boolean))]
}

function commitPrefix(baseObjectName: string): string {
  return `${baseObjectName}.sync-v3/commits/`
}

function generationPrefix(baseObjectName: string): string {
  return `${baseObjectName}.sync-v3/generations/`
}

function commitIdFromObjectName(baseObjectName: string, objectName: string): string {
  const prefix = commitPrefix(baseObjectName)
  return objectName.startsWith(prefix) && objectName.endsWith('.json')
    ? objectName.slice(prefix.length, -'.json'.length)
    : ''
}

function normalizeClientId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128)
  return normalized || 'unknown-client'
}

function sanitizeRandomId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)
  return normalized.length >= 8 ? normalized : `${normalized}${randomFallback()}`.slice(0, 16)
}

function randomFallback(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
