import { toRaw } from 'vue'
import type {
  CloudBackupInfo,
  CloudOperationHandle,
  CloudOperationStage,
  CloudSyncLogEntry,
  CloudSyncLogStatus
} from '../../composables/useCloudSync.ts'
import { DEFAULT_OSS_OBJECT_NAME, normalizeObjectName } from '../aliyunOss.ts'
import { api } from '../api.ts'
import {
  clearCloudEncryptionBinding,
  rememberCloudEncryptionBinding
} from '../cloudEncryptionBinding.ts'
import { createAliyunOssVaultStore } from '../cloud/aliyunOssVaultStore.ts'
import {
  RemoteVaultStatus,
  type RemoteVaultObjectInfo,
  type RemoteVaultResult,
  type RemoteVaultStore
} from '../cloud/remoteVaultStore.ts'
import {
  DEVICE_HISTORY_CLEANUP_THRESHOLD,
  DEVICE_HISTORY_GRACE_MS,
  deviceVaultPrefix,
  estimateDeviceVaultHistory,
  loadDeviceVault,
  loadDeviceVaultCommonAncestor,
  makeDeviceCheckpointBasis,
  normalizeDeviceCheckpointBasis,
  pruneDeviceVaultHistory,
  validateDeviceVaultCheckpoint,
  type DeviceCheckpointBasis,
  type DeviceHistoryObservation,
  type DeviceVaultRead
} from './deviceRemoteVault.ts'
import { publishLocalDeviceVault } from './deviceSyncWriter.ts'
import { recordPermanentEntryDeletions } from '../entryTombstones.ts'
import { canonicalJson } from './canonicalJson.ts'
import {
  autoCloudSyncManualReviewLabels,
  comparableCloudSyncEntry,
  cloudSyncDiffCountsForItems,
  cloudSyncSelectionStats,
  type CloudSyncChangeDetail,
  type CloudSyncDiffItem,
  type CloudSyncDirection,
  type CloudSyncPreview
} from './legacyDiff.ts'
import { validateLegacyRemoteObjectRevision } from './legacyRemoteValidation.ts'
import {
  buildCloudSyncTargetPayload,
  createCloudSyncPlan,
  hasLocalCloudChanges,
  isCloudSyncDownloadTargetApplied
} from './cloudSyncPlan.ts'
import { readSyncCheckpoint, writeSyncCheckpoint } from './syncCheckpointStore.ts'
import { mergeVaultPayloads } from './threeWayVaultMerge.ts'
import {
  ensureLocalAttachmentObjects,
  ensureRemoteAttachmentObjects
} from './attachmentObjectSync.ts'
import {
  canonicalVaultReadCandidates,
  passkeyStateFingerprint,
  versionedVaultObjectName
} from './passkeyRemoteGate.ts'
import { AutoSyncPasswordGate } from '../autoSyncPasswordGate.ts'
import {
  formatBytes,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
  type UiFeedback
} from '../runtime.ts'
import type { ApiResult, VaultEntry, VaultPayload } from '../../types.ts'

export const LEGACY_CLOUD_SYNC_STATE_KEY = 'mypwdmg.cloudSyncState.v1'
export const CLOUD_SYNC_STATE_KEY = 'mypwdmg.cloudSyncState.v2'
export const AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES = 1
export const AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES = 1
export const AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES = 1440
export const CLOUD_SYNC_VALIDATION_TIMEOUT_MS = 60_000

export type CloudSyncStateRecord = {
  remoteUpdatedAt: number
  remoteFingerprint: string
  localFingerprint: string
  recordedAt: number
}

export type CloudVaultRead = {
  objectName: string
  response: RemoteVaultResult<string>
  managedRemote: boolean
  remoteHeadIds: string[]
  deviceRead?: DeviceVaultRead
}

export type CloudSyncRemoteSnapshot = {
  payload: VaultPayload
  envelopeText: string
  sourceEnvelopeText: string
  usedAlternatePassword: boolean
  alternatePassword?: string
}

export type CloudEncryptionAdoptionResult =
  | { ok: true; payload: VaultPayload; deviceUnlockWarning: string }
  | { ok: false; message: string }

export type CloudSyncReviewOptions = {
  automatic?: boolean
  skipPersist?: boolean
  objectName?: string
}

export type CloudSyncApplyOptions = {
  operation?: CloudOperationHandle | null
  closeReview?: boolean
  clearPreview?: boolean
  showSuccess?: boolean
  showErrors?: boolean
  successMessage?: string
}

export type CloudSyncPreviewValidation =
  | { ok: true; message: ''; currentLocal: VaultPayload; localAlreadyApplied: boolean }
  | { ok: false; message: string }

export type CloudSyncApplyContext = {
  preview: CloudSyncPreview
  selectedItems: CloudSyncDiffItem[]
  options: CloudSyncApplyOptions
  remoteClient: RemoteVaultStore
  nextPayload: VaultPayload
  currentLocal: VaultPayload
  localAlreadyApplied: VaultPayload | null
  previewStats: ReturnType<typeof cloudSyncSelectionStats>
  selectedStats: ReturnType<typeof cloudSyncSelectionStats>
}

export type CloudRewritePlan = {
  objectName: string
  remoteHeadIds: string[]
}

export type OssSettingsState = VaultPayload['settings']['oss']

// ---- Pure Normalization & Formatting Helpers ----

export function normalizeAutoSyncIntervalMinutes(value: unknown): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES
  return Math.min(
    Math.max(Math.round(numberValue), AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES),
    AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES
  )
}

export function normalizeSettings(
  nextSettings?: Partial<VaultPayload['settings']> | { oss: OssSettingsState }
): VaultPayload['settings'] {
  const oss = (nextSettings?.oss || {}) as Partial<OssSettingsState>
  const rawObjectName = String(oss.objectName || '').trim()
  const objectName = !rawObjectName || rawObjectName === 'mypwdmg-vault.json'
    ? DEFAULT_OSS_OBJECT_NAME
    : normalizeObjectName(rawObjectName)
  return {
    oss: {
      bucketName: String(oss.bucketName || '').trim(),
      accessKeyId: String(oss.accessKeyId || '').trim(),
      accessKeySecret: String(oss.accessKeySecret || ''),
      region: String(oss.region || '').trim(),
      objectName,
      autoSync: oss.autoSync === true,
      autoSyncIntervalMinutes: normalizeAutoSyncIntervalMinutes(oss.autoSyncIntervalMinutes)
    }
  }
}

export function isVaultPasswordChangedResult(result: ApiResult<unknown>): boolean {
  const message = `${result.code || ''} ${result.message || ''}`
  return result.code === 'BAD_PASSWORD' || /vault password changed|wrong password|decrypt|corrupt|tag mismatch/i.test(message)
}

export function resolveBackupDirectory(objectName: string): string {
  const normalized = normalizeObjectName(objectName)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash >= 0) {
    const dir = normalized.slice(0, lastSlash)
    return `${dir}/backup/`
  }
  return 'pwd/backup/'
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

export function makeDatedBackupName(fileName: string): string {
  const objectName = normalizeObjectName(fileName)
  const lastSlash = objectName.lastIndexOf('/')
  const baseName = lastSlash >= 0 ? objectName.slice(lastSlash + 1) : objectName
  const backupDir = resolveBackupDirectory(objectName)
  const now = new Date()
  const datePart = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate())
  ].join('-')
  const timePart = [padDatePart(now.getHours()), padDatePart(now.getMinutes()), padDatePart(now.getSeconds())].join('')
  const millisecondPart = String(now.getMilliseconds()).padStart(3, '0')
  return `${backupDir}${baseName}.${datePart}-${timePart}-${millisecondPart}`
}

export function toCloudBackupInfo(value: RemoteVaultObjectInfo): CloudBackupInfo {
  return {
    name: value.name,
    exists: Boolean(value.exists),
    size: Number(value.size || 0),
    lastModified: value.lastModified || ''
  }
}

export function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

export async function sha256Text(value: string): Promise<string> {
  if (!crypto.subtle) throw new Error('当前环境不支持安全的 SHA-256 同步摘要')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function cloudSyncEntryFingerprint(entry: VaultEntry): unknown {
  return {
    id: entry.id || '',
    ...comparableCloudSyncEntry(entry),
    children: (entry.children || []).map(cloudSyncEntryFingerprint)
  }
}

export async function cloudSyncPayloadFingerprint(payload: VaultPayload): Promise<string> {
  return sha256Text(canonicalJson({
    version: payload.version,
    passkeySchemaVersion: payload.passkeySchemaVersion,
    attachmentKey: payload.attachmentKey,
    entries: (payload.entries || []).map(cloudSyncEntryFingerprint),
    entryTombstones: [...new Set(payload.entryTombstones ?? [])].sort(),
    passkeyState: passkeyStateFingerprint(payload)
  }))
}

export function cloudSyncPayloadUpdatedAt(payload: VaultPayload | null | undefined): number {
  const value = Number(payload?.updatedAt || 0)
  return Number.isFinite(value) ? value : 0
}

export function isLocalPayloadNewerThanRemote(localPayload: VaultPayload, remotePayload: VaultPayload): boolean {
  const localUpdatedAt = cloudSyncPayloadUpdatedAt(localPayload)
  const remoteUpdatedAt = cloudSyncPayloadUpdatedAt(remotePayload)
  return localUpdatedAt > 0 && (remoteUpdatedAt <= 0 || localUpdatedAt > remoteUpdatedAt)
}

export function isCloudSyncItemChecked(item: CloudSyncDiffItem): boolean {
  if (item.changeType !== 'modified') return item.checked
  return item.details.length > 0 && item.details.every((detail) => detail.checked)
}

export function setCloudSyncItemChecked(item: CloudSyncDiffItem, checked: boolean): void {
  item.checked = checked
  if (item.changeType !== 'modified') return
  for (const detail of item.details) detail.checked = checked
}

export function setCloudSyncDetailChecked(item: CloudSyncDiffItem, detail: CloudSyncChangeDetail, checked: boolean): void {
  detail.checked = checked
  item.checked = item.details.length > 0 && item.details.every((itemDetail) => itemDetail.checked)
}

export function getCloudSyncSelectedItems(items: CloudSyncDiffItem[]): CloudSyncDiffItem[] {
  return items.filter((item) => (item.changeType === 'modified' ? item.details.some((detail) => detail.checked) : item.checked))
}

export function resolveAutoCloudSyncDecision(preview: CloudSyncPreview): { apply: boolean; message: string } {
  const items = preview.items
  const action = preview.direction === 'download' ? '下载' : '上传'
  if (items.some((item) => item.changeType !== 'added')) {
    const manualFields = autoCloudSyncManualReviewLabels(items)
    return {
      apply: false,
      message: manualFields.length
        ? `发现修改/删除差异（${manualFields.join('、')}），等待手动确认`
        : '发现修改/删除差异，等待手动确认'
    }
  }
  if (items.every((item) => item.changeType === 'added')) {
    return { apply: true, message: `仅新增 ${items.length} 项，已自动${action}` }
  }
  return { apply: true, message: `低风险差异 ${items.length} 项，已自动${action}` }
}

export function cloudSyncDirectionLabel(direction: CloudSyncLogEntry['direction']): string {
  if (direction === 'download') return '下载'
  if (direction === 'backup') return '备份'
  if (direction === 'history') return '历史整理'
  return '上传'
}

export function cloudSyncLogStatusLabel(status: CloudSyncLogStatus): string {
  if (status === 'started') return '开始'
  if (status === 'review') return '待确认'
  if (status === 'error') return '失败'
  if (status === 'skipped') return '跳过'
  return '完成'
}

export function cloudSyncLogTitle(item: CloudSyncLogEntry): string {
  return item.message || cloudSyncLogStatusLabel(item.status)
}

export function cloudSyncLogSummary(item: CloudSyncLogEntry): string {
  const diffText = [
    item.added ? `新增 ${item.added}` : '',
    item.modified ? `修改 ${item.modified}` : '',
    item.deleted ? `删除 ${item.deleted}` : ''
  ].filter(Boolean).join(' · ')
  const selectedText = item.selected ? `已选 ${item.selected}/${item.total || item.selected}` : ''
  const detail = [selectedText, diffText || (item.total ? `差异 ${item.total}` : '')].filter(Boolean).join(' · ')
  if (detail) return detail
  if (item.status === 'started') return '校验中'
  if (item.status === 'review') return '需要手动处理'
  if (item.status === 'error') return '校验未完成'
  if (item.status === 'skipped') return '未执行'
  return '无差异'
}

export function purgeLegacyCloudSyncState(): void {
  removeLocalStorage(LEGACY_CLOUD_SYNC_STATE_KEY)
}

function normalizeCloudSyncStateRecord(value: unknown): CloudSyncStateRecord | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<CloudSyncStateRecord>
  const remoteUpdatedAt = Number(item.remoteUpdatedAt || 0)
  const recordedAt = Number(item.recordedAt || 0)
  const remoteFingerprint = String(item.remoteFingerprint || '')
  const localFingerprint = String(item.localFingerprint || '')
  if (!isSha256(remoteFingerprint) || !isSha256(localFingerprint)) return null
  return {
    remoteUpdatedAt: Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0,
    remoteFingerprint,
    localFingerprint,
    recordedAt: Number.isFinite(recordedAt) ? recordedAt : 0
  }
}

