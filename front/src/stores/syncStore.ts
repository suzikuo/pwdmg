import { computed, nextTick, reactive, ref } from 'vue'
import {
  useCloudSync,
  type CloudOperationDirection,
  type CloudOperationHandle,
  type CloudOperationKind,
  type CloudOperationStage,
  type CloudSyncLogEntry
} from '../composables/useCloudSync.ts'
import { DEFAULT_OSS_OBJECT_NAME, normalizeObjectName } from '../services/aliyunOss.ts'
import { api } from '../services/api.ts'
import { AutoSyncPasswordGate } from '../services/autoSyncPasswordGate.ts'
import {
  AUTO_SYNC_POSTPONE_DEFAULT_MINUTES,
  AUTO_SYNC_POSTPONE_PRESET_MINUTES,
  AUTO_SYNC_POSTPONE_UNTIL_KEY,
  formatAutoSyncPostponePresetLabel,
  formatAutoSyncPostponeTime,
  isAutoSyncPostponedAt,
  normalizeAutoSyncPostponeMinutes,
  normalizeAutoSyncPostponedUntil,
  remainingAutoSyncPostponeMs
} from '../services/autoSyncPostpone.ts'
import { readCloudEncryptionBinding } from '../services/cloudEncryptionBinding.ts'
import {
  cloudSyncChangeLabel,
  cloudSyncDiffCountsForItems,
  cloudSyncItemSummary,
  cloudSyncSelectionStats,
  countCloudSyncSelections
} from '../services/sync/legacyDiff.ts'
import {
  AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES,
  AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES,
  cloudSyncDirectionLabel,
  cloudSyncLogStatusLabel,
  cloudSyncLogSummary,
  cloudSyncLogTitle,
  createSyncEngine,
  isCloudSyncItemChecked,
  normalizeAutoSyncIntervalMinutes,
  normalizeSettings,
  purgeLegacyCloudSyncState,
  setCloudSyncDetailChecked,
  setCloudSyncItemChecked,
  type CloudSyncReviewOptions
} from '../services/sync/syncEngine.ts'
import { secureRandomId } from '../services/secureRandom.ts'
import {
  formatBytes,
  formatDateTime,
  isAndroidRuntime,
  isDesktopRuntime,
  noopUiFeedback,
  readLocalStorage,
  writeLocalStorage,
  type UiFeedback
} from '../services/runtime.ts'
import type { UiStore } from './uiStore.ts'
import type { ApiResult, PortableBackupSelection, VaultPayload } from '../types.ts'

export const CLOUD_SYNC_LOGS_KEY = 'mypwdmg.cloudSyncLogs.v1'
export const CLOUD_SYNC_LOG_LIMIT_KEY = 'mypwdmg.cloudSyncLogLimit'
const SYNC_HISTORY_CLEANUP_SCOPE_KEY = 'mypwdmg.syncHistoryCleanupScope'
export const CLOUD_SYNC_LOG_LIMIT_DEFAULT = 50
export const CLOUD_SYNC_LOG_LIMIT_MIN = 10
export const CLOUD_SYNC_LOG_LIMIT_MAX = 200
export const AUTO_CLOUD_SYNC_UPLOAD_DELAY_MS = 700
export const AUTO_CLOUD_SYNC_DOWNLOAD_DELAY_MS = 1200

export type SyncStoreDeps = {
  ui: UiStore
  feedback?: UiFeedback
  getVault: () => VaultPayload | null
  isLocked: () => boolean
  isPasswordless: () => boolean
  applyAdoptedSessionState: (appState: Record<string, unknown>, password: string) => void
  rebindDeviceUnlockAfterPasswordChange: (password: string) => Promise<string>
  refreshDeviceUnlockState: () => Promise<void>
  applyLockedUiState: () => void
  publishVaultPayload: (next: VaultPayload) => boolean
  saveVaultForCurrentSession: (next: VaultPayload) => Promise<ApiResult<VaultPayload>>
  handleVaultWriteError: (result: ApiResult<unknown>, fallback: string) => Promise<void>
  collectLocalAttachmentObjects: (payload: VaultPayload) => Promise<void>
  reconcileSelectedEntryAfterVaultUpdate: (payload: VaultPayload) => void
  getSessionGeneration: () => number
  captureSessionGeneration: () => number
  isSessionGenerationCurrent: (generation: number) => boolean
}

function clampCloudSyncLogLimit(value: unknown): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return CLOUD_SYNC_LOG_LIMIT_DEFAULT
  return Math.min(Math.max(Math.round(numberValue), CLOUD_SYNC_LOG_LIMIT_MIN), CLOUD_SYNC_LOG_LIMIT_MAX)
}

function loadCloudSyncLogLimit(): number {
  return clampCloudSyncLogLimit(readLocalStorage(CLOUD_SYNC_LOG_LIMIT_KEY))
}

function normalizeCloudSyncLog(value: unknown): CloudSyncLogEntry | null {
  const item = value as Partial<CloudSyncLogEntry>
  if (!item || typeof item !== 'object') return null
  const direction = item.direction === 'download' || item.direction === 'upload' || item.direction === 'backup' || item.direction === 'history'
    ? item.direction
    : 'upload'
  const status = item.status === 'started' || item.status === 'success' || item.status === 'review' || item.status === 'error' || item.status === 'skipped'
    ? item.status
    : 'success'
  return {
    id: String(item.id || secureRandomId()),
    at: Number(item.at || Date.now()),
    direction,
    automatic: item.automatic === true,
    status,
    objectName: String(item.objectName || ''),
    message: String(item.message || ''),
    added: Number(item.added || 0),
    modified: Number(item.modified || 0),
    deleted: Number(item.deleted || 0),
    selected: Number(item.selected || 0),
    total: Number(item.total || 0)
  }
}