export function loadCloudSyncStateMap(): Record<string, CloudSyncStateRecord> {
  try {
    const raw = JSON.parse(readLocalStorage(CLOUD_SYNC_STATE_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const result: Record<string, CloudSyncStateRecord> = {}
    for (const [key, value] of Object.entries(raw)) {
      const record = normalizeCloudSyncStateRecord(value)
      if (record) result[key] = record
    }
    return result
  } catch {
    return {}
  }
}

// ---- Remote Vault Store Protocol Helpers ----

export async function readCloudVaultForSync(
  client: RemoteVaultStore,
  configuredObjectName: string,
  requestedObjectName: string
): Promise<CloudVaultRead> {
  const configured = normalizeObjectName(configuredObjectName)
  const requested = normalizeObjectName(requestedObjectName)
  const v2LegacyName = versionedVaultObjectName(configured, 2)
  const canonicalRequest = requested === configured || requested === v2LegacyName
  if (!canonicalRequest) {
    return {
      objectName: requested,
      response: await client.readObject(requested),
      managedRemote: false,
      remoteHeadIds: []
    }
  }

  const deviceRead = await loadDeviceVault(client, configured)
  const head = deviceRead.heads[0]
  const status = {
    success: RemoteVaultStatus.Success,
    'not-found': RemoteVaultStatus.NotFound,
    conflict: RemoteVaultStatus.Conflict,
    error: RemoteVaultStatus.Error
  }[deviceRead.status]
  return {
    objectName: configured,
    response: status === RemoteVaultStatus.Success
      ? { status, content: head.content, revision: head.contentSha256 }
      : { status, content: deviceRead.message },
    managedRemote: true,
    remoteHeadIds: deviceRead.heads.map((item) => item.id).sort(),
    deviceRead
  }
}

export async function writeManagedCloudVault(
  client: RemoteVaultStore,
  objectName: string,
  content: string,
  expectedHeadIds: string[]
) {
  return publishLocalDeviceVault(client, normalizeObjectName(objectName), content, expectedHeadIds)
}

export async function loadCloudBackupItems(client: RemoteVaultStore, fixedName: string): Promise<CloudBackupInfo[]> {
  const backupDir = resolveBackupDirectory(fixedName)
  const v2FixedName = versionedVaultObjectName(fixedName, 2)
  const listPromises = [
    client.listObjects(backupDir, 50),
    client.listObjects(fixedName, 50)
  ]
  if (fixedName.startsWith('pwd/')) {
    listPromises.push(client.listObjects(fixedName.slice('pwd/'.length), 50))
  }
  const responses = await Promise.all(listPromises)
  const allItems: RemoteVaultObjectInfo[] = []
  for (const res of responses) {
    if (res.status === RemoteVaultStatus.Success && Array.isArray(res.content)) {
      allItems.push(...res.content)
    }
  }
  const seen = new Set<string>()
  return allItems
    .filter((item) => {
      if (!item?.name || seen.has(item.name)) return false
      seen.add(item.name)
      if (item.name === fixedName || item.name === v2FixedName) return false
      if (item.name.startsWith(deviceVaultPrefix(fixedName)) || item.name.includes('.sync-v3/') || item.name.includes('.attachments/')) return false
      if (item.name.startsWith(backupDir)) return true
      if (item.name.startsWith(`${fixedName}.`)) return true
      if (fixedName.startsWith('pwd/') && item.name.startsWith(`${fixedName.slice('pwd/'.length)}.`)) return true
      return false
    })
    .map(toCloudBackupInfo)
    .sort((left, right) => String(right.lastModified).localeCompare(String(left.lastModified)))
}

// ---- Sync Engine Orchestrator ----

export type SyncEngineDeps = {
  feedback: UiFeedback
  autoSyncPasswordGate: AutoSyncPasswordGate
  getVault: () => VaultPayload | null
  isLocked: () => boolean
  isPasswordless: () => boolean
  applyAdoptedSessionState: (appState: Record<string, unknown>, password: string) => void
  rebindDeviceUnlockAfterPasswordChange: (password: string) => Promise<string>
  refreshDeviceUnlockState: () => Promise<void>
  publishVaultPayload: (next: VaultPayload) => boolean
  saveVaultForCurrentSession: (next: VaultPayload) => Promise<ApiResult<VaultPayload>>
  handleVaultWriteError: (result: ApiResult<unknown>, fallback: string) => Promise<void>
  collectLocalAttachmentObjects: (payload: VaultPayload) => Promise<void>
  reconcileSelectedEntryAfterVaultUpdate: (payload: VaultPayload) => void
  getSessionGeneration: () => number
  captureSessionGeneration: () => number
  isSessionGenerationCurrent: (generation: number) => boolean
  // Sync store state bindings
  getSettings: () => { oss: OssSettingsState }
  syncSettings: (nextSettings?: Partial<VaultPayload['settings']>) => void
  isSettingsChanged: () => boolean
  persistSettings: (options?: { closeDrawer?: boolean; toast?: boolean; skipAutoSync?: boolean }) => Promise<boolean>
  hasCompleteOssSettings: () => boolean
  validateOssSettings: () => boolean
  isHistoryCleanupEnabled?: (scope: string) => boolean
  getSignal: () => AbortSignal | undefined
  isCloudBusy: () => boolean
  getCloudSyncPreview: () => CloudSyncPreview | null
  setCloudSyncPreview: (preview: CloudSyncPreview | null) => void
  isCloudSyncReviewOpen: () => boolean
  hasPendingCloudSyncReview: () => boolean
  showCloudSyncReview: () => void
  closeCloudSyncReview: () => void
  setBackupStatus: (message: string) => void
  setCloudInfo: (info: CloudBackupInfo | null) => void
  setCloudBackups: (backups: CloudBackupInfo[]) => void
  getSelectedCloudObjectName: () => string
  setSelectedCloudObjectName: (name: string) => void
  bumpCloudEncryptionBindingVersion: () => void
  beginCloudOperation: (
    kind?: 'inspect' | 'list' | 'backup' | 'review' | 'apply' | 'password-rewrite',
    options?: { direction?: 'upload' | 'download' | 'backup'; automatic?: boolean; message?: string }
  ) => CloudOperationHandle | null
  markCloudOperation: (operation: CloudOperationHandle | null, stage: CloudOperationStage, message?: string) => boolean
  finishCloudOperation: (
    operation: CloudOperationHandle | null,
    stage?: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'>,
    message?: string
  ) => void
  cancelCloudOperation: () => void
  appendCloudSyncLog: (input: Partial<CloudSyncLogEntry> & Pick<CloudSyncLogEntry, 'direction' | 'status' | 'objectName' | 'message'>) => void
  requestCloudVaultPassword: () => Promise<string | null>
  resolveCloudPasswordPrompt: (value: string | null) => void
  finishCloudPasswordPrompt: () => void
}

type DeviceHistoryObservations = { latest?: DeviceHistoryObservation; previous?: DeviceHistoryObservation }
type DeviceHistoryRetry = { commits: number; after?: number }

export function createSyncEngine(deps: SyncEngineDeps) {
  let cloudSyncRequestInFlight = false
  let historyCleanupInFlight = false

  function createRemoteVaultStore(): RemoteVaultStore {
    const oss = normalizeSettings(deps.getSettings()).oss
    return createAliyunOssVaultStore(oss, deps.getSignal())
  }

  function cloudSyncStateKey(objectName: string): string {
    const oss = normalizeSettings(deps.getSettings()).oss
    return JSON.stringify([oss.region, oss.bucketName, normalizeObjectName(objectName)])
  }

  function currentCloudScopeId(): string {
    const oss = normalizeSettings(deps.getSettings()).oss
    return JSON.stringify([oss.region, oss.bucketName])
  }

  function autoSyncPasswordGateKeys(...objectNames: string[]): string[] {
    return objectNames.map(cloudSyncStateKey)
  }

  function isAutoSyncPasswordBlocked(...objectNames: string[]): boolean {
    return deps.autoSyncPasswordGate.isBlocked(...autoSyncPasswordGateKeys(...objectNames))
  }

  function clearAutoSyncPasswordGate(...objectNames: string[]): void {
    deps.autoSyncPasswordGate.clear(...autoSyncPasswordGateKeys(...objectNames))
  }

  function emptyCloudPayload(): VaultPayload {
    return {
      version: 1,
      revision: 1,
      entries: [],
      passkeys: [],
      passkeyTombstones: [],
      settings: normalizeSettings(deps.getSettings()),
      updatedAt: 0
    }
  }

  function syncStateStorageKey(objectName: string, managedRemote: boolean): string {
    const scope = cloudSyncStateKey(objectName)
    return managedRemote ? `${scope}/sync-v4` : scope
  }

  function readCloudSyncState(objectName: string): CloudSyncStateRecord | null {
    return loadCloudSyncStateMap()[cloudSyncStateKey(objectName)] || null
  }

  function maybePruneCloudHistory(objectName: string, headId: string, basis: DeviceCheckpointBasis): void {
    const scope = cloudSyncStateKey(objectName)
    if (historyCleanupInFlight || !deps.isHistoryCleanupEnabled?.(scope)) return
    const generation = deps.getSessionGeneration()
    const signal = deps.getSignal()
    const canContinue = () => !signal?.aborted && !deps.isLocked() && deps.isSessionGenerationCurrent(generation) &&
      !deps.isSettingsChanged() && cloudSyncStateKey(normalizeSettings(deps.getSettings()).oss.objectName) === scope &&
      deps.isHistoryCleanupEnabled?.(scope) === true
    if (!canContinue()) return

    const observationKey = `mypwdmg.syncHistoryObservations.${scope}.${basis.rootId}`
    const now = Date.now()
    let observations: DeviceHistoryObservations = {}
    try {
      observations = JSON.parse(readLocalStorage(observationKey) || '{}') ?? {}
    } catch {
      // A fresh observation can be used once it has aged.
    }
    const validObservation = (observation: DeviceHistoryObservation | undefined) => observation &&
      Number.isSafeInteger(observation.observedAt) && observation.observedAt > 0 && observation.observedAt <= now &&
      normalizeDeviceCheckpointBasis(observation.basis, [observation.headId])
    const latest = observations.latest
    if (!latest || !validObservation(latest) || now - latest.observedAt >= DEVICE_HISTORY_GRACE_MS) {
      observations = {
        latest: { headId, basis, observedAt: now },
        previous: validObservation(latest) ? latest : undefined
      }
      writeLocalStorage(observationKey, JSON.stringify(observations))
    }
    const previous = observations.previous
    if (!previous || now - previous.observedAt < DEVICE_HISTORY_GRACE_MS || !validObservation(previous)) return

    const { commits, objects } = estimateDeviceVaultHistory(basis)
    if (objects < DEVICE_HISTORY_CLEANUP_THRESHOLD) return
    const attemptKey = `mypwdmg.syncHistoryCleanup.${scope}.${basis.rootId}`
    let retry: DeviceHistoryRetry | undefined
    try {
      retry = JSON.parse(readLocalStorage(attemptKey) || 'null') ?? undefined
    } catch {
      // An unreadable retry record does not prevent cleanup.
    }
    if (retry && commits < retry.commits && now < (retry.after ?? Infinity)) return
    const client = createRemoteVaultStore()
    historyCleanupInFlight = true
    const after = now + DEVICE_HISTORY_GRACE_MS
    writeLocalStorage(attemptKey, JSON.stringify({ commits: commits + 5, after }))
    void pruneDeviceVaultHistory(client, objectName, headId, previous, canContinue).then((result) => {
      if (result.remaining !== undefined && result.remaining < DEVICE_HISTORY_CLEANUP_THRESHOLD) {
        const delay = Math.ceil((DEVICE_HISTORY_CLEANUP_THRESHOLD - result.remaining) / 2)
        writeLocalStorage(attemptKey, JSON.stringify({ commits: commits + delay }))
      }
      if (!canContinue() || (!result.removed && !result.error)) return
      const summary = `已清理 ${result.removed} 个历史同步对象`
      deps.appendCloudSyncLog({
        direction: 'history',
        automatic: true,
        status: result.error ? 'error' : 'success',
        objectName,
        message: result.error ? `云端历史整理暂停（${summary}）：${result.error}` : summary
      })
    }).finally(() => { historyCleanupInFlight = false })
  }

  async function rememberCloudSyncState(
    objectName: string,
    remotePayload: VaultPayload,
    localPayload: VaultPayload = remotePayload,
    ancestorEnvelope = '',
    remoteHeadIds: string[] = [],
    managedRemote = false,
    deviceBasis?: DeviceCheckpointBasis
  ): Promise<void> {
    try {
      const key = syncStateStorageKey(objectName, managedRemote)
      const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
      const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
      const stateMap = loadCloudSyncStateMap()
      if (ancestorEnvelope) {
        let checkpoint = await readSyncCheckpoint(key)
        if (checkpoint?.payloadFingerprint !== remoteFingerprint || checkpoint.remoteHeadIds.join(',') !== remoteHeadIds.join(',') ||
          (deviceBasis && !checkpoint.deviceBasis)) {
          const localEnvelope = await api.exportVaultBackupForPayload(remotePayload)
          if (localEnvelope.ok && localEnvelope.data?.content) {
            checkpoint = {
              key,
              envelope: localEnvelope.data.content,
              payloadFingerprint: remoteFingerprint,
              remoteHeadIds,
              ...(deviceBasis ? { deviceBasis } : {}),
              recordedAt: Date.now()
            }
            await writeSyncCheckpoint(checkpoint)
          } else {
            checkpoint = null
          }
        }
        if (globalThis.indexedDB && checkpoint?.deviceBasis && deviceBasis && remoteHeadIds.length === 1) {
          maybePruneCloudHistory(objectName, remoteHeadIds[0], deviceBasis)
        }
      }
      stateMap[key] = {
        remoteUpdatedAt: cloudSyncPayloadUpdatedAt(remotePayload),
        remoteFingerprint,
        localFingerprint,
        recordedAt: Date.now()
      }
      writeLocalStorage(CLOUD_SYNC_STATE_KEY, JSON.stringify(stateMap))
    } catch {
      // If persistent storage fails, the next sync will require a verifiable baseline again.
    }
  }

  async function loadCloudSyncAncestor(client: RemoteVaultStore, remote: CloudVaultRead): Promise<VaultPayload | null> {
    try {
      const checkpoint = await readSyncCheckpoint(syncStateStorageKey(remote.objectName, remote.managedRemote))
      if (!checkpoint) return null
      if (remote.deviceRead && !await validateDeviceVaultCheckpoint(
        client, remote.objectName, remote.deviceRead.heads, checkpoint.remoteHeadIds, checkpoint.deviceBasis
      )) {
        return null
      }
      const preview = await api.previewVaultBackup(checkpoint.envelope)
      if (!preview.ok || !preview.data) return null
      if (await cloudSyncPayloadFingerprint(preview.data) !== checkpoint.payloadFingerprint) return null
      return preview.data
    } catch {
      return null
    }
  }

  async function shouldPreferCloudDownload(
    objectName: string,
    localPayload: VaultPayload,
    remotePayload: VaultPayload,
    localFreshnessPayload: VaultPayload
  ): Promise<boolean> {
    const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
    const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
    if (remoteFingerprint === localFingerprint) return false
    if (isLocalPayloadNewerThanRemote(localFreshnessPayload, remotePayload)) return false

    const record = readCloudSyncState(objectName)
    if (record) {
      const remoteChanged = Boolean(record.remoteFingerprint && remoteFingerprint !== record.remoteFingerprint)
      const localChanged = Boolean(record.localFingerprint && localFingerprint !== record.localFingerprint)
      return remoteChanged && !localChanged
    }

    const remoteUpdatedAt = cloudSyncPayloadUpdatedAt(remotePayload)
    const localUpdatedAt = cloudSyncPayloadUpdatedAt(localFreshnessPayload)
    return remoteUpdatedAt > 0 && localUpdatedAt > 0 && remoteUpdatedAt > localUpdatedAt
  }

  async function hasLocalCloudSyncChanges(
    objectName: string,
    localPayload: VaultPayload,
    remotePayload: VaultPayload,
    localFreshnessPayload: VaultPayload
  ): Promise<boolean> {
    const [localFingerprint, remoteFingerprint] = await Promise.all([
      cloudSyncPayloadFingerprint(localPayload),
      cloudSyncPayloadFingerprint(remotePayload)
    ])
    const record = readCloudSyncState(objectName)
    return hasLocalCloudChanges({
      localFingerprint,
      remoteFingerprint,
      checkpointLocalFingerprint: record?.localFingerprint,
      localUpdatedAt: cloudSyncPayloadUpdatedAt(localFreshnessPayload),
      remoteUpdatedAt: cloudSyncPayloadUpdatedAt(remotePayload)
    })
  }

  async function shouldSkipAutomaticCloudDownload(
    objectName: string,
    localPayload: VaultPayload,
    remotePayload: VaultPayload,
    localFreshnessPayload: VaultPayload
  ): Promise<boolean> {
    return hasLocalCloudSyncChanges(objectName, localPayload, remotePayload, localFreshnessPayload)
  }

  async function withCloudSyncTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
    let timer = 0
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => {
            deps.cancelCloudOperation()
            deps.resolveCloudPasswordPrompt(null)
            reject(new Error(`${label}超时（60 秒），请检查 OSS 配置和网络连接后重试`))
          }, CLOUD_SYNC_VALIDATION_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timer) window.clearTimeout(timer)
    }
  }

  function isSameRef<T>(left: T | null | undefined, right: T | null | undefined): boolean {
    if (left === right) return true
    if (!left || !right) return false
    return toRaw(left) === toRaw(right)
  }

  function isCloudSyncPreviewCurrent(preview: CloudSyncPreview): boolean {
    return !deps.isLocked() &&
      preview.sessionGeneration === deps.getSessionGeneration() &&
      preview.cloudScopeId === currentCloudScopeId() &&
      (!preview.managedRemote || preview.uploadObjectName === normalizeObjectName(deps.getSettings().oss.objectName))
  }

  function syncCloudSyncPreviewAfterDownload(preview: CloudSyncPreview, appliedVault: VaultPayload): boolean {
    if (deps.isLocked() || !isSameRef(deps.getVault(), appliedVault)) return false
    preview.sessionGeneration = deps.getSessionGeneration()
    preview.cloudScopeId = currentCloudScopeId()
    return true
  }
  const syncCloudSyncPreviewAfterLocalApply = syncCloudSyncPreviewAfterDownload

  async function adoptVerifiedCloudEncryption(options: {
    envelopeText: string
    password: string
    scopeKey: string
    remoteFingerprint?: string
    isCurrent?: () => boolean
  }): Promise<CloudEncryptionAdoptionResult> {
    const adopted = await api.adoptVaultEncryptionFromEnvelope(options.envelopeText, options.password)
    if (!adopted.ok || !adopted.data) {
      return {
        ok: false,
        message: adopted.message || '无法使用云端主密码绑定本地加密参数'
      }
    }
    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, message: '保险库会话已变化，请重新校验云端保险库' }
    }

    deps.applyAdoptedSessionState(adopted.data as unknown as Record<string, unknown>, options.password)
    const deviceUnlockWarning = await deps.rebindDeviceUnlockAfterPasswordChange(options.password)
    await deps.refreshDeviceUnlockState()
    const refreshed = await api.getVault()
    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, message: '保险库会话已变化，请重新校验云端保险库' }
    }
    if (!refreshed.ok || !refreshed.data || !deps.publishVaultPayload(refreshed.data)) {
      return { ok: false, message: '本地加密参数已更新，但无法重新载入本地保险库' }
    }

    try {
      rememberCloudEncryptionBinding(
        options.scopeKey,
        JSON.parse(options.envelopeText),
        options.remoteFingerprint || ''
      )
      deps.bumpCloudEncryptionBindingVersion()
    } catch {
      // The local envelope is already bound. The record is only a visible hint.
    }
    return { ok: true, payload: refreshed.data, deviceUnlockWarning }
  }

  async function loadVerifiedCloudRemote(options: {
    direction: CloudSyncDirection
    automatic: boolean
    requestedObjectName: string
    objectName: string
    preferred: CloudVaultRead
    client: RemoteVaultStore
    remoteFingerprint?: string
    operation: CloudOperationHandle | null
    sessionIsCurrent: () => boolean
    operationGateKeys: (...objectNames: string[]) => string[]
  }): Promise<CloudSyncRemoteSnapshot | null> {
    const {
      direction,
      automatic,
      requestedObjectName,
      objectName,
      preferred,
      client,
      operation,
      sessionIsCurrent,
      operationGateKeys
    } = options
    const response = preferred.response
    let alternatePassword: string | null | undefined
    let usedAlternatePassword = false
    let sourceEnvelopeText = ''

    const previewEnvelope = async (content: string) => {
      let result = await api.previewVaultBackup(content)
      if (result.ok && result.data && !sourceEnvelopeText) sourceEnvelopeText = content
      if (!sessionIsCurrent() || result.ok || !isVaultPasswordChangedResult(result)) return result
      clearCloudEncryptionBinding(cloudSyncStateKey(objectName))
      deps.bumpCloudEncryptionBindingVersion()
      if (automatic) return result
      deps.autoSyncPasswordGate.block(...operationGateKeys(requestedObjectName, objectName))
      deps.setBackupStatus('云端文件需要输入云端主密码校验')
      if (alternatePassword === undefined) alternatePassword = await deps.requestCloudVaultPassword()
      if (!sessionIsCurrent() || alternatePassword === null) return result
      try {
        result = await api.previewVaultBackupWithPassword(content, alternatePassword)
        if (result.ok && result.data) {
          usedAlternatePassword = true
          // The entered password must be paired with the envelope it actually
          // decrypted. This is the KDF source used when the local session is
          // adopted after the sync review is confirmed.
          sourceEnvelopeText = content
        }
      } finally {
        deps.finishCloudPasswordPrompt()
      }
      return result
    }

    const pauseAutomaticPasswordMismatch = (result: ApiResult<unknown>) => {
      if (!automatic || !isVaultPasswordChangedResult(result)) return false
      if (!sessionIsCurrent()) return true
      const message = '云端保险库主密码与当前会话不同，已暂停自动同步；请手动下载校验并上传以恢复'
      deps.setBackupStatus(message)
      if (deps.autoSyncPasswordGate.block(...operationGateKeys(requestedObjectName, objectName))) {
        deps.appendCloudSyncLog({
          direction,
          automatic: true,
          status: 'review',
          objectName,
          message
        })
      }
      return true
    }

    const passwordPromptWasCancelled = () => {
      if (alternatePassword !== null) return false
      deps.setBackupStatus('已取消云端校验')
      deps.appendCloudSyncLog({
        direction,
        automatic: false,
        status: 'skipped',
        objectName,
        message: '已取消云端校验'
      })
      return true
    }

    let payload: VaultPayload | null = null
    let envelopeText = response.status === RemoteVaultStatus.Success && typeof response.content === 'string'
      ? response.content
      : ''

    if (response.status === RemoteVaultStatus.Conflict && preferred.deviceRead?.heads.length) {
      const heads = preferred.deviceRead.heads
      const branchPayloads: VaultPayload[] = []
      for (const head of heads) {
        const result = await previewEnvelope(head.content)
        if (!sessionIsCurrent()) return null
        if (pauseAutomaticPasswordMismatch(result) || passwordPromptWasCancelled()) return null
        if (!result.ok || !result.data) {
          const message = '远端分支无法用当前保险库密钥验证，已停止自动合并'
          deps.finishCloudOperation(operation, 'error', message)
          deps.setBackupStatus(message)
          deps.appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
          if (!automatic) deps.feedback.failToast(message)
          return null
        }
        branchPayloads.push(result.data)
      }

      let mergedBranches = branchPayloads[0]
      for (let index = 1; index < heads.length; index += 1) {
        const ancestor = await loadDeviceVaultCommonAncestor(client, objectName, heads.slice(0, index), heads[index])
        if (!sessionIsCurrent()) return null
        if (!ancestor) throw new Error('远端分支缺少唯一可验证的共同祖先，已停止合并')
        const decrypted = await previewEnvelope(ancestor.content)
        if (!sessionIsCurrent()) return null
        if (pauseAutomaticPasswordMismatch(decrypted) || passwordPromptWasCancelled()) return null
        if (!decrypted.ok || !decrypted.data) throw new Error('远端共同祖先无法解密，已停止合并')
        const merged = mergeVaultPayloads(decrypted.data, mergedBranches, branchPayloads[index], true)
        if (merged.conflicts.length) {
          throw new Error(`远端分支存在 ${merged.conflicts.length} 项冲突；已保留所有分支`)
        }
        mergedBranches = merged.payload
      }

      payload = mergedBranches
      const mergedEnvelope = await api.exportVaultBackupForPayload(mergedBranches)
      if (!sessionIsCurrent()) return null
      if (!mergedEnvelope.ok || !mergedEnvelope.data) {
        const message = mergedEnvelope.message || '无法生成远端分支合并检查点'
        deps.finishCloudOperation(operation, 'error', message)
        deps.appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
        return null
      }
      envelopeText = mergedEnvelope.data.content
      if (!usedAlternatePassword) deps.autoSyncPasswordGate.clear(...operationGateKeys(requestedObjectName, objectName))
    } else if (response.status === RemoteVaultStatus.Success && typeof response.content === 'string') {
      const result = await previewEnvelope(response.content)
      if (!sessionIsCurrent()) return null
      if (pauseAutomaticPasswordMismatch(result) || passwordPromptWasCancelled()) return null
      if (!result.ok || !result.data) {
        deps.finishCloudOperation(operation, 'error', result.message || '云端文件无法用当前会话解密')
        if (!automatic) deps.feedback.failToast(result.message || '云端文件无法用当前会话解密')
        deps.setBackupStatus('云端文件无法校验，请确认它来自当前保险库')
        deps.appendCloudSyncLog({
          direction,
          automatic,
          status: 'error',
          objectName,
          message: result.message || '云端文件无法用当前会话解密'
        })
        return null
      }
      payload = result.data
      if (!usedAlternatePassword) deps.autoSyncPasswordGate.clear(...operationGateKeys(requestedObjectName, objectName))
    } else if (response.status === RemoteVaultStatus.NotFound) {
      if (direction === 'download') {
        if (!automatic) deps.feedback.failToast('云端文件不存在')
        deps.setBackupStatus('云端文件不存在')
        deps.appendCloudSyncLog({ direction, automatic, status: 'skipped', objectName, message: '云端文件不存在' })
        return null
      }
      payload = emptyCloudPayload()
    } else {
      const message = String(response.content || '读取云端文件失败')
      deps.finishCloudOperation(operation, 'error', message)
      if (!automatic) deps.feedback.failToast(message)
      deps.appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
      return null
    }

    if (!payload) return null
    if (usedAlternatePassword && (!sourceEnvelopeText || typeof alternatePassword !== 'string')) {
      throw new Error('云端加密参数来源缺失，请重新校验云端保险库')
    }
    if (!usedAlternatePassword && sourceEnvelopeText) {
      try {
        rememberCloudEncryptionBinding(
          cloudSyncStateKey(objectName),
          JSON.parse(sourceEnvelopeText),
          options.remoteFingerprint || ''
        )
        deps.bumpCloudEncryptionBindingVersion()
      } catch {
        // A visible binding record is optional; the validated envelope remains authoritative.
      }
    }
    return {
      payload,
      envelopeText,
      sourceEnvelopeText,
      usedAlternatePassword,
      alternatePassword: usedAlternatePassword ? alternatePassword ?? undefined : undefined
    }
  }

  async function checkCloudBackupInfo(): Promise<void> {
    if (!deps.getVault() || deps.isCloudBusy()) return
    if (!deps.validateOssSettings()) return
    const cloudOperation = deps.beginCloudOperation('inspect', { message: '正在检查云端文件' })
    deps.setBackupStatus('')
    try {
      if (deps.isSettingsChanged()) {
        deps.markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
        const saved = await deps.persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
        if (!saved) {
          deps.finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
          return
        }
      }
      deps.markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端文件')
      const client = createRemoteVaultStore()
      const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
      const preferred = await readCloudVaultForSync(
        client,
        configuredObjectName,
        configuredObjectName
      )
      const response = preferred.response
      if (response.status === RemoteVaultStatus.Success && typeof response.content === 'string') {
        const info: CloudBackupInfo = {
          name: configuredObjectName,
          exists: true,
          size: new TextEncoder().encode(response.content).byteLength,
          lastModified: new Date().toISOString()
        }
        deps.setCloudInfo(info)
        deps.setBackupStatus(`云端文件已存在：${formatBytes(info.size)}`)
        deps.feedback.successToast('云端文件可用')
        return
      }
      if (response.status === RemoteVaultStatus.NotFound) {
        deps.setCloudInfo({ name: configuredObjectName, exists: false, size: 0, lastModified: '' })
        deps.setBackupStatus('云端固定文件不存在')
        deps.feedback.toast('云端文件不存在')
        return
      }
      const message = String(response.content || '检测失败')
      deps.finishCloudOperation(cloudOperation, 'error', message)
      deps.feedback.failToast(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '检测失败')
      deps.finishCloudOperation(cloudOperation, 'error', message)
      deps.feedback.failToast(message)
    } finally {
      deps.finishCloudOperation(cloudOperation)
    }
  }

  async function refreshCloudBackupList(): Promise<void> {
    if (!deps.getVault() || deps.isCloudBusy()) return
    if (!deps.validateOssSettings()) return
    const cloudOperation = deps.beginCloudOperation('list', { message: '正在读取云端备份列表' })
    deps.setBackupStatus('')
    try {
      if (deps.isSettingsChanged()) {
        deps.markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
        const saved = await deps.persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
        if (!saved) {
          deps.finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
          return
        }
      }
      deps.markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端备份列表')
      const client = createRemoteVaultStore()
      const fixedName = normalizeObjectName(deps.getSettings().oss.objectName)
      const items = await loadCloudBackupItems(client, fixedName)
      deps.setCloudBackups(items)
      const statusText = items.length ? `找到 ${items.length} 个云端日期备份` : '没有找到日期备份'
      deps.setBackupStatus(statusText)
      deps.feedback.toast(statusText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '读取备份列表失败')
      deps.finishCloudOperation(cloudOperation, 'error', message)
      deps.feedback.failToast(message)
    } finally {
      deps.finishCloudOperation(cloudOperation)
    }
  }

  async function createDatedCloudBackup(): Promise<void> {
    const current = deps.getVault()
    if (!current || deps.isCloudBusy()) return
    if (!deps.validateOssSettings()) return

    const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
    const versionedObjectName = versionedVaultObjectName(configuredObjectName, current.version)
    const objectName = makeDatedBackupName(versionedObjectName)

    try {
      await deps.feedback.confirm({
        title: '创建云端备份',
        message: '将上传一个新的不可变云端日期备份文件到 OSS：' + objectName + '（不会在本地额外留存）。确认继续吗？',
        confirmButtonText: '确认备份',
        danger: true
      })
    } catch {
      return
    }

    const cloudOperation = deps.beginCloudOperation('backup', {
      direction: 'backup',
      message: '正在创建云端备份'
    })
    deps.setBackupStatus('')
    try {
      if (deps.isSettingsChanged()) {
        deps.markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
        const saved = await deps.persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
        if (!saved) {
          deps.finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
          return
        }
      }

      deps.markCloudOperation(cloudOperation, 'exporting', '正在导出加密保险库')
      const currentVault = await api.getVault()
      if (!currentVault.ok || !currentVault.data) throw new Error(currentVault.message || '读取保险库失败')
      await ensureRemoteAttachmentObjects(
        createRemoteVaultStore(),
        normalizeObjectName(deps.getSettings().oss.objectName),
        currentVault.data,
        api
      )
      const exported = await api.exportVaultBackup()
      if (!exported.ok || !exported.data) {
        const message = exported.message || '导出保险库失败'
        deps.finishCloudOperation(cloudOperation, 'error', message)
        deps.appendCloudSyncLog({
          direction: 'backup',
          automatic: false,
          status: 'error',
          objectName,
          message
        })
        deps.feedback.failToast(message)
        return
      }

      deps.markCloudOperation(cloudOperation, 'writing-remote', '正在写入不可变备份')
      const response = await createRemoteVaultStore().writeObject(
        objectName,
        exported.data.content,
        'application/json',
        { forbidOverwrite: true }
      )
      if (response.status !== RemoteVaultStatus.Success) {
        const message = String(response.content || '备份失败')
        deps.finishCloudOperation(cloudOperation, 'error', message)
        deps.appendCloudSyncLog({
          direction: 'backup',
          automatic: false,
          status: 'error',
          objectName,
          message
        })
        deps.feedback.failToast(message)
        return
      }

      deps.setBackupStatus('已上传到 ' + deps.getSettings().oss.bucketName + '/' + objectName)
      deps.appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'success',
        objectName,
        message: '云端备份已创建'
      })
      deps.feedback.successToast('云端备份已创建')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '云端备份失败')
      deps.finishCloudOperation(cloudOperation, 'error', message)
      deps.setBackupStatus(message)
      deps.appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'error',
        objectName,
        message
      })
      deps.feedback.failToast(message)
    } finally {
      deps.finishCloudOperation(cloudOperation)
    }
  }

  async function rebindCloudEncryption(): Promise<void> {
    if (!deps.getVault() || deps.isCloudBusy()) return
    if (deps.isCloudSyncReviewOpen() || deps.hasPendingCloudSyncReview()) {
      deps.feedback.toast('请先完成或放弃当前云端同步校验')
      return
    }
    if (!deps.validateOssSettings()) return
    const operation = deps.beginCloudOperation('inspect', { message: '正在重新绑定云端加密参数' })
    if (!operation) return
    const generation = deps.captureSessionGeneration()
    try {
      if (deps.isSettingsChanged()) {
        const saved = await deps.persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
        if (!saved) return
      }
      const cloudPassword = await deps.requestCloudVaultPassword()
      if (cloudPassword === null) {
        deps.finishCloudOperation(operation, 'cancelled', '已取消云端加密参数绑定')
        return
      }
      const client = createRemoteVaultStore()
      const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
      const preferred = await readCloudVaultForSync(client, configuredObjectName, configuredObjectName)
      if (preferred.response.status !== RemoteVaultStatus.Success || typeof preferred.response.content !== 'string') {
        throw new Error(String(preferred.response.content || '读取云端保险库失败'))
      }
      const verified = await api.previewVaultBackupWithPassword(preferred.response.content, cloudPassword)
      if (!verified.ok || !verified.data) throw new Error(verified.message || '云端主密码校验失败')
      const adopted = await adoptVerifiedCloudEncryption({
        envelopeText: preferred.response.content,
        password: cloudPassword,
        scopeKey: cloudSyncStateKey(preferred.objectName),
        remoteFingerprint: preferred.response.revision,
        isCurrent: () => deps.isSessionGenerationCurrent(generation) && !deps.isLocked()
      })
      if (!adopted.ok) throw new Error(adopted.message)
      clearAutoSyncPasswordGate(preferred.objectName)
      deps.setBackupStatus(adopted.deviceUnlockWarning
        ? `云端加密参数已绑定；${adopted.deviceUnlockWarning}`
        : '云端加密参数已绑定，后续同步不再重复校验')
      deps.feedback.successToast('云端加密参数已绑定')
    } catch (error) {
      if (!deps.isLocked()) {
        const message = error instanceof Error ? error.message : String(error)
        deps.setBackupStatus(message)
        deps.feedback.failToast(message)
      }
    } finally {
      deps.finishCloudPasswordPrompt()
      deps.finishCloudOperation(operation)
    }
  }

  async function verifyCloudPasswordRewrite(objectName: string, expectedContent: string): Promise<string> {
    try {
      const client = createRemoteVaultStore()
      const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
      const remote = await readCloudVaultForSync(client, configuredObjectName, objectName)
      if (remote.response.status !== RemoteVaultStatus.Success || typeof remote.response.content !== 'string') {
        return '云端回读失败，无法确认新主密码已经生效'
      }
      if (remote.response.content !== expectedContent) {
        return '云端回读仍是旧版本，主密码修改尚未同步完成'
      }
      const verified = await api.previewVaultBackup(remote.response.content)
      if (!verified.ok || !verified.data) {
        return '云端回读无法用新主密码校验，主密码修改尚未同步完成'
      }
      return ''
    } catch (error) {
      return error instanceof Error ? `云端回读失败：${error.message}` : '云端回读失败，无法确认新主密码已经生效'
    }
  }

  async function prepareCloudRewriteForPasswordChange(): Promise<CloudRewritePlan | null> {
    const currentVault = deps.getVault()
    if (!currentVault || !deps.hasCompleteOssSettings()) return null
    const client = createRemoteVaultStore()
    const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
    const preferred = await readCloudVaultForSync(
      client,
      configuredObjectName,
      configuredObjectName
    )
    const { objectName, response } = preferred
    if (response.status === RemoteVaultStatus.NotFound) return null
    if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
      throw new Error(String(response.content || '无法检查云端保险库'))
    }

    let remote = await api.previewVaultBackup(response.content)
    if (!remote.ok && isVaultPasswordChangedResult(remote)) {
      deps.setBackupStatus('云端文件需要输入云端主密码校验')
      const cloudPassword = await deps.requestCloudVaultPassword()
      if (cloudPassword === null) throw new Error('已取消云端校验')
      try {
        remote = await api.previewVaultBackupWithPassword(response.content, cloudPassword)
      } finally {
        deps.finishCloudPasswordPrompt()
      }
    }
    if (!remote.ok || !remote.data) {
      throw new Error(remote.message || '云端保险库无法解密，请先完成云同步再修改主密码')
    }
    if (await cloudSyncPayloadFingerprint(remote.data) !== await cloudSyncPayloadFingerprint(currentVault)) {
      throw new Error('云端与本地保险库存在差异，请先完成同步再修改主密码')
    }
    return {
      objectName,
      remoteHeadIds: preferred.remoteHeadIds
    }
  }

  async function rewriteCloudAfterPasswordChange(
    cloudRewrite: CloudRewritePlan,
    cloudOperation: CloudOperationHandle | null,
    isCurrent: () => boolean
  ): Promise<string> {
    const currentVault = deps.getVault()
    if (!currentVault) return ''
    const exported = await api.exportVaultBackup()
    if (!isCurrent()) return ''
    if (!exported.ok || !exported.data) {
      return exported.message || '无法生成使用新主密码加密的云端文件'
    }
    const client = createRemoteVaultStore()
    const response = await writeManagedCloudVault(
      client,
      cloudRewrite.objectName,
      exported.data.content,
      cloudRewrite.remoteHeadIds
    )
    if (!isCurrent()) return ''
    if (response.status !== 'success') {
      return response.message || '云端保险库重新加密失败'
    }
    deps.markCloudOperation(cloudOperation, 'reading-remote', '正在回读验证云端新主密码')
    const verificationError = await verifyCloudPasswordRewrite(
      cloudRewrite.objectName,
      exported.data.content
    )
    if (verificationError) return verificationError
    clearAutoSyncPasswordGate(cloudRewrite.objectName)
    await rememberCloudSyncState(
      cloudRewrite.objectName,
      currentVault,
      currentVault,
      exported.data.content,
      [response.commitId],
      true,
      makeDeviceCheckpointBasis([response.record])
    )
    return ''
  }

  async function prepareCloudSyncReview(request: CloudSyncReviewOptions & { direction: CloudSyncDirection }): Promise<void> {
    const { direction, ...options } = request
    const initialVault = deps.getVault()
    if (!initialVault || deps.isCloudBusy()) return
    if (cloudSyncRequestInFlight) {
      if (!options.automatic) deps.feedback.toast('云端校验正在进行，请稍候')
      return
    }
    if (deps.hasPendingCloudSyncReview()) {
      if (deps.isCloudSyncReviewOpen()) {
        if (!options.automatic) {
          deps.showCloudSyncReview()
          deps.setBackupStatus('有未处理同步差异，请先确认')
          deps.feedback.toast('有未处理同步差异，请先确认')
        }
        return
      }
      deps.closeCloudSyncReview()
    }
    deps.syncSettings(deps.getSettings())
    if (options.automatic) {
      if (!deps.hasCompleteOssSettings() || !crypto.subtle) return
    } else if (!deps.validateOssSettings()) {
      return
    }

    const requestedObjectName = normalizeObjectName(
      options.objectName ||
      (direction === 'download' && !options.automatic
        ? deps.getSelectedCloudObjectName() || deps.getSettings().oss.objectName
        : deps.getSettings().oss.objectName)
    )
    if (options.automatic && isAutoSyncPasswordBlocked(requestedObjectName)) return
    cloudSyncRequestInFlight = true
    const operationOss = normalizeSettings(deps.getSettings()).oss
    const operationCloudScopeId = JSON.stringify([operationOss.region, operationOss.bucketName])
    const configuredObjectNameAtStart = operationOss.objectName
    const operationGateKeys = (...objectNames: string[]) => objectNames.map((name) => (
      JSON.stringify([operationOss.region, operationOss.bucketName, normalizeObjectName(name)])
    ))
    const generation = deps.captureSessionGeneration()
    const sessionIsCurrent = () => (
      deps.isSessionGenerationCurrent(generation) &&
      !deps.isLocked() &&
      operationCloudScopeId === currentCloudScopeId() &&
      configuredObjectNameAtStart === normalizeObjectName(deps.getSettings().oss.objectName)
    )
    let objectName = requestedObjectName

    if (!options.automatic) {
      deps.appendCloudSyncLog({
        direction,
        automatic: false,
        status: 'started',
        objectName,
        message: direction === 'download' ? '开始下载校验' : '开始上传校验'
      })
    }

    const cloudOperation = deps.beginCloudOperation('review', { direction, automatic: options.automatic === true })
    if (!cloudOperation) {
      cloudSyncRequestInFlight = false
      return
    }
    const finishStaleCloudSync = () => {
      const message = '本地保险库会话或云配置已变化，本次同步已取消，请重新下载校验'
      deps.finishCloudOperation(cloudOperation, 'cancelled', message)
      if (!deps.isLocked()) deps.setBackupStatus(message)
      deps.appendCloudSyncLog({
        direction,
        automatic: options.automatic === true,
        status: 'skipped',
        objectName,
        message
      })
    }
    deps.setBackupStatus(direction === 'download' ? '正在生成下载差异' : '正在生成上传差异')
    try {
      const localPayloadBeforePersist = clonePayload(initialVault)
      if (!options.skipPersist && deps.isSettingsChanged()) {
        deps.markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
        const saved = await deps.persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
        if (!sessionIsCurrent()) {
          finishStaleCloudSync()
          return
        }
        if (!saved && direction !== 'download') {
          deps.finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
          deps.appendCloudSyncLog({
            direction,
            automatic: options.automatic === true,
            status: 'error',
            objectName,
            message: '保存云配置失败'
          })
          return
        }
      }

      const currentVaultNow = deps.getVault()
      if (!currentVaultNow) {
        finishStaleCloudSync()
        return
      }
      const localPayload = clonePayload(currentVaultNow)
      deps.markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端保险库')
      const client = createRemoteVaultStore()
      const preferred = await withCloudSyncTimeout(
        readCloudVaultForSync(
          client,
          normalizeObjectName(deps.getSettings().oss.objectName),
          requestedObjectName
        ),
        '读取云端保险库'
      )
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }
      objectName = preferred.objectName
      const response = preferred.response
      const localHasData = Boolean(localPayload.entries.length || localPayload.passkeys.length ||
        localPayload.passkeyTombstones.length || localPayload.entryTombstones?.length)
      if (preferred.managedRemote && response.status === RemoteVaultStatus.NotFound && direction === 'upload') {
        const key = syncStateStorageKey(objectName, true)
        if (loadCloudSyncStateMap()[key] || await readSyncCheckpoint(key)) {
          throw new Error('已同步的云端设备索引缺失，已停止发布，请检查 OSS')
        }
        if (options.automatic || !localHasData) {
          const message = '新格式云端保险库尚未初始化，请在基准设备手动上传'
          deps.setBackupStatus(message)
          deps.appendCloudSyncLog({ direction, automatic: options.automatic === true, status: 'skipped', objectName, message })
          if (!options.automatic) deps.feedback.toast(message)
          return
        }
        try {
          await deps.feedback.confirm({
            title: '初始化新格式云同步',
            message: '将使用此设备的当前密码库创建新格式云同步。其他设备请在升级并清空本地数据后选择下载。',
            confirmButtonText: '使用此设备初始化'
          })
        } catch {
          deps.finishCloudOperation(cloudOperation, 'cancelled', '已取消初始化云同步')
          return
        }
      }
      const ancestorPayload = await withCloudSyncTimeout(loadCloudSyncAncestor(client, preferred), '读取同步检查点')
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }

      deps.markCloudOperation(cloudOperation, 'decrypting', '正在校验云端保险库')
      const remoteSnapshot = await withCloudSyncTimeout(loadVerifiedCloudRemote({
        direction,
        automatic: options.automatic === true,
        requestedObjectName,
        objectName,
        preferred,
        client,
        remoteFingerprint: response.revision,
        operation: cloudOperation,
        sessionIsCurrent,
        operationGateKeys
      }), '校验云端保险库')
      if (!remoteSnapshot || !sessionIsCurrent()) {
        if (!sessionIsCurrent()) finishStaleCloudSync()
        return
      }
      const remotePayload = remoteSnapshot.payload
      const remoteEnvelopeText = remoteSnapshot.envelopeText
      const remoteEncryptionEnvelopeText = remoteSnapshot.sourceEnvelopeText
      const usedAlternateRemotePassword = remoteSnapshot.usedAlternatePassword
      if (preferred.managedRemote && response.status !== RemoteVaultStatus.NotFound && !ancestorPayload) {
        if (direction === 'upload' && !localHasData) throw new Error('此设备尚未初始化，请先从云端下载')
        if (localHasData && await cloudSyncPayloadFingerprint(localPayload) !== await cloudSyncPayloadFingerprint(remotePayload)) {
          throw new Error('本机缺少可验证的同步基线，已保留两端数据，请先备份本机数据并检查同步状态')
        }
      }

      deps.markCloudOperation(cloudOperation, 'building-diff', '正在计算两端差异')
      const remoteBaselinePayload = clonePayload(remotePayload)
      const planResult = await createCloudSyncPlan({
        requestedDirection: direction,
        localPayload,
        remotePayload,
        ancestorPayload,
        pullStrategy: preferred.managedRemote || direction === 'upload' || options.automatic ? 'integrate' : 'snapshot',
        reviewConcurrentEntryChanges: preferred.managedRemote,
        fingerprint: cloudSyncPayloadFingerprint
      })
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }
      if (!planResult.ok) {
        deps.finishCloudOperation(cloudOperation, 'error', planResult.message)
        deps.setBackupStatus(planResult.message)
        deps.appendCloudSyncLog({
          direction,
          automatic: options.automatic === true,
          status: planResult.code === 'pull-required' ? 'skipped' : 'error',
          objectName,
          message: planResult.message
        })
        if (!options.automatic) deps.feedback.failToast(planResult.message)
        return
      }

      const activePlan = planResult.plan
      const {
        resolvedPasskeyState,
        usedAncestor,
        localChangedSinceBase,
        remoteChangedSinceBase
      } = activePlan
      const effectiveDirection = activePlan.direction
      const sourcePayload = activePlan.sourcePayload
      const basePayload = activePlan.basePayload
      let targetNeedsWrite = activePlan.targetNeedsWrite || (direction === 'upload' && preferred.remoteHeadIds.length > 1)
      const items = activePlan.items

      if (!preferred.managedRemote && !usedAncestor && direction === 'upload' && await shouldPreferCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)) {
        if (!sessionIsCurrent()) {
          finishStaleCloudSync()
          return
        }
        const message = '云端数据较新，已停止上传；请先执行下载校验'
        deps.setBackupStatus(message)
        deps.appendCloudSyncLog({
          direction: 'upload',
          automatic: options.automatic === true,
          status: 'skipped',
          objectName,
          message
        })
        if (!options.automatic) deps.feedback.toast(message)
        return
      }
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }

      if (direction === 'upload' && deps.isPasswordless() && usedAlternateRemotePassword) {
        const message = '云端保险库已设置主密码，当前设备未设置密码；直接上传将清除云端密码保护。请先执行【下载】以同步云端主密码。'
        deps.finishCloudOperation(cloudOperation, 'error', message)
        deps.setBackupStatus(message)
        deps.appendCloudSyncLog({
          direction: 'upload',
          automatic: options.automatic === true,
          status: 'skipped',
          objectName,
          message
        })
        if (!options.automatic) deps.feedback.failToast(message)
        return
      }

      const needsSessionKeyRewrite = usedAlternateRemotePassword
      if (needsSessionKeyRewrite) targetNeedsWrite = true

      const configuredObjectName = normalizeObjectName(deps.getSettings().oss.objectName)
      const canonicalRequest = canonicalVaultReadCandidates(configuredObjectName, requestedObjectName).length > 1
      const uploadObjectName = preferred.managedRemote
        ? configuredObjectName
        : canonicalRequest
          ? versionedVaultObjectName(configuredObjectName, resolvedPasskeyState.version)
          : objectName

      if (
        options.automatic &&
        !preferred.managedRemote &&
        !usedAncestor &&
        effectiveDirection === 'download' &&
        items.length > 0 &&
        await shouldSkipAutomaticCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)
      ) {
        if (!sessionIsCurrent()) {
          finishStaleCloudSync()
          return
        }
        deps.setCloudSyncPreview(null)
        const message = '检测到本地待上传变更，已暂停自动下载；启动时不会自动上传'
        deps.setBackupStatus(message)
        deps.appendCloudSyncLog({
          direction: 'download',
          automatic: true,
          status: 'skipped',
          objectName,
          message,
          total: items.length,
          ...cloudSyncDiffCountsForItems(items)
        })
        return
      }
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }

      const deviceBasis = preferred.deviceRead ? makeDeviceCheckpointBasis(preferred.deviceRead.heads) : undefined
      if (!items.length && !targetNeedsWrite && (!activePlan.mergedPayload || (preferred.managedRemote && effectiveDirection === 'download'))) {
        deps.setCloudSyncPreview(null)
        await rememberCloudSyncState(
          objectName,
          remotePayload,
          localPayload,
          remoteEnvelopeText,
          preferred.remoteHeadIds,
          preferred.managedRemote,
          deviceBasis
        )
        if (!sessionIsCurrent()) {
          finishStaleCloudSync()
          return
        }
        const message = usedAlternateRemotePassword
          ? '校验完成；自动同步仍暂停，请手动上传以更新云端主密码'
          : direction === 'download' && localChangedSinceBase && !remoteChangedSinceBase
            ? '云端没有新变更；本地有待上传内容'
            : '当前方向没有待同步变更'
        deps.setBackupStatus(message)
        if (!options.automatic) deps.feedback.toast(message)
        deps.appendCloudSyncLog({
          direction: effectiveDirection,
          automatic: options.automatic === true,
          status: 'success',
          objectName,
          message
        })
        return
      }

      const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
      const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
      const remoteObjectFingerprint = response.status === RemoteVaultStatus.Success && typeof response.content === 'string'
        ? response.revision || await sha256Text(response.content)
        : 'missing'
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }
      const preview: CloudSyncPreview = {
        direction: effectiveDirection,
        objectName,
        uploadObjectName,
        uploadTargetWasMissing: uploadObjectName !== objectName,
        resolvedPasskeyState,
        sourcePayload,
        basePayload,
        remoteBaselinePayload,
        mergedPayload: activePlan.mergedPayload,
        targetNeedsWrite,
        items,
        automatic: options.automatic === true,
        sessionGeneration: generation,
        cloudScopeId: operationCloudScopeId,
        passwordGateScopeKeys: operationGateKeys(requestedObjectName, objectName, uploadObjectName),
        localFingerprint,
        remoteFingerprint,
        remoteObjectFingerprint,
        remoteExists: response.status === RemoteVaultStatus.Success || response.status === RemoteVaultStatus.Conflict,
        managedRemote: preferred.managedRemote,
        remoteHeadIds: preferred.remoteHeadIds,
        deviceBasis,
        remoteEnvelopeText,
        remoteEncryptionEnvelopeText,
        usedAlternatePassword: usedAlternateRemotePassword,
        remoteNeedsSessionKeyRewrite: usedAlternateRemotePassword,
        alternatePassword: remoteSnapshot.alternatePassword
      }
      await routePreparedCloudSyncPreview(preview, options, cloudOperation)
    } catch (error) {
      if (!sessionIsCurrent()) {
        finishStaleCloudSync()
        return
      }
      const message = error instanceof Error ? error.message : String(error || '同步校验失败')
      deps.finishCloudOperation(cloudOperation, 'error', message)
      deps.setBackupStatus(message)
      if (!options.automatic) deps.feedback.failToast(message)
      deps.appendCloudSyncLog({
        direction,
        automatic: options.automatic === true,
        status: 'error',
        objectName,
        message
      })
    } finally {
      deps.finishCloudOperation(cloudOperation)
      cloudSyncRequestInFlight = false
    }
  }

  async function routePreparedCloudSyncPreview(
    preview: CloudSyncPreview,
    options: CloudSyncReviewOptions,
    operation: CloudOperationHandle | null
  ): Promise<void> {
    deps.setCloudSyncPreview(preview)
    const items = preview.items

    if (preview.usedAlternatePassword) {
      const message = '确认应用后，本机将使用已校验的云端主密码和加密参数'
      deps.markCloudOperation(operation, 'waiting-review', message)
      deps.showCloudSyncReview()
      deps.setBackupStatus(message)
      deps.appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'review',
        objectName: preview.objectName,
        message,
        total: items.length,
        ...cloudSyncDiffCountsForItems(items)
      })
      return
    }

    if (!items.length) {
      await withCloudSyncTimeout(
        applyCloudSyncItems(preview, [], {
          operation,
          clearPreview: true,
          showSuccess: !options.automatic,
          showErrors: !options.automatic,
          successMessage: preview.managedRemote ? '加密快照已同步' : '通行密钥状态已同步'
        }),
        preview.direction === 'download' ? '应用下载差异' : '应用上传差异'
      )
      return
    }

    if (options.automatic) {
      const autoDecision = resolveAutoCloudSyncDecision(preview)
      if (autoDecision.apply) {
        await withCloudSyncTimeout(
          applyCloudSyncItems(preview, items, {
            operation,
            clearPreview: true,
            showSuccess: false,
            showErrors: false,
            successMessage: autoDecision.message
          }),
          preview.direction === 'download' ? '应用下载差异' : '应用上传差异'
        )
        return
      }

      deps.markCloudOperation(operation, 'waiting-review', autoDecision.message)
      deps.showCloudSyncReview()
      deps.setBackupStatus(autoDecision.message)
      deps.appendCloudSyncLog({
        direction: preview.direction,
        automatic: true,
        status: 'review',
        objectName: preview.objectName,
        message: autoDecision.message,
        total: items.length,
        ...cloudSyncDiffCountsForItems(items)
      })
      return
    }

    const message = preview.mergedPayload
      ? `发现 ${items.length} 项差异；确认上传时会把云端更新合并到本地`
      : `发现 ${items.length} 项差异`
    deps.markCloudOperation(operation, 'waiting-review', message)
    deps.showCloudSyncReview()
    deps.setBackupStatus(message)
    deps.appendCloudSyncLog({
      direction: preview.direction,
      automatic: false,
      status: 'review',
      objectName: preview.objectName,
      message,
      total: items.length,
      ...cloudSyncDiffCountsForItems(items)
    })
  }

  async function applyCloudSyncPreview(): Promise<void> {
    const preview = deps.getCloudSyncPreview()
    if (!preview || deps.isCloudBusy()) return
    const selectedItems = getCloudSyncSelectedItems(preview.items)
    if (preview.managedRemote && (selectedItems.length !== preview.items.length || selectedItems.some((item) => !isCloudSyncItemChecked(item)))) {
      deps.feedback.toast('云端同步按完整快照提交，请勾选全部差异，或取消此次同步')
      return
    }
    if (!selectedItems.length && (preview.items.length || !preview.usedAlternatePassword)) {
      deps.feedback.toast('没有选中差异')
      return
    }

    const cloudOperation = deps.beginCloudOperation('apply', { direction: preview.direction, automatic: preview.automatic })
    try {
      const applied = await withCloudSyncTimeout(
        applyCloudSyncItems(preview, selectedItems, {
          operation: cloudOperation,
          closeReview: true,
          showSuccess: true,
          showErrors: true
        }),
        preview.direction === 'download' ? '应用下载差异' : '应用上传差异'
      )
      if (applied && isSameRef(deps.getCloudSyncPreview(), preview)) deps.closeCloudSyncReview()
    } finally {
      deps.finishCloudOperation(cloudOperation)
    }
  }

  async function validateCloudSyncPreview(
    preview: CloudSyncPreview,
    targetPayload: VaultPayload
  ): Promise<CloudSyncPreviewValidation> {
    if (!isCloudSyncPreviewCurrent(preview)) {
      return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
    }
    const currentLocal = await api.getVault()
    if (!isCloudSyncPreviewCurrent(preview)) {
      return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
    }
    if (!currentLocal.ok || !currentLocal.data) {
      return { ok: false, message: currentLocal.message || '无法重新读取本地保险库' }
    }
    const currentLocalFingerprint = await cloudSyncPayloadFingerprint(currentLocal.data)
    let localAlreadyApplied = false
    if (currentLocalFingerprint !== preview.localFingerprint) {
      localAlreadyApplied = await isCloudSyncDownloadTargetApplied({
        direction: preview.direction,
        currentPayload: currentLocal.data,
        targetPayload,
        fingerprint: cloudSyncPayloadFingerprint
      })
      if (!localAlreadyApplied) {
        return { ok: false, message: '本地保险库在确认期间已变化，请重新检测同步差异' }
      }
    }

    const success = (): CloudSyncPreviewValidation => ({
      ok: true,
      message: '',
      currentLocal: currentLocal.data as VaultPayload,
      localAlreadyApplied
    })

    if (preview.managedRemote) {
      const currentRemote = await loadDeviceVault(createRemoteVaultStore(), preview.uploadObjectName)
      if (!isCloudSyncPreviewCurrent(preview)) {
        return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
      }
      if (currentRemote.status === 'error') return { ok: false, message: currentRemote.message }
      if (currentRemote.status === 'conflict' && preview.remoteHeadIds.length < 2) {
        return { ok: false, message: currentRemote.message }
      }
      const currentHeadIds = currentRemote.heads.map((head) => head.id).sort()
      if (JSON.stringify(currentHeadIds) !== JSON.stringify([...preview.remoteHeadIds].sort())) {
        return { ok: false, message: '远端提交头在确认期间已变化，请重新检测同步差异' }
      }
      if (preview.remoteExists && currentRemote.heads.length === 1) {
        const currentHead = currentRemote.heads[0]
        if (!currentHead || currentHead.contentSha256 !== preview.remoteObjectFingerprint) {
          return { ok: false, message: '远端保险库内容在确认期间已变化，请重新检测同步差异' }
        }
      } else if (!preview.remoteExists && currentRemote.status !== 'not-found') {
        return { ok: false, message: '远端保险库在确认期间已创建，请重新检测同步差异' }
      }
      return success()
    }

    const sourceValidation = await validateLegacyRemoteObjectRevision(
      createRemoteVaultStore(),
      preview.objectName,
      preview.remoteObjectFingerprint,
      preview.remoteExists
    )
    if (!isCloudSyncPreviewCurrent(preview)) {
      return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
    }
    if (!sourceValidation.ok || preview.direction !== 'upload' || !preview.uploadTargetWasMissing) {
      return sourceValidation.ok ? success() : { ok: false, message: sourceValidation.message }
    }
    const targetValidation = await validateLegacyRemoteObjectRevision(
      createRemoteVaultStore(),
      preview.uploadObjectName,
      'missing',
      false
    )
    if (!isCloudSyncPreviewCurrent(preview)) {
      return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
    }
    return targetValidation.ok ? success() : { ok: false, message: targetValidation.message }
  }

  async function adoptCloudSyncReviewEncryption(context: CloudSyncApplyContext): Promise<CloudEncryptionAdoptionResult> {
    const { preview, options } = context
    const isCurrent = () => isSameRef(deps.getCloudSyncPreview(), preview) && isCloudSyncPreviewCurrent(preview)
    if (!options.closeReview || !isCurrent() || preview.alternatePassword === undefined || !preview.remoteEncryptionEnvelopeText) {
      return { ok: false, message: '云端加密参数来源缺失，请重新校验云端保险库' }
    }
    deps.markCloudOperation(options.operation || null, 'applying-local', '正在同步主密码到本地')
    const adopted = await adoptVerifiedCloudEncryption({
      envelopeText: preview.remoteEncryptionEnvelopeText,
      password: preview.alternatePassword,
      scopeKey: cloudSyncStateKey(preview.objectName),
      remoteFingerprint: preview.remoteObjectFingerprint,
      isCurrent
    })
    if (adopted.ok) {
      delete preview.alternatePassword
      preview.deviceUnlockWarning = adopted.deviceUnlockWarning
      syncCloudSyncPreviewAfterLocalApply(preview, adopted.payload)
    }
    return adopted
  }

  async function applyCloudSyncItems(
    preview: CloudSyncPreview,
    selectedItems: CloudSyncDiffItem[],
    options: CloudSyncApplyOptions = {}
  ): Promise<boolean> {
    deps.setBackupStatus(preview.direction === 'download' ? '正在应用下载差异' : '正在应用上传差异')
    try {
      const nextPayload = buildCloudSyncTargetPayload(preview, selectedItems, normalizeSettings(deps.getSettings()))
      deps.markCloudOperation(options.operation || null, 'validating', '正在确认本地与远端版本')
      const validation = await validateCloudSyncPreview(preview, nextPayload)
      if (!validation.ok) {
        deps.finishCloudOperation(options.operation || null, 'error', validation.message)
        deps.setBackupStatus(validation.message)
        deps.appendCloudSyncLog({
          direction: preview.direction,
          automatic: preview.automatic,
          status: 'error',
          objectName: preview.objectName,
          message: validation.message,
          total: preview.items.length
        })
        if (isSameRef(deps.getCloudSyncPreview(), preview)) deps.closeCloudSyncReview()
        if (options.showErrors !== false) deps.feedback.failToast(validation.message)
        return false
      }
      if (!isCloudSyncPreviewCurrent(preview)) return false
      if (preview.direction === 'download') nextPayload.revision = validation.currentLocal.revision

      const context: CloudSyncApplyContext = {
        preview,
        selectedItems,
        options,
        remoteClient: createRemoteVaultStore(),
        nextPayload,
        currentLocal: validation.currentLocal,
        localAlreadyApplied: validation.localAlreadyApplied ? validation.currentLocal : null,
        previewStats: cloudSyncSelectionStats(preview.items),
        selectedStats: cloudSyncSelectionStats(selectedItems)
      }
      return preview.direction === 'download'
        ? await applyCloudDownload(context)
        : await applyCloudUpload(context)
    } catch (error) {
      if (!isCloudSyncPreviewCurrent(preview)) return false
      const message = error instanceof Error ? error.message : String(error || '应用同步差异失败')
      deps.finishCloudOperation(options.operation || null, 'error', message)
      const previewStats = cloudSyncSelectionStats(preview.items)
      const selectedStats = cloudSyncSelectionStats(selectedItems)
      deps.appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'error',
        objectName: preview.objectName,
        message,
        selected: selectedStats.selected,
        total: previewStats.total,
        ...cloudSyncDiffCountsForItems(selectedItems)
      })
      if (options.showErrors !== false) deps.feedback.failToast(message)
      deps.setBackupStatus(message)
      if (options.clearPreview && isSameRef(deps.getCloudSyncPreview(), preview)) deps.setCloudSyncPreview(null)
      return false
    }
  }

  async function applyCloudDownload(context: CloudSyncApplyContext): Promise<boolean> {
    const { preview, selectedItems, options, remoteClient, nextPayload, localAlreadyApplied, previewStats, selectedStats } = context
    deps.markCloudOperation(options.operation || null, 'applying-local', '正在校验附件对象')
    await ensureLocalAttachmentObjects(
      remoteClient,
      normalizeObjectName(deps.getSettings().oss.objectName),
      nextPayload,
      api
    )
    if (!isCloudSyncPreviewCurrent(preview)) return false
    let appliedVault = localAlreadyApplied
    if (!appliedVault) {
      deps.markCloudOperation(options.operation || null, 'applying-local', '正在写入本地保险库')
      const result = await deps.saveVaultForCurrentSession(nextPayload)
      if (!result.ok || !result.data) {
        const message = result.code === 'CONFLICT'
          ? '本地保险库在应用同步期间已变化，请重新检测差异'
          : result.message || '应用下载差异失败'
        if (result.code === 'CONFLICT') await deps.handleVaultWriteError(result, message)
        return failCloudSyncApply(context, message, { showToast: result.code !== 'CONFLICT' })
      }
      appliedVault = result.data
    }

    if (!deps.publishVaultPayload(appliedVault)) return false
    void deps.collectLocalAttachmentObjects(appliedVault)
    if (!syncCloudSyncPreviewAfterDownload(preview, appliedVault)) return false

    if (preview.alternatePassword !== undefined) {
      const adopted = await adoptCloudSyncReviewEncryption(context)
      if (!isSameRef(deps.getCloudSyncPreview(), preview) || !isCloudSyncPreviewCurrent(preview)) return false
      if (!adopted.ok) return failCloudSyncApply(context, `本地主密码同步失败：${adopted.message}`)
      appliedVault = adopted.payload
      deps.autoSyncPasswordGate.clear(...preview.passwordGateScopeKeys)
    }
    const passwordAdopted = Boolean(preview.usedAlternatePassword)
    const deviceUnlockWarning = preview.deviceUnlockWarning

    deps.markCloudOperation(options.operation || null, 'recording-checkpoint', '正在记录同步检查点')
    await rememberCloudSyncState(
      preview.objectName,
      preview.remoteBaselinePayload,
      appliedVault,
      preview.remoteEnvelopeText,
      preview.remoteHeadIds,
      preview.managedRemote,
      preview.deviceBasis
    )
    if (!syncCloudSyncPreviewAfterLocalApply(preview, appliedVault)) return false

    deps.reconcileSelectedEntryAfterVaultUpdate(appliedVault)
    deps.setSelectedCloudObjectName('')
    const passwordAdoptionMessage = passwordAdopted
      ? (selectedItems.length ? `已下载 ${selectedItems.length} 项差异并同步主密码` : '已同步云端主密码')
      : `已下载 ${selectedItems.length} 项差异`
    const message = options.successMessage || (deviceUnlockWarning
      ? `${passwordAdoptionMessage}；${deviceUnlockWarning}`
      : passwordAdoptionMessage)
    deps.setBackupStatus(message)
    deps.appendCloudSyncLog({
      direction: 'download',
      automatic: preview.automatic,
      status: 'success',
      objectName: preview.objectName,
      message,
      selected: selectedStats.selected,
      total: previewStats.total,
      ...cloudSyncDiffCountsForItems(selectedItems)
    })
    finishCloudSyncApplyPreview(preview, options)
    if (options.showSuccess) deps.feedback.successToast(passwordAdopted ? '下载差异已应用，本地主密码已与云端同步' : '下载差异已应用')
    return true
  }

  async function applyCloudUpload(context: CloudSyncApplyContext): Promise<boolean> {
    const { preview, selectedItems, options, remoteClient, nextPayload, currentLocal, previewStats, selectedStats } = context
    if (deps.isPasswordless() && preview.remoteNeedsSessionKeyRewrite) {
      const message = '云端保险库已设置主密码，当前设备未设置密码；禁止上传以防止覆盖云端密码。请先执行【下载】以同步主密码。'
      return failCloudSyncApply(context, message)
    }

    let appliedLocalPayload: VaultPayload | null = null
    if (preview.mergedPayload) {
      deps.markCloudOperation(options.operation || null, 'applying-local', '正在合并云端更新到本地')
      await ensureLocalAttachmentObjects(
        remoteClient,
        normalizeObjectName(deps.getSettings().oss.objectName),
        preview.mergedPayload,
        api
      )
      if (!isCloudSyncPreviewCurrent(preview)) return false

      const currentLocalFingerprint = await cloudSyncPayloadFingerprint(currentLocal)
      const mergedLocalFingerprint = await cloudSyncPayloadFingerprint(preview.mergedPayload)
      if (currentLocalFingerprint !== mergedLocalFingerprint) {
        const mergedLocalPayload = clonePayload(preview.mergedPayload)
        mergedLocalPayload.revision = currentLocal.revision
        const saved = await deps.saveVaultForCurrentSession(mergedLocalPayload)
        if (!saved.ok || !saved.data) {
          const message = saved.code === 'CONFLICT'
            ? '本地保险库在合并云端更新期间已变化，请重新检测同步差异'
            : saved.message || '合并云端更新到本地失败'
          if (saved.code === 'CONFLICT') await deps.handleVaultWriteError(saved, message)
          return failCloudSyncApply(context, message, { showToast: saved.code !== 'CONFLICT' })
        }
        appliedLocalPayload = saved.data
        if (!deps.publishVaultPayload(appliedLocalPayload)) return false
        void deps.collectLocalAttachmentObjects(appliedLocalPayload)
        if (!syncCloudSyncPreviewAfterLocalApply(preview, appliedLocalPayload)) return false
      } else {
        appliedLocalPayload = currentLocal
      }

      deps.reconcileSelectedEntryAfterVaultUpdate(appliedLocalPayload)
    }

    if (!preview.targetNeedsWrite && !preview.remoteNeedsSessionKeyRewrite) {
      deps.autoSyncPasswordGate.clear(...preview.passwordGateScopeKeys)
      await rememberCloudSyncState(
        preview.objectName,
        preview.remoteBaselinePayload,
        appliedLocalPayload || deps.getVault() || currentLocal,
        preview.remoteEnvelopeText,
        preview.remoteHeadIds,
        preview.managedRemote,
        preview.deviceBasis
      )
      if (!isCloudSyncPreviewCurrent(preview)) return false
      const message = appliedLocalPayload
        ? '云端更新已合并到本地'
        : '当前方向没有待同步变更'
      deps.setBackupStatus(message)
      deps.appendCloudSyncLog({
        direction: 'upload',
        automatic: preview.automatic,
        status: 'success',
        objectName: preview.objectName,
        message,
        selected: selectedStats.selected,
        total: previewStats.total,
        ...cloudSyncDiffCountsForItems(selectedItems)
      })
      finishCloudSyncApplyPreview(preview, options)
      if (options.showSuccess) deps.feedback.successToast(message)
      return true
    }

    if (preview.managedRemote) {
      recordPermanentEntryDeletions(preview.remoteBaselinePayload.entries, nextPayload, preview.remoteBaselinePayload.entryTombstones)
    }
    deps.markCloudOperation(options.operation || null, 'writing-remote', '正在校验并上传附件对象')
    await ensureRemoteAttachmentObjects(
      remoteClient,
      normalizeObjectName(deps.getSettings().oss.objectName),
      nextPayload,
      api,
      preview.managedRemote ? preview.remoteBaselinePayload : undefined
    )
    if (!isCloudSyncPreviewCurrent(preview)) return false
    if (preview.alternatePassword !== undefined) {
      const adopted = await adoptCloudSyncReviewEncryption(context)
      if (!isSameRef(deps.getCloudSyncPreview(), preview) || !isCloudSyncPreviewCurrent(preview)) return false
      if (!adopted.ok) return failCloudSyncApply(context, `本地主密码同步失败：${adopted.message}`)
      appliedLocalPayload = adopted.payload
      preview.localFingerprint = await cloudSyncPayloadFingerprint(adopted.payload)
      if (!isCloudSyncPreviewCurrent(preview)) return false
    }
    deps.markCloudOperation(options.operation || null, 'exporting', '正在生成上传内容')
    const exported = await api.exportVaultBackupForPayload(nextPayload)
    if (!isCloudSyncPreviewCurrent(preview)) return false
    if (!exported.ok || !exported.data) {
      return failCloudSyncApply(context, exported.message || '生成上传内容失败')
    }

    deps.markCloudOperation(options.operation || null, 'writing-remote', '正在写入云端保险库')
    const managedWrite = preview.managedRemote
      ? await writeManagedCloudVault(
          remoteClient,
          preview.uploadObjectName,
          exported.data.content,
          preview.remoteHeadIds
        )
      : null
    const directWrite = preview.managedRemote
      ? null
      : await remoteClient.writeObject(preview.uploadObjectName, exported.data.content, 'application/json')
    if (!isCloudSyncPreviewCurrent(preview)) return false

    const writeSucceeded = managedWrite
      ? managedWrite.status === 'success'
      : directWrite?.status === RemoteVaultStatus.Success
    const writeMessage = managedWrite?.message || String(directWrite?.content || '上传失败')
    if (!writeSucceeded) {
      return failCloudSyncApply(context, writeMessage, { objectName: preview.uploadObjectName })
    }

    deps.autoSyncPasswordGate.clear(...preview.passwordGateScopeKeys)
    deps.setCloudInfo({
      name: preview.uploadObjectName,
      exists: true,
      size: exported.data.content.length,
      lastModified: new Date().toISOString()
    })
    const uploadedPayload = clonePayload(nextPayload)
    uploadedPayload.updatedAt = Number(exported.data.updatedAt || uploadedPayload.updatedAt || 0)
    deps.markCloudOperation(options.operation || null, 'recording-checkpoint', '正在记录同步检查点')
    await rememberCloudSyncState(
      preview.uploadObjectName,
      uploadedPayload,
      appliedLocalPayload || deps.getVault() || uploadedPayload,
      exported.data.content,
      managedWrite?.status === 'success' ? [managedWrite.commitId] : [],
      preview.managedRemote,
      managedWrite?.status === 'success' ? makeDeviceCheckpointBasis([managedWrite.record]) : undefined
    )
    if (!isCloudSyncPreviewCurrent(preview)) return false

    const message = options.successMessage || (preview.mergedPayload
      ? '已合并云端更新并上传 ' + selectedItems.length + ' 项差异'
      : '已上传 ' + selectedItems.length + ' 项差异')
    const uploadMessage = preview.deviceUnlockWarning ? `${message}；${preview.deviceUnlockWarning}` : message
    deps.setBackupStatus(options.successMessage || uploadMessage + ' 到 ' + deps.getSettings().oss.bucketName + '/' + preview.uploadObjectName)
    deps.appendCloudSyncLog({
      direction: 'upload',
      automatic: preview.automatic,
      status: 'success',
      objectName: preview.uploadObjectName,
      message: uploadMessage,
      selected: selectedStats.selected,
      total: previewStats.total,
      ...cloudSyncDiffCountsForItems(selectedItems)
    })
    finishCloudSyncApplyPreview(preview, options)
    if (options.showSuccess) deps.feedback.successToast('上传差异已应用')
    return true
  }

  function failCloudSyncApply(
    context: CloudSyncApplyContext,
    message: string,
    failure: { objectName?: string; showToast?: boolean } = {}
  ): boolean {
    const { preview, selectedItems, options, previewStats, selectedStats } = context
    deps.finishCloudOperation(options.operation || null, 'error', message)
    deps.setBackupStatus(message)
    deps.appendCloudSyncLog({
      direction: preview.direction,
      automatic: preview.automatic,
      status: 'error',
      objectName: failure.objectName || preview.objectName,
      message,
      selected: selectedStats.selected,
      total: previewStats.total,
      ...cloudSyncDiffCountsForItems(selectedItems)
    })
    if (failure.showToast !== false && options.showErrors !== false) deps.feedback.failToast(message)
    if (options.clearPreview && isSameRef(deps.getCloudSyncPreview(), preview)) deps.setCloudSyncPreview(null)
    return false
  }

  function finishCloudSyncApplyPreview(preview: CloudSyncPreview, options: CloudSyncApplyOptions): void {
    if (options.closeReview) {
      deps.closeCloudSyncReview()
    } else if (options.clearPreview && isSameRef(deps.getCloudSyncPreview(), preview)) {
      deps.setCloudSyncPreview(null)
    }
  }

  return {
    cloudSyncStateKey,
    currentCloudScopeId,
    isAutoSyncPasswordBlocked,
    clearAutoSyncPasswordGate,
    checkCloudBackupInfo,
    refreshCloudBackupList,
    createDatedCloudBackup,
    rebindCloudEncryption,
    prepareCloudRewriteForPasswordChange,
    rewriteCloudAfterPasswordChange,
    prepareCloudSyncReview,
    applyCloudSyncPreview
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