function loadCloudSyncLogs(): CloudSyncLogEntry[] {
  try {
    const raw = JSON.parse(readLocalStorage(CLOUD_SYNC_LOGS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeCloudSyncLog).filter(Boolean).slice(0, loadCloudSyncLogLimit()) as CloudSyncLogEntry[]
  } catch {
    return []
  }
}

export function createSyncStore(deps: SyncStoreDeps) {
  const feedback = deps.feedback || noopUiFeedback
  const { ui } = deps

  const settings = reactive({
    oss: {
      bucketName: '',
      accessKeyId: '',
      accessKeySecret: '',
      region: '',
      objectName: DEFAULT_OSS_OBJECT_NAME,
      autoSync: false,
      autoSyncIntervalMinutes: AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES
    }
  })

  const cloudSyncRuntime = useCloudSync({
    initialLogs: loadCloudSyncLogs(),
    initialLogLimit: loadCloudSyncLogLimit()
  })
  const {
    busy: cloudBusy,
    status: backupStatus,
    info: cloudInfo,
    backups: cloudBackups,
    selectedObjectName: selectedCloudObjectName,
    preview: cloudSyncPreview,
    logs: cloudSyncLogs,
    logLimit: cloudSyncLogLimit
  } = cloudSyncRuntime

  const autoSyncPasswordGate = new AutoSyncPasswordGate()
  const cloudEncryptionBindingVersion = ref(0)
  const historyCleanupScope = ref(readLocalStorage(SYNC_HISTORY_CLEANUP_SCOPE_KEY))
  const currentHistoryScope = computed(() => {
    const { region, bucketName, objectName } = normalizeSettings(settings).oss
    return JSON.stringify([region, bucketName, objectName])
  })
  const historyCleanupEnabled = computed(() => historyCleanupScope.value === currentHistoryScope.value)

  // Cloud password prompt state
  const cloudPasswordPromptValue = ref('')
  const cloudPasswordPromptBusy = ref(false)
  let cloudPasswordPromptResolve: ((value: string | null) => void) | null = null

  // Portable backup & Android export state
  const portableBackupBusy = ref(false)
  const portableBackupStatus = ref('')
  const portableBackupSelection = ref<PortableBackupSelection | null>(null)
  const portableBackupPassword = ref('')

  // Auto-sync timers & postpone state
  let autoCloudUploadTimer = 0
  let autoCloudDownloadTimer = 0
  let autoSyncPostponeTimer = 0
  let lastAutoCloudDownloadCheckAt = 0
  let pendingAutoUploadDuringPostpone = false
  let pendingAutoDownloadDuringPostpone = false
  const autoSyncPostponedUntil = ref(normalizeAutoSyncPostponedUntil(readLocalStorage(AUTO_SYNC_POSTPONE_UNTIL_KEY)))
  const isAutoSyncPostponed = computed(() => isAutoSyncPostponedAt(autoSyncPostponedUntil.value))
  const autoSyncPostponedUntilLabel = computed(() => (
    isAutoSyncPostponed.value ? formatAutoSyncPostponeTime(autoSyncPostponedUntil.value) : ''
  ))

  // ---- Settings helpers ----
  function updateOssSetting(field: keyof typeof settings.oss, value: string): void {
    if (field === 'bucketName' || field === 'accessKeyId' || field === 'accessKeySecret' || field === 'region' || field === 'objectName') {
      settings.oss[field] = value
    }
  }

  function syncSettings(nextSettings?: Partial<VaultPayload['settings']>): void {
    const normalized = normalizeSettings(nextSettings)
    Object.assign(settings.oss, normalized.oss)
  }

  function setAutoSyncIntervalMinutes(value: number | string): void {
    settings.oss.autoSyncIntervalMinutes = normalizeAutoSyncIntervalMinutes(value)
  }

  function autoCloudDownloadMinIntervalMs(): number {
    return normalizeAutoSyncIntervalMinutes(settings.oss.autoSyncIntervalMinutes) * 60 * 1000
  }

  function hasCompleteOssSettings(): boolean {
    return Boolean(settings.oss.bucketName && settings.oss.accessKeyId && settings.oss.accessKeySecret && settings.oss.region)
  }

  function validateOssSettings(): boolean {
    syncSettings(settings)
    if (!hasCompleteOssSettings()) {
      feedback.failToast('请先填写完整 OSS 配置')
      return false
    }
    if (!crypto.subtle) {
      feedback.failToast('当前环境不支持 Web Crypto')
      return false
    }
    return true
  }

  function isSettingsChanged(): boolean {
    const current = deps.getVault()
    if (!current) return false
    return JSON.stringify(normalizeSettings(settings)) !== JSON.stringify(normalizeSettings(current.settings))
  }

  async function setHistoryCleanupEnabled(enabled: boolean): Promise<void> {
    const scope = currentHistoryScope.value
    if (enabled) {
      if (!validateOssSettings() || isSettingsChanged()) return
      try {
        await feedback.confirm({
          title: '启用云端同步历史整理',
          message: '请确认其他同步设备已升级并至少成功同步一次。仅在一台常用设备上开启。此功能会删除符合条件的旧同步快照和版本记录。',
          confirmButtonText: '启用整理',
          danger: true
        })
      } catch {
        return
      }
      if (scope !== currentHistoryScope.value || !deps.getVault() || deps.isLocked() || isSettingsChanged()) return
    }
    historyCleanupScope.value = enabled ? scope : ''
    writeLocalStorage(SYNC_HISTORY_CLEANUP_SCOPE_KEY, historyCleanupScope.value)
  }

  async function persistSettings(options: { closeDrawer?: boolean; toast?: boolean; skipAutoSync?: boolean } = {}): Promise<boolean> {
    const current = deps.getVault()
    if (!current) return false
    if (!isSettingsChanged()) {
      if (options.closeDrawer) ui.drawerOpen.value = false
      if (options.toast) feedback.successToast('设置已保存')
      return true
    }
    const payload = JSON.parse(JSON.stringify(current)) as VaultPayload
    payload.settings = normalizeSettings(settings)
    const result = await deps.saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) {
      await deps.handleVaultWriteError(result, '保存失败')
      return false
    }
    if (!deps.publishVaultPayload(result.data)) return false
    if (!settings.oss.autoSync && autoSyncPostponedUntil.value > 0) {
      resumeAutoSync({ triggerCheck: false, toast: false })
    }
    if (options.closeDrawer) ui.drawerOpen.value = false
    if (options.toast) feedback.successToast('设置已保存')
    if (!options.skipAutoSync) {
      scheduleAutoCloudDownloadCheck(true)
      scheduleAutoCloudUpload()
    }
    return true
  }

  async function saveSettings(): Promise<void> {
    await persistSettings({ closeDrawer: true, toast: true })
  }

  // ---- Cloud Operation Helpers ----
  function beginCloudOperation(
    kind: CloudOperationKind = 'review',
    options: { direction?: CloudOperationDirection; automatic?: boolean; message?: string } = {}
  ): CloudOperationHandle | null {
    return cloudSyncRuntime.begin(kind, options)
  }

  function markCloudOperation(
    operation: CloudOperationHandle | null,
    stage: CloudOperationStage,
    message = ''
  ): boolean {
    return cloudSyncRuntime.stage(operation, stage, message)
  }

  function finishCloudOperation(
    operation: CloudOperationHandle | null,
    stage: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'> = 'success',
    message = ''
  ): void {
    cloudSyncRuntime.finish(operation, stage, message)
  }

  function cancelCloudOperation(): void {
    cloudSyncRuntime.cancel()
  }

  // ---- Sync Logs ----
  function persistCloudSyncLogs(): void {
    writeLocalStorage(CLOUD_SYNC_LOGS_KEY, JSON.stringify(cloudSyncLogs.value.slice(0, cloudSyncLogLimit.value)))
  }

  function appendCloudSyncLog(
    input: Partial<CloudSyncLogEntry> & Pick<CloudSyncLogEntry, 'direction' | 'status' | 'objectName' | 'message'>
  ): void {
    const replacementIndex = input.status === 'started' || input.automatic === true
      ? -1
      : cloudSyncLogs.value.findIndex((item) => (
        (item.status === 'started' || item.status === 'review') &&
        !item.automatic &&
        item.direction === input.direction &&
        normalizeObjectName(item.objectName) === normalizeObjectName(input.objectName)
      ))
    const existing = replacementIndex >= 0 ? cloudSyncLogs.value[replacementIndex] : null
    const entry: CloudSyncLogEntry = {
      id: existing?.id || secureRandomId(),
      at: Date.now(),
      direction: input.direction,
      automatic: input.automatic === true,
      status: input.status,
      objectName: input.objectName,
      message: input.message,
      added: Number(input.added || 0),
      modified: Number(input.modified || 0),
      deleted: Number(input.deleted || 0),
      selected: Number(input.selected || 0),
      total: Number(input.total || 0)
    }
    if (replacementIndex >= 0) {
      const nextLogs = [...cloudSyncLogs.value]
      nextLogs[replacementIndex] = entry
      cloudSyncLogs.value = nextLogs.slice(0, cloudSyncLogLimit.value)
    } else {
      cloudSyncLogs.value = [entry, ...cloudSyncLogs.value].slice(0, cloudSyncLogLimit.value)
    }
    persistCloudSyncLogs()
  }

  function setCloudSyncLogLimit(value: number | string): void {
    cloudSyncLogLimit.value = clampCloudSyncLogLimit(value)
    writeLocalStorage(CLOUD_SYNC_LOG_LIMIT_KEY, String(cloudSyncLogLimit.value))
    cloudSyncLogs.value = cloudSyncLogs.value.slice(0, cloudSyncLogLimit.value)
    persistCloudSyncLogs()
  }

  function clearCloudSyncLogs(): void {
    cloudSyncLogs.value = []
    persistCloudSyncLogs()
    feedback.toast('同步记录已清空')
  }

  // ---- Cloud Password Prompt Bridge ----
  function requestCloudVaultPassword(): Promise<string | null> {
    if (cloudPasswordPromptResolve) cloudPasswordPromptResolve(null)
    cloudPasswordPromptValue.value = ''
    cloudPasswordPromptBusy.value = false
    ui.drawerOpen.value = false
    ui.cloudPasswordPromptOpen.value = true
    backupStatus.value = '云端文件需要输入云端主密码校验'
    return new Promise<string | null>((resolve) => {
      cloudPasswordPromptResolve = resolve
    })
  }

  async function submitCloudPasswordPrompt(): Promise<void> {
    if (cloudPasswordPromptBusy.value) return
    const resolve = cloudPasswordPromptResolve
    if (!resolve) return
    const submittedPassword = cloudPasswordPromptValue.value
    cloudPasswordPromptBusy.value = true
    await nextTick()
    if (cloudPasswordPromptResolve !== resolve) {
      cloudPasswordPromptBusy.value = false
      return
    }
    cloudPasswordPromptResolve = null
    resolve(submittedPassword)
  }

  function resolveCloudPasswordPrompt(value: string | null): void {
    const resolve = cloudPasswordPromptResolve
    cloudPasswordPromptResolve = null
    cloudPasswordPromptBusy.value = false
    ui.cloudPasswordPromptOpen.value = false
    cloudPasswordPromptValue.value = ''
    if (resolve) resolve(value)
  }

  function cancelCloudPasswordPrompt(): void {
    if (cloudPasswordPromptBusy.value) return
    resolveCloudPasswordPrompt(null)
  }

  function handleCloudPasswordPromptClosed(): void {
    if (cloudPasswordPromptResolve) resolveCloudPasswordPrompt(null)
  }

  function finishCloudPasswordPrompt(): void {
    cloudPasswordPromptBusy.value = false
    ui.cloudPasswordPromptOpen.value = false
    cloudPasswordPromptValue.value = ''
  }

  // ---- Cloud Sync Review UI State ----
  function hasPendingCloudSyncReview(): boolean {
    return Boolean(cloudSyncPreview.value?.items.length || cloudSyncPreview.value?.usedAlternatePassword)
  }

  function showCloudSyncReview(): void {
    ui.drawerOpen.value = false
    ui.drawerDetailOpen.value = false
    ui.cloudSyncReviewOpen.value = true
    cloudSyncRuntime.reviewOpen.value = true
  }

  function closeCloudSyncReview(): void {
    ui.cloudSyncReviewOpen.value = false
    cloudSyncRuntime.reviewOpen.value = false
    if (cloudSyncPreview.value) delete cloudSyncPreview.value.alternatePassword
    cloudSyncPreview.value = null
    cancelCloudOperation()
  }

  function hideCloudSyncReview(): void {
    closeCloudSyncReview()
  }

  async function discardCloudSyncReview(): Promise<void> {
    const preview = cloudSyncPreview.value
    if (!preview) {
      closeCloudSyncReview()
      return
    }
    const stats = cloudSyncSelectionStats(preview.items)
    appendCloudSyncLog({
      direction: preview.direction,
      automatic: preview.automatic,
      status: 'skipped',
      objectName: preview.objectName,
      message: '已放弃本次同步差异',
      selected: 0,
      total: stats.total,
      ...cloudSyncDiffCountsForItems(preview.items)
    })
    backupStatus.value = '已放弃本次同步差异'
    closeCloudSyncReview()
    feedback.toast('已放弃本次同步差异')
  }

  function setAllCloudSyncDiffs(checked: boolean): void {
    for (const item of cloudSyncPreview.value?.items || []) setCloudSyncItemChecked(item, checked)
  }

  const cloudSyncDiffCounts = computed(() => {
    const items = cloudSyncPreview.value?.items || []
    return {
      added: items.filter((item) => item.changeType === 'added').length,
      modified: items.filter((item) => item.changeType === 'modified').length,
      deleted: items.filter((item) => item.changeType === 'deleted').length
    }
  })

  const cloudSyncSelectedCount = computed(() => countCloudSyncSelections(cloudSyncPreview.value?.items || []))
  const cloudSyncReviewTitle = computed(() => (
    cloudSyncPreview.value?.direction === 'download' ? '下载校验' : '上传校验'
  ))
  const cloudSyncReviewActionText = computed(() => {
    const preview = cloudSyncPreview.value
    if (!preview) return '应用'
    if (!preview.items.length && preview.usedAlternatePassword) return '确认同步主密码'
    return preview.direction === 'download' ? '下载勾选项' : '上传勾选项'
  })

  // ---- Instantiate Independent SyncEngine ----
  const engine = createSyncEngine({
    feedback,
    autoSyncPasswordGate,
    getVault: deps.getVault,
    isLocked: deps.isLocked,
    isPasswordless: deps.isPasswordless,
    applyAdoptedSessionState: deps.applyAdoptedSessionState,
    rebindDeviceUnlockAfterPasswordChange: deps.rebindDeviceUnlockAfterPasswordChange,
    refreshDeviceUnlockState: deps.refreshDeviceUnlockState,
    publishVaultPayload: deps.publishVaultPayload,
    saveVaultForCurrentSession: deps.saveVaultForCurrentSession,
    handleVaultWriteError: deps.handleVaultWriteError,
    collectLocalAttachmentObjects: deps.collectLocalAttachmentObjects,
    reconcileSelectedEntryAfterVaultUpdate: deps.reconcileSelectedEntryAfterVaultUpdate,
    getSessionGeneration: deps.getSessionGeneration,
    captureSessionGeneration: deps.captureSessionGeneration,
    isSessionGenerationCurrent: deps.isSessionGenerationCurrent,
    getSettings: () => settings,
    syncSettings,
    isSettingsChanged,
    persistSettings,
    hasCompleteOssSettings,
    validateOssSettings,
    isHistoryCleanupEnabled: (scope) => historyCleanupScope.value === scope,
    getSignal: () => cloudSyncRuntime.signal(),
    isCloudBusy: () => cloudBusy.value,
    getCloudSyncPreview: () => cloudSyncPreview.value,
    setCloudSyncPreview: (preview) => { cloudSyncPreview.value = preview },
    isCloudSyncReviewOpen: () => ui.cloudSyncReviewOpen.value,
    hasPendingCloudSyncReview,
    showCloudSyncReview,
    closeCloudSyncReview,
    setBackupStatus: (message) => { backupStatus.value = message },
    setCloudInfo: (info) => { cloudInfo.value = info },
    setCloudBackups: (backups) => { cloudBackups.value = backups },
    getSelectedCloudObjectName: () => selectedCloudObjectName.value,
    setSelectedCloudObjectName: (name) => { selectedCloudObjectName.value = name },
    bumpCloudEncryptionBindingVersion: () => { cloudEncryptionBindingVersion.value += 1 },
    beginCloudOperation,
    markCloudOperation,
    finishCloudOperation,
    cancelCloudOperation,
    appendCloudSyncLog,
    requestCloudVaultPassword,
    resolveCloudPasswordPrompt,
    finishCloudPasswordPrompt
  })

  const cloudEncryptionBindingLabel = computed(() => {
    void cloudEncryptionBindingVersion.value
    const normalizedName = normalizeObjectName(settings.oss.objectName)
    let binding = readCloudEncryptionBinding(engine.cloudSyncStateKey(normalizedName))
    if (!binding && normalizedName.startsWith('pwd/')) {
      binding = readCloudEncryptionBinding(engine.cloudSyncStateKey(normalizedName.slice('pwd/'.length)))
    }
    if (!binding) return '未绑定；首次校验云端主密码后会自动绑定'
    const verifiedAt = new Date(binding.verifiedAt).toISOString()
    return `已绑定 · PBKDF2-SHA256 ${binding.kdf.iterations.toLocaleString()} 次 · ${formatDateTime(verifiedAt)}`
  })

  // ---- Auto-Sync Postpone & Scheduling ----
  function clearAutoSyncPostponeTimer(): void {
    if (typeof window !== 'undefined' && autoSyncPostponeTimer) {
      window.clearTimeout(autoSyncPostponeTimer)
    }
    autoSyncPostponeTimer = 0
  }

  function expireAutoSyncPostponeIfNeeded(): boolean {
    if (autoSyncPostponedUntil.value <= 0) return false
    if (isAutoSyncPostponedAt(autoSyncPostponedUntil.value)) return true
    autoSyncPostponedUntil.value = 0
    writeLocalStorage(AUTO_SYNC_POSTPONE_UNTIL_KEY, '')
    clearAutoSyncPostponeTimer()
    return false
  }

  function armAutoSyncPostponeTimer(): void {
    clearAutoSyncPostponeTimer()
    if (typeof window === 'undefined') return
    const remaining = remainingAutoSyncPostponeMs(autoSyncPostponedUntil.value)
    if (remaining <= 0) return
    const delay = Math.min(remaining, 2147483647)
    autoSyncPostponeTimer = window.setTimeout(() => {
      autoSyncPostponeTimer = 0
      if (expireAutoSyncPostponeIfNeeded()) {
        armAutoSyncPostponeTimer()
        return
      }
      if (backupStatus.value.startsWith('自动同步已推迟')) {
        backupStatus.value = ''
      }
      const hadUpload = pendingAutoUploadDuringPostpone
      const hadDownload = pendingAutoDownloadDuringPostpone
      pendingAutoUploadDuringPostpone = false
      pendingAutoDownloadDuringPostpone = false
      if (!settings.oss.autoSync) return
      if (hadUpload) {
        scheduleAutoCloudUpload()
      } else if (hadDownload) {
        scheduleAutoCloudDownloadCheck()
      }
    }, delay)
  }

  function postponeAutoSync(
    minutes: number = AUTO_SYNC_POSTPONE_DEFAULT_MINUTES,
    options: { fromReview?: boolean } = {}
  ): void {
    const normalizedMinutes = normalizeAutoSyncPostponeMinutes(minutes)
    const until = Date.now() + normalizedMinutes * 60 * 1000
    autoSyncPostponedUntil.value = until
    writeLocalStorage(AUTO_SYNC_POSTPONE_UNTIL_KEY, String(until))
    if (typeof window !== 'undefined') {
      if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
      if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
    }
    autoCloudUploadTimer = 0
    autoCloudDownloadTimer = 0
    armAutoSyncPostponeTimer()

    const untilLabel = formatAutoSyncPostponeTime(until)
    const statusMessage = `自动同步已推迟至 ${untilLabel}`
    if (options.fromReview && cloudSyncPreview.value) {
      const preview = cloudSyncPreview.value
      const stats = cloudSyncSelectionStats(preview.items)
      if (preview.direction === 'upload') pendingAutoUploadDuringPostpone = true
      if (preview.direction === 'download') pendingAutoDownloadDuringPostpone = true
      appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'skipped',
        objectName: preview.objectName,
        message: statusMessage,
        selected: 0,
        total: stats.total,
        ...cloudSyncDiffCountsForItems(preview.items)
      })
      closeCloudSyncReview()
    }
    backupStatus.value = statusMessage
    feedback.toast(`已推迟自动同步 ${formatAutoSyncPostponePresetLabel(normalizedMinutes)}（至 ${untilLabel}）`)
  }

  function resumeAutoSync(options: { triggerCheck?: boolean; toast?: boolean } = {}): void {
    clearAutoSyncPostponeTimer()
    autoSyncPostponedUntil.value = 0
    writeLocalStorage(AUTO_SYNC_POSTPONE_UNTIL_KEY, '')
    if (backupStatus.value.startsWith('自动同步已推迟')) {
      backupStatus.value = ''
    }
    const hadUpload = pendingAutoUploadDuringPostpone
    const hadDownload = pendingAutoDownloadDuringPostpone
    pendingAutoUploadDuringPostpone = false
    pendingAutoDownloadDuringPostpone = false
    if (options.toast !== false) {
      feedback.toast('已恢复自动同步')
    }
    if (options.triggerCheck !== false && settings.oss.autoSync) {
      if (hadUpload) {
        scheduleAutoCloudUpload()
      } else if (hadDownload) {
        scheduleAutoCloudDownloadCheck()
      } else {
        scheduleAutoCloudDownloadCheck()
      }
    }
  }

  function canScheduleAutoCloudSync(): boolean {
    if (!deps.getVault() || !settings.oss.autoSync || deps.isLocked()) return false
    if (expireAutoSyncPostponeIfNeeded()) return false
    if (cloudBusy.value || ui.cloudSyncReviewOpen.value || hasPendingCloudSyncReview()) return false
    if (!hasCompleteOssSettings()) {
      backupStatus.value = '自动同步已开启，请补全 OSS 配置'
      return false
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) return false
    return true
  }

  function startCloudUpload(options: CloudSyncReviewOptions = {}): Promise<void> {
    return engine.prepareCloudSyncReview({ ...options, direction: 'upload' })
  }

  function startCloudDownload(options: CloudSyncReviewOptions = {}): Promise<void> {
    return engine.prepareCloudSyncReview({ ...options, direction: 'download' })
  }

  function scheduleAutoCloudUpload(): void {
    if (!cloudSyncRuntime.canScheduleAutomaticUpload()) return
    if (deps.getVault() && settings.oss.autoSync && !deps.isLocked() && expireAutoSyncPostponeIfNeeded()) {
      pendingAutoUploadDuringPostpone = true
      armAutoSyncPostponeTimer()
      return
    }
    if (!canScheduleAutoCloudSync()) return
    const objectName = normalizeObjectName(settings.oss.objectName)
    if (engine.isAutoSyncPasswordBlocked(objectName)) return
    if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
    autoCloudUploadTimer = window.setTimeout(() => {
      autoCloudUploadTimer = 0
      if (
        cloudSyncRuntime.canScheduleAutomaticUpload() &&
        canScheduleAutoCloudSync() &&
        !engine.isAutoSyncPasswordBlocked(objectName)
      ) {
        void startCloudUpload({ automatic: true, skipPersist: true, objectName })
      }
    }, AUTO_CLOUD_SYNC_UPLOAD_DELAY_MS)
  }

  function scheduleAutoCloudDownloadCheck(forceOrEvent: boolean | Event = false): void {
    if (deps.getVault() && settings.oss.autoSync && !deps.isLocked() && expireAutoSyncPostponeIfNeeded()) {
      pendingAutoDownloadDuringPostpone = true
      armAutoSyncPostponeTimer()
      return
    }
    if (!canScheduleAutoCloudSync()) return
    const objectName = normalizeObjectName(settings.oss.objectName)
    if (engine.isAutoSyncPasswordBlocked(objectName)) return
    const force = forceOrEvent === true
    if (force) {
      cloudSyncRuntime.requireInitialDownload()
      if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
      autoCloudUploadTimer = 0
    }
    const now = Date.now()
    const elapsed = now - lastAutoCloudDownloadCheckAt
    const minInterval = autoCloudDownloadMinIntervalMs()
    const delay = force || elapsed >= minInterval
      ? AUTO_CLOUD_SYNC_DOWNLOAD_DELAY_MS
      : minInterval - elapsed

    if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
    autoCloudDownloadTimer = window.setTimeout(() => {
      autoCloudDownloadTimer = 0
      lastAutoCloudDownloadCheckAt = Date.now()
      if (canScheduleAutoCloudSync() && !engine.isAutoSyncPasswordBlocked(objectName)) {
        cloudSyncRuntime.releaseInitialDownloadBarrier()
        void startCloudDownload({ automatic: true, skipPersist: true, objectName })
      }
    }, delay)
  }

  function clearAutoSyncTimers(): void {
    if (typeof window !== 'undefined') {
      if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
      if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
    }
    autoCloudUploadTimer = 0
    autoCloudDownloadTimer = 0
    clearAutoSyncPostponeTimer()
  }

  function selectCloudBackup(objectName: string): void {
    selectedCloudObjectName.value = normalizeObjectName(objectName)
    backupStatus.value = `本次下载将使用：${selectedCloudObjectName.value}`
  }

  async function applyCloudSyncPreview(): Promise<void> {
    const wasManual = Boolean(cloudSyncPreview.value && !cloudSyncPreview.value.automatic)
    await engine.applyCloudSyncPreview()
    if (wasManual && !cloudSyncPreview.value && autoSyncPostponedUntil.value > 0) {
      resumeAutoSync({ triggerCheck: false, toast: false })
    }
  }

  async function uploadCloudBackup(): Promise<void> {
    await startCloudUpload()
  }

  async function downloadCloudBackup(): Promise<void> {
    await startCloudDownload()
  }

  async function backupCloudVault(): Promise<void> {
    await engine.createDatedCloudBackup()
  }

  async function handleResolveSyncLog(item: CloudSyncLogEntry): Promise<void> {
    if (hasPendingCloudSyncReview()) {
      showCloudSyncReview()
      return
    }
    if (item.direction === 'download' || item.message?.includes('云端保险库主密码与当前会话不同')) {
      await startCloudDownload({ objectName: item.objectName })
      return
    }
    await startCloudUpload({ objectName: item.objectName })
  }

  // ---- Portable Backup & Android Vault Export ----
  const portableBackupPasswordNote = computed(() => {
    const selected = portableBackupSelection.value
    if (!selected) return '请输入备份包创建时使用的主密码；未设置主密码可留空。'
    const details = [
      selected.name || '已选择备份包',
      `${selected.attachmentCount || 0} 个附件`,
      selected.packageBytes ? formatBytes(selected.packageBytes) : ''
    ].filter(Boolean).join(' · ')
    return `${details}。恢复会替换当前保险库，请输入该备份包的主密码；未设置可留空。`
  })

  async function exportPortableBackupPackage(): Promise<void> {
    if (!deps.getVault() || portableBackupBusy.value || !isDesktopRuntime) return
    portableBackupBusy.value = true
    portableBackupStatus.value = '正在生成完整备份包'
    try {
      const result = await api.exportPortableBackupPackage()
      if (!result.ok || !result.data) {
        portableBackupStatus.value = result.message || '完整备份导出失败'
        feedback.failToast(portableBackupStatus.value)
        return
      }
      if (!result.data.saved) {
        portableBackupStatus.value = ''
        return
      }
      portableBackupStatus.value = `已导出 ${result.data.attachmentCount || 0} 个附件 · ${formatBytes(result.data.packageBytes || 0)}`
      feedback.successToast('完整备份已导出')
    } catch (error) {
      portableBackupStatus.value = error instanceof Error ? error.message : '完整备份导出失败'
      feedback.failToast(portableBackupStatus.value)
    } finally {
      portableBackupBusy.value = false
    }
  }

  async function exportAndroidVaultBackup(): Promise<void> {
    if (!deps.getVault() || portableBackupBusy.value || !isAndroidRuntime) return
    portableBackupBusy.value = true
    portableBackupStatus.value = '正在准备加密保险库副本'
    try {
      const result = await api.exportVaultBackup()
      if (!result.ok || !result.data) {
        portableBackupStatus.value = result.message || '保险库导出失败'
        feedback.failToast(portableBackupStatus.value)
        return
      }
      const date = new Date().toISOString().slice(0, 10)
      const exported = await api.exportAndroidVaultFile(`mypwdmg-vault-${date}.json`, result.data.content)
      if (!exported.ok || !exported.data) {
        portableBackupStatus.value = exported.message || '保险库导出失败'
        feedback.failToast(portableBackupStatus.value)
        return
      }
      if (!exported.data.saved) {
        portableBackupStatus.value = ''
        return
      }
      portableBackupStatus.value = '加密保险库已导出（不含附件）'
      feedback.successToast('保险库已导出')
    } catch (error) {
      portableBackupStatus.value = error instanceof Error ? error.message : '保险库导出失败'
      feedback.failToast(portableBackupStatus.value)
    } finally {
      portableBackupBusy.value = false
    }
  }

  async function beginPortableBackupImport(): Promise<void> {
    if (!deps.getVault() || portableBackupBusy.value || !isDesktopRuntime) return
    try {
      await feedback.confirm({
        title: '恢复完整备份',
        message: '恢复会替换当前保险库，并保留一份替换前的本地保险库备份。确认选择备份包吗？',
        confirmButtonText: '选择备份包'
      })
    } catch {
      return
    }
    portableBackupBusy.value = true
    portableBackupStatus.value = '正在校验备份包'
    try {
      const result = await api.selectPortableBackupPackage()
      if (!result.ok || !result.data) {
        portableBackupStatus.value = result.message || '备份包校验失败'
        feedback.failToast(portableBackupStatus.value)
        return
      }
      if (!result.data.selected || !result.data.selectionToken) {
        portableBackupStatus.value = ''
        return
      }
      portableBackupSelection.value = result.data
      portableBackupPassword.value = ''
      ui.portableBackupPasswordOpen.value = true
      portableBackupStatus.value = `已校验 ${result.data.attachmentCount || 0} 个附件，等待密码确认`
    } catch (error) {
      portableBackupStatus.value = error instanceof Error ? error.message : '备份包校验失败'
      feedback.failToast(portableBackupStatus.value)
    } finally {
      portableBackupBusy.value = false
    }
  }

  async function submitPortableBackupImport(): Promise<void> {
    const token = portableBackupSelection.value?.selectionToken
    if (!token || portableBackupBusy.value) return
    portableBackupBusy.value = true
    portableBackupStatus.value = '正在验证并恢复完整备份'
    try {
      const result = await api.importPortableBackupPackage(token, portableBackupPassword.value)
      if (!result.ok || !result.data) {
        portableBackupStatus.value = result.message || '完整备份恢复失败'
        feedback.failToast(result.code === 'BAD_PASSWORD' ? '备份密码错误或文件已损坏' : portableBackupStatus.value)
        return
      }
      ui.portableBackupPasswordOpen.value = false
      portableBackupSelection.value = null
      portableBackupPassword.value = ''
      deps.applyLockedUiState()
      feedback.successToast(`已恢复 ${result.data.attachmentCount} 个附件，请重新解锁`)
    } catch (error) {
      portableBackupStatus.value = error instanceof Error ? error.message : '完整备份恢复失败'
      feedback.failToast(portableBackupStatus.value)
    } finally {
      portableBackupBusy.value = false
    }
  }

  function clearPortableBackupSelection(): void {
    const token = portableBackupSelection.value?.selectionToken
    portableBackupSelection.value = null
    ui.portableBackupPasswordOpen.value = false
    portableBackupPassword.value = ''
    if (token && isDesktopRuntime) void api.discardPortableBackupSelection(token)
  }

  function cancelPortableBackupImport(): void {
    if (portableBackupBusy.value) return
    ui.portableBackupPasswordOpen.value = false
    clearPortableBackupSelection()
    portableBackupStatus.value = ''
  }

  function handlePortableBackupPromptClosed(): void {
    if (portableBackupSelection.value && !portableBackupBusy.value) clearPortableBackupSelection()
  }

  function clearAllAutoSyncPasswordGates(): void {
    autoSyncPasswordGate.clearAll()
  }

  function resetOnLock(): void {
    // Note: intentionally preserves autoSyncPasswordGate across lock cycles!
    cancelCloudOperation()
    cloudInfo.value = null
    cloudBackups.value = []
    selectedCloudObjectName.value = ''
    closeCloudSyncReview()
    backupStatus.value = ''
    portableBackupStatus.value = ''
    portableBackupBusy.value = false
    clearPortableBackupSelection()
    resolveCloudPasswordPrompt(null)
    syncSettings()
    clearAutoSyncTimers()
  }

  return {
    // Constants
    AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES,
    AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES,
    AUTO_SYNC_POSTPONE_PRESET_MINUTES,
    CLOUD_SYNC_LOG_LIMIT_MIN,
    CLOUD_SYNC_LOG_LIMIT_MAX,
    // Settings & Cloud State
    settings,
    autoSyncPostponedUntil,
    isAutoSyncPostponed,
    autoSyncPostponedUntilLabel,
    historyCleanupEnabled,
    cloudBusy,
    backupStatus,
    cloudInfo,
    cloudBackups,
    selectedCloudObjectName,
    cloudSyncPreview,
    cloudSyncLogs,
    cloudSyncLogLimit,
    cloudEncryptionBindingLabel,
    cloudSyncDiffCounts,
    cloudSyncSelectedCount,
    cloudSyncReviewTitle,
    cloudSyncReviewActionText,
    // Password Prompt State
    cloudPasswordPromptValue,
    cloudPasswordPromptBusy,
    // Portable Backup State
    portableBackupBusy,
    portableBackupStatus,
    portableBackupSelection,
    portableBackupPassword,
    portableBackupPasswordNote,
    // Settings Actions
    updateOssSetting,
    syncSettings,
    setAutoSyncIntervalMinutes,
    setHistoryCleanupEnabled,
    hasCompleteOssSettings,
    validateOssSettings,
    isSettingsChanged,
    persistSettings,
    saveSettings,
    // Cloud Sync Operations
    purgeLegacyCloudSyncState,
    beginCloudOperation,
    markCloudOperation,
    finishCloudOperation,
    cancelCloudOperation,
    checkCloudBackupInfo: engine.checkCloudBackupInfo,
    refreshCloudBackupList: engine.refreshCloudBackupList,
    rebindCloudEncryption: engine.rebindCloudEncryption,
    prepareCloudRewriteForPasswordChange: engine.prepareCloudRewriteForPasswordChange,
    rewriteCloudAfterPasswordChange: engine.rewriteCloudAfterPasswordChange,
    applyCloudSyncPreview,
    uploadCloudBackup,
    downloadCloudBackup,
    backupCloudVault,
    startCloudUpload,
    startCloudDownload,
    selectCloudBackup,
    scheduleAutoCloudUpload,
    scheduleAutoCloudDownloadCheck,
    clearAutoSyncTimers,
    postponeAutoSync,
    resumeAutoSync,
    formatAutoSyncPostponePresetLabel,
    clearAllAutoSyncPasswordGates,
    // Review UI Actions
    hasPendingCloudSyncReview,
    showCloudSyncReview,
    hideCloudSyncReview,
    closeCloudSyncReview,
    discardCloudSyncReview,
    setAllCloudSyncDiffs,
    isCloudSyncItemChecked,
    setCloudSyncItemChecked,
    setCloudSyncDetailChecked,
    cloudSyncChangeLabel,
    cloudSyncItemSummary,
    // Cloud Password Prompt Actions
    requestCloudVaultPassword,
    submitCloudPasswordPrompt,
    cancelCloudPasswordPrompt,
    handleCloudPasswordPromptClosed,
    resolveCloudPasswordPrompt,
    finishCloudPasswordPrompt,
    // Sync Log Actions & Formatters
    setCloudSyncLogLimit,
    clearCloudSyncLogs,
    handleResolveSyncLog,
    cloudSyncDirectionLabel,
    cloudSyncLogStatusLabel,
    cloudSyncLogTitle,
    cloudSyncLogSummary,
    // Portable Backup Actions
    exportPortableBackupPackage,
    exportAndroidVaultBackup,
    beginPortableBackupImport,
    submitPortableBackupImport,
    cancelPortableBackupImport,
    handlePortableBackupPromptClosed,
    clearPortableBackupSelection,
    // Lifecycle
    resetOnLock
  }
}

export type SyncStore = ReturnType<typeof createSyncStore>
export const useSyncStore = createSyncStore
