import { computed, reactive, ref, watch } from 'vue'
import { useVaultSession } from '../composables/useVaultSession.ts'
import type {
  CloudOperationDirection,
  CloudOperationHandle,
  CloudOperationKind,
  CloudOperationStage
} from '../composables/useCloudSync.ts'
import { api } from '../services/api.ts'
import { clearSensitiveClipboard } from '../services/clipboardSecurity.ts'
import { clearAllFeedback } from '../services/uiFeedback.ts'
import {
  SESSION_TIMEOUT_DEFAULT_MINUTES,
  SESSION_TIMEOUT_MAX_MINUTES,
  SESSION_TIMEOUT_MIN_MINUTES,
  loadSessionTimeoutMinutes,
  sessionTimeoutMilliseconds
} from '../services/sessionTimeout.ts'
import type { CloudRewritePlan } from '../services/sync/syncEngine.ts'
import {
  blurActiveElement,
  formatBytes,
  isAndroidRuntime,
  isExternalNativeRuntime,
  noopUiFeedback,
  packagedAppVersion,
  readLocalStorage,
  writeLocalStorage,
  type UiFeedback
} from '../services/runtime.ts'
import type { UiStore } from './uiStore.ts'
import type {
  ApiResult,
  AppState,
  AppUpdateCheck,
  AppUpdateProgress,
  DeviceUnlockState,
  VaultPayload
} from '../types.ts'

export const SESSION_TIMEOUT_KEY = 'mypwdmg.sessionTimeoutMinutes'
export const UPDATE_MANIFEST_URL_KEY = 'mypwdmg.updateManifestUrl'
export const GITHUB_UPDATE_MANIFEST_URL = 'https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json'
export const DEFAULT_UPDATE_MANIFEST_URL = GITHUB_UPDATE_MANIFEST_URL
const BUILT_IN_MANIFEST_URL_PATTERN =
  /^(?:https:\/\/ghproxy\.net\/)?https:\/\/github\.com\/suzikuo\/pwdmg\/releases\/(?:latest\/download|download\/[^/]+)\/update-manifest\.json$/i
const EXTERNAL_VAULT_REFRESH_DELAY_MS = 180
const EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS = 900

function resolveUpdateManifestUrl(value: string | null): string {
  const url = (value || '').trim()
  if (!url || url.includes('OWNER/REPO') || BUILT_IN_MANIFEST_URL_PATTERN.test(url)) {
    return DEFAULT_UPDATE_MANIFEST_URL
  }
  return url
}

export type SessionSyncBridge = {
  isCloudBusy: () => boolean
  hasPendingCloudSyncReview: () => boolean
  hasCompleteOssSettings: () => boolean
  beginCloudOperation: (
    kind?: CloudOperationKind,
    options?: { direction?: CloudOperationDirection; automatic?: boolean; message?: string }
  ) => CloudOperationHandle | null
  markCloudOperation: (operation: CloudOperationHandle | null, stage: CloudOperationStage, message?: string) => boolean
  finishCloudOperation: (
    operation: CloudOperationHandle | null,
    stage?: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'>,
    message?: string
  ) => void
  prepareCloudRewriteForPasswordChange: () => Promise<CloudRewritePlan | null>
  rewriteCloudAfterPasswordChange: (
    plan: CloudRewritePlan,
    operation: CloudOperationHandle | null,
    isCurrent: () => boolean
  ) => Promise<string>
  setBackupStatus: (message: string) => void
  scheduleAutoCloudUpload: () => void
  scheduleAutoCloudDownloadCheck: (forceOrEvent?: boolean | Event) => void
  clearAllAutoSyncPasswordGates: () => void
  resetOnLock: () => void
}

export type SessionVaultBridge = {
  getVault: () => VaultPayload | null
  publishVaultPayload: (next: VaultPayload) => boolean
  applyAndroidAutofillSearch: () => void
  reconcileSelectedEntryAfterVaultUpdate: (payload: VaultPayload) => void
  resetOnLock: () => void
}

export type SessionStoreDeps = {
  ui: UiStore
  feedback?: UiFeedback
  isPluginBusy?: () => boolean
  resetPluginListenerSettings?: () => void
}

export function createSessionStore(deps: SessionStoreDeps) {
  const feedback = deps.feedback || noopUiFeedback
  const { ui } = deps

  let vaultBridge: SessionVaultBridge | null = null
  const vaultBridgeVersion = ref(0)
  let syncBridge: SessionSyncBridge | null = null

  function bindVaultBridge(bridge: SessionVaultBridge): void {
    vaultBridge = bridge
    vaultBridgeVersion.value += 1
  }

  function bindSyncBridge(bridge: SessionSyncBridge): void {
    syncBridge = bridge
  }

  const state = reactive<AppState>({
    hasVault: false,
    locked: true,
    expiresAt: 0,
    legacyAvailable: false,
    vaultPath: '',
    passwordless: false
  })
  const stateLoading = ref(true)
  const stateError = ref('')
  const busy = ref(false)
  let busyOperationId = 0

  const appVersion = ref('')
  const displayAppVersion = computed(() => appVersion.value || packagedAppVersion || '0.0.0')

  // Auth form state
  const password = ref('')
  const newPassword = ref('')
  const confirmPassword = ref('')

  // Master password change form state
  const changePasswordValue = ref('')
  const changePasswordConfirm = ref('')
  let passwordChangeInProgress = false

  // Device unlock state
  const deviceUnlockState = ref<DeviceUnlockState>({ supported: false, enabled: false, expiresAt: 0 })
  const deviceUnlockPassword = ref('')
  const deviceUnlockReauthSeconds = ref(7 * 24 * 60 * 60)

  const deviceUnlockSettingsLabel = computed(() => {
    if (!deviceUnlockState.value.enabled) return '使用系统硬件/凭据安全层保护'
    const expiresAt = deviceUnlockState.value.expiresAt
    return expiresAt > 0 ? `有效至 ${new Date(expiresAt * 1000).toLocaleDateString()}` : '已启用'
  })

  // Session timeout & generation
  const sessionTimeoutMinutes = ref(loadSessionTimeoutMinutes(readLocalStorage(SESSION_TIMEOUT_KEY)))
  const unlocked = computed(() => {
    void vaultBridgeVersion.value
    const locked = state.locked
    const currentVault = vaultBridge?.getVault()
    return !locked && Boolean(currentVault)
  })

  const vaultSession = useVaultSession(() => {
    if (unlocked.value) void lockVault()
  }, () => sessionTimeoutMilliseconds(sessionTimeoutMinutes.value))

  // External disk refresh & native lock subscription
  let externalVaultRefreshTimer = 0
  let lastExternalVaultRefreshAt = 0
  let externalVaultRefreshing = false
  let unsubscribeNativeLock: (() => void) | null = null

  // App update state
  const updateBusy = ref<'check' | 'download' | 'apply' | ''>('')
  const updateStatus = ref('')
  const updateManifestUrl = ref(resolveUpdateManifestUrl(readLocalStorage(UPDATE_MANIFEST_URL_KEY)))
  const updateInfo = ref<AppUpdateCheck | null>(null)
  const updateProgress = ref<AppUpdateProgress | null>(null)
  const downloadedUpdatePath = ref('')

  const showUpdateSettings = computed(() => isExternalNativeRuntime)
  const updatePlatform = computed(() => updateInfo.value?.platform || (isAndroidRuntime ? 'android' : 'desktop'))
  const updateInstallButtonText = computed(() => updatePlatform.value === 'android' ? '打开安装器' : '安装并重启')
  const updateInstallModeText = computed(() => {
    if (!updateInfo.value?.canApply) return '仅检查/下载'
    return updatePlatform.value === 'android' ? '系统安装器' : '自动安装'
  })
  const updateProgressPercent = computed(() => {
    const progress = updateProgress.value?.progress || 0
    return Math.max(0, Math.min(100, Math.round(progress)))
  })
  const updateProgressLabel = computed(() => {
    const progress = updateProgress.value
    if (!progress) return ''
    if (progress.message) return progress.message
    if (progress.phase === 'download') return '正在下载更新包'
    if (progress.phase === 'verify') return '正在校验更新包'
    return '正在检查更新'
  })

  // ---- Busy Coordinator ----
  function beginBusyOperation(): number {
    busyOperationId += 1
    busy.value = true
    return busyOperationId
  }

  function finishBusyOperation(operationId: number): void {
    if (operationId !== busyOperationId) return
    busy.value = false
  }

  function resetBusyOperation(): void {
    busyOperationId += 1
    busy.value = false
  }

  // ---- Session Helpers ----
  function scheduleSessionLock(): void {
    vaultSession.schedule(unlocked.value)
  }

  watch(unlocked, scheduleSessionLock, { immediate: true })

  function handleSessionActivity(event: Event): void {
    if (!event.isTrusted || !unlocked.value) return
    scheduleSessionLock()
  }

  function updateSessionTimeout(value: number | string): void {
    const next = loadSessionTimeoutMinutes(value)
    sessionTimeoutMinutes.value = next
    writeLocalStorage(SESSION_TIMEOUT_KEY, String(next))
    scheduleSessionLock()
  }

  function activateVaultSession(next: VaultPayload, expectedGeneration: number): boolean {
    if (!vaultSession.isCurrent(expectedGeneration)) return false
    vaultSession.invalidate()
    state.locked = false
    return Boolean(vaultBridge?.publishVaultPayload(next))
  }

  async function saveVaultForCurrentSession(next: VaultPayload): Promise<ApiResult<VaultPayload>> {
    const generation = vaultSession.capture()
    const result = await api.saveVault(next)
    if (!vaultSession.isCurrent(generation) || state.locked) {
      return { ok: false, code: 'LOCKED', message: '保险库会话已变化，已丢弃过期保存结果' }
    }
    return result
  }

  function applyAdoptedSessionState(appState: Record<string, unknown>, nextPassword: string): void {
    Object.assign(state, appState)
    state.passwordless = nextPassword === ''
  }

  function syncAppVersion(value: unknown): void {
    const version = String(value || '').trim()
    if (version) appVersion.value = version
  }

  async function loadAppInfo(): Promise<void> {
    const result = await api.getAppInfo()
    if (result.ok) syncAppVersion(result.data?.version)
  }

  // ---- Startup / Unlock / Create / Lock ----
  async function refreshDeviceUnlockState(): Promise<void> {
    const result = await api.getDeviceUnlockState()
    deviceUnlockState.value = result.ok && result.data
      ? result.data
      : { supported: false, enabled: false, expiresAt: 0 }
  }

  async function loadState(): Promise<void> {
    const generation = vaultSession.capture()
    stateLoading.value = true
    stateError.value = ''
    let shouldAutoUnlock = false
    try {
      const result = await api.getStartupData()
      if (!vaultSession.isCurrent(generation)) return
      if (result.ok && result.data) {
        Object.assign(state, result.data.state)
        if (result.data.vault) {
          if (!activateVaultSession(result.data.vault, generation)) return
          vaultBridge?.applyAndroidAutofillSearch()
          syncBridge?.scheduleAutoCloudDownloadCheck(true)
        } else if (state.hasVault) {
          if (state.locked && state.passwordless) shouldAutoUnlock = true
          else if (!state.locked) await loadUnlockedVault()
        }
      } else {
        stateError.value = result.message || '无法连接本地保险库'
      }
      await refreshDeviceUnlockState()
      if (state.hasVault && state.locked && deviceUnlockState.value.enabled) {
        shouldAutoUnlock = true
      }
    } finally {
      stateLoading.value = false
      void api.showDesktopWindow()
    }

    if (shouldAutoUnlock && typeof window !== 'undefined') {
      window.setTimeout(() => {
        if (state.locked && deviceUnlockState.value.enabled) {
          void unlockWithDevice()
        } else if (state.locked && state.passwordless) {
          void unlockWithPassword('', true)
        }
      }, 0)
    }
  }

  async function createVault(): Promise<void> {
    if (busy.value) return
    const generation = vaultSession.capture()
    if (newPassword.value !== confirmPassword.value) {
      feedback.failToast('两次密码不一致')
      return
    }
    const operationId = beginBusyOperation()
    try {
      const result = await api.createVault(newPassword.value, false)
      if (!result.ok || !result.data) {
        feedback.failToast(result.message || '创建失败')
        return
      }
      if (!vaultSession.isCurrent(generation)) return
      state.hasVault = true
      if (!activateVaultSession(result.data.vault, generation)) return
      newPassword.value = ''
      confirmPassword.value = ''
      vaultBridge?.applyAndroidAutofillSearch()
      feedback.successToast('保险库已创建')
    } catch {
      feedback.failToast('创建失败，请重试')
    } finally {
      finishBusyOperation(operationId)
    }
  }

  async function unlockVault(): Promise<void> {
    await unlockWithPassword(password.value)
  }

  async function unlockWithPassword(candidate: string, silent = false): Promise<boolean> {
    if (!silent && busy.value) return false
    const generation = vaultSession.capture()
    const operationId = silent ? 0 : beginBusyOperation()
    try {
      const result = await api.unlock(candidate)
      if (!result.ok || !result.data) {
        if (!silent) feedback.failToast(result.message || '解锁失败')
        return false
      }
      if (!activateVaultSession(result.data, generation)) return false
      password.value = ''
      if (candidate) syncBridge?.clearAllAutoSyncPasswordGates()
      vaultBridge?.applyAndroidAutofillSearch()
      syncBridge?.scheduleAutoCloudDownloadCheck(true)
      return true
    } catch {
      if (!silent) feedback.failToast('解锁失败，请重试')
      return false
    } finally {
      if (operationId) finishBusyOperation(operationId)
    }
  }

  async function unlockWithDevice(): Promise<void> {
    if (busy.value || !deviceUnlockState.value.enabled) return
    const generation = vaultSession.capture()
    const operationId = beginBusyOperation()
    try {
      const result = await api.quickUnlock()
      if (!result.ok || !result.data) {
        await refreshDeviceUnlockState()
        feedback.failToast(result.message || '设备快速解锁失败')
        return
      }
      if (!activateVaultSession(result.data, generation)) return
      password.value = ''
      syncBridge?.scheduleAutoCloudDownloadCheck(true)
      feedback.successToast('已使用设备密钥解锁')
    } catch {
      await refreshDeviceUnlockState()
      feedback.failToast('设备快速解锁失败，请使用主密码')
    } finally {
      finishBusyOperation(operationId)
    }
  }

  async function loadUnlockedVault(): Promise<boolean> {
    const generation = vaultSession.capture()
    const result = await api.getVault()
    if (!result.ok || !result.data) {
      applyLockedUiState()
      return false
    }
    if (!activateVaultSession(result.data, generation)) return false
    vaultBridge?.applyAndroidAutofillSearch()
    syncBridge?.scheduleAutoCloudDownloadCheck(true)
    return true
  }

  function applyLockedUiState(): void {
    vaultBridge?.resetOnLock()
    syncBridge?.resetOnLock()
    resetBusyOperation()
    vaultSession.invalidate()
    state.locked = true
    state.expiresAt = 0
    password.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    changePasswordValue.value = ''
    changePasswordConfirm.value = ''
    deps.resetPluginListenerSettings?.()
    resetDeviceUnlockDraft()
    ui.clearAllOverlays()
    clearAllFeedback()
    if (typeof window !== 'undefined' && externalVaultRefreshTimer) {
      window.clearTimeout(externalVaultRefreshTimer)
    }
    externalVaultRefreshTimer = 0
    vaultSession.cancel()
    blurActiveElement()
    clearSensitiveClipboard().catch(() => {})
  }

  async function lockVault(): Promise<void> {
    applyLockedUiState()
    try {
      const result = await api.lock()
      if (result.ok) return
      stateError.value = result.message || '后端锁定失败'
      feedback.failToast('本地敏感内容已清除，但后端锁定失败；请安全退出应用')
    } catch {
      stateError.value = '后端锁定失败'
      feedback.failToast('本地敏感内容已清除，但后端锁定失败；请安全退出应用')
    }
  }

  function handleDesktopLockRequest(): void {
    if (unlocked.value) void lockVault()
  }

  async function safeExit(): Promise<void> {
    ui.moreMenuOpen.value = false
    ui.drawerOpen.value = false
    try {
      const result = await api.safeExit()
      if (!result.ok) {
        feedback.failToast(result.message || '安全退出失败')
        return
      }
      if (!isExternalNativeRuntime) {
        await lockVault()
        feedback.toast('已安全退出并锁定保险库')
      }
    } catch {
      feedback.failToast('安全退出失败，请手动关闭应用')
    }
  }

  // ---- Device Unlock & Master Password Change ----
  async function rebindDeviceUnlockAfterPasswordChange(nextPassword: string): Promise<string> {
    const existing = await api.getDeviceUnlockState()
    if (!existing.ok || !existing.data?.enabled) return ''
    const remainingSeconds = existing.data.expiresAt - Math.floor(Date.now() / 1000)
    if (!nextPassword || remainingSeconds <= 0) {
      const disabled = await api.disableDeviceUnlock()
      return disabled.ok ? '' : (disabled.message || '无法清理旧的设备快速解锁密钥')
    }
    const rebound = await api.enableDeviceUnlock(nextPassword, remainingSeconds)
    if (rebound.ok && rebound.data) {
      deviceUnlockState.value = rebound.data
      return ''
    }
    await api.disableDeviceUnlock()
    return rebound.message || '设备快速解锁密钥未能同步，已关闭设备快速解锁'
  }

  function resetDeviceUnlockDraft(): void {
    deviceUnlockPassword.value = ''
    deviceUnlockReauthSeconds.value = 7 * 24 * 60 * 60
  }

  function toggleDeviceUnlock(enabled: boolean): void {
    if (enabled) {
      if (state.passwordless) {
        feedback.toast('当前保险库未设置主密码，无需设备快速解锁')
        return
      }
      resetDeviceUnlockDraft()
      ui.deviceUnlockSheetOpen.value = true
      return
    }
    void disableDeviceUnlock()
  }

  async function enableDeviceUnlock(): Promise<void> {
    if (busy.value || !deviceUnlockPassword.value) {
      feedback.toast('请输入当前主密码')
      return
    }
    const operationId = beginBusyOperation()
    try {
      const result = await api.enableDeviceUnlock(deviceUnlockPassword.value, deviceUnlockReauthSeconds.value)
      if (!result.ok || !result.data) {
        feedback.failToast(result.message || '启用设备快速解锁失败')
        return
      }
      deviceUnlockState.value = result.data
      ui.deviceUnlockSheetOpen.value = false
      resetDeviceUnlockDraft()
      feedback.successToast('设备快速解锁已启用')
    } catch {
      feedback.failToast('启用设备快速解锁失败')
    } finally {
      finishBusyOperation(operationId)
    }
  }

  async function disableDeviceUnlock(): Promise<void> {
    try {
      await feedback.confirm({
        title: '关闭设备快速解锁',
        message: '关闭后，下次锁定只能使用主密码解锁。',
        confirmButtonText: '关闭'
      })
    } catch {
      return
    }
    const result = await api.disableDeviceUnlock()
    if (!result.ok || !result.data) {
      feedback.failToast(result.message || '关闭失败')
      return
    }
    deviceUnlockState.value = result.data
    feedback.successToast('设备快速解锁已关闭')
  }

  function resetPasswordDraft(): void {
    changePasswordValue.value = ''
    changePasswordConfirm.value = ''
  }

  function openPasswordSheet(): void {
    resetPasswordDraft()
    ui.passwordSheetOpen.value = true
  }

  async function changePassword(): Promise<void> {
    if (busy.value || passwordChangeInProgress) {
      feedback.toast('正在处理上一次主密码修改，请稍候')
      return
    }
    if (changePasswordValue.value !== changePasswordConfirm.value) {
      feedback.failToast('两次密码不一致')
      return
    }
    if (syncBridge?.isCloudBusy() || ui.cloudSyncReviewOpen.value || syncBridge?.hasPendingCloudSyncReview()) {
      feedback.toast('请先完成或放弃当前云端同步校验')
      return
    }

    passwordChangeInProgress = true
    const nextPassword = changePasswordValue.value
    try {
      await feedback.confirm({
        className: 'password-change-confirm-dialog',
        overlayStyle: { zIndex: 4999 },
        title: nextPassword ? '修改主密码' : '清空主密码',
        message: nextPassword
          ? '将使用新主密码重新加密当前保险库，确认继续吗？'
          : '清空后打开保险库时可留空进入，确认继续吗？',
        confirmButtonText: '确认修改',
        confirmButtonColor: nextPassword ? undefined : '#ee0a24'
      })
    } catch {
      passwordChangeInProgress = false
      return
    }

    if (syncBridge?.isCloudBusy() || ui.cloudSyncReviewOpen.value || syncBridge?.hasPendingCloudSyncReview()) {
      passwordChangeInProgress = false
      feedback.toast('请先完成或放弃当前云端同步校验')
      return
    }
    ui.passwordSheetOpen.value = false
    const generation = vaultSession.capture()
    const cloudRewriteEnabled = Boolean(syncBridge?.hasCompleteOssSettings())
    const operationId = beginBusyOperation()
    const cloudOperation = cloudRewriteEnabled
      ? syncBridge?.beginCloudOperation('password-rewrite', { message: '正在准备云端重新加密' }) ?? null
      : null
    if (cloudRewriteEnabled && !cloudOperation) {
      finishBusyOperation(operationId)
      passwordChangeInProgress = false
      feedback.toast('当前已有云端操作，请稍候再修改主密码')
      return
    }
    let localPasswordChanged = false
    let deviceUnlockError = ''
    try {
      syncBridge?.markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端保险库')
      const cloudRewrite = syncBridge
        ? await syncBridge.prepareCloudRewriteForPasswordChange()
        : null
      if (!vaultSession.isCurrent(generation) || state.locked) return

      syncBridge?.markCloudOperation(cloudOperation, 'applying-local', '正在修改本地主密码')
      const result = await api.changePassword(nextPassword)
      if (!vaultSession.isCurrent(generation) || state.locked) return
      if (!result.ok || !result.data) {
        feedback.failToast(result.message || '修改失败')
        return
      }
      localPasswordChanged = true
      Object.assign(state, result.data)
      state.passwordless = nextPassword === ''

      deviceUnlockError = await rebindDeviceUnlockAfterPasswordChange(nextPassword)
      await refreshDeviceUnlockState()
      const refreshedVault = await api.getVault()
      if (!vaultSession.isCurrent(generation) || state.locked) return
      if (!refreshedVault.ok || !refreshedVault.data || !vaultBridge?.publishVaultPayload(refreshedVault.data)) {
        applyLockedUiState()
        await api.lock()
        feedback.failToast('主密码已修改，但无法重新载入保险库；请使用新密码解锁')
        return
      }

      let cloudRewriteError = ''
      if (cloudRewrite && syncBridge) {
        cloudRewriteError = await syncBridge.rewriteCloudAfterPasswordChange(
          cloudRewrite,
          cloudOperation,
          () => vaultSession.isCurrent(generation) && !state.locked
        )
        if (!vaultSession.isCurrent(generation) || state.locked) return
      }

      changePasswordValue.value = ''
      changePasswordConfirm.value = ''
      ui.passwordSheetOpen.value = false
      const passwordChangeWarnings = [deviceUnlockError, cloudRewriteError].filter(Boolean)
      if (passwordChangeWarnings.length) {
        const msg = `本地主密码已修改，但${passwordChangeWarnings.join('；')}`
        syncBridge?.setBackupStatus(msg)
        feedback.failToast(msg)
      } else {
        feedback.successToast(cloudRewrite ? '主密码及云端保险库已重新加密' : '主密码已修改')
      }
    } catch (error) {
      if (!vaultSession.isCurrent(generation) || state.locked) return
      const message = error instanceof Error ? error.message : String(error)
      feedback.failToast(localPasswordChanged ? `本地主密码已修改，但${message}` : message)
    } finally {
      finishBusyOperation(operationId)
      if (cloudOperation) syncBridge?.finishCloudOperation(cloudOperation)
      passwordChangeInProgress = false
    }
  }

  // ---- External Vault Disk Refresh ----
  function scheduleExternalVaultRefresh(): void {
    if (!isExternalNativeRuntime || !vaultBridge?.getVault() || state.locked || typeof window === 'undefined') return
    if (externalVaultRefreshTimer) window.clearTimeout(externalVaultRefreshTimer)
    const now = Date.now()
    const delay =
      now - lastExternalVaultRefreshAt < EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS
        ? EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS
        : EXTERNAL_VAULT_REFRESH_DELAY_MS
    externalVaultRefreshTimer = window.setTimeout(() => {
      externalVaultRefreshTimer = 0
      void refreshVaultFromDisk()
    }, delay)
  }

  async function refreshVaultFromDisk(): Promise<void> {
    const currentVault = vaultBridge?.getVault()
    if (!isExternalNativeRuntime || externalVaultRefreshing || !currentVault || state.locked) return
    if (busy.value || syncBridge?.isCloudBusy() || deps.isPluginBusy?.() || updateBusy.value) return
    if (ui.editorOpen.value || ui.passwordSheetOpen.value || ui.passkeyManagerOpen.value) return

    externalVaultRefreshing = true
    const generation = vaultSession.capture()
    lastExternalVaultRefreshAt = Date.now()
    const previousRevision = currentVault.revision
    try {
      const result = await api.getVault()
      if (!vaultSession.isCurrent(generation)) return
      if (!result.ok || !result.data) {
        if (result.code === 'LOCKED') applyLockedUiState()
        return
      }
      if (!vaultBridge?.publishVaultPayload(result.data)) return
      if (result.data.revision !== previousRevision) syncBridge?.scheduleAutoCloudUpload()
      vaultBridge.reconcileSelectedEntryAfterVaultUpdate(result.data)
    } finally {
      externalVaultRefreshing = false
    }
  }

  function handleVisibilityChange(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      scheduleExternalVaultRefresh()
      syncBridge?.scheduleAutoCloudDownloadCheck()
    }
  }

  // ---- Native Lock Subscription ----
  function mountNativeLockSubscription(): void {
    unsubscribeNativeLock = api.subscribeNativeLock(() => {
      applyLockedUiState()
    })
  }

  function unmountNativeLockSubscription(): void {
    if (typeof window !== 'undefined' && externalVaultRefreshTimer) {
      window.clearTimeout(externalVaultRefreshTimer)
    }
    externalVaultRefreshTimer = 0
    vaultSession.cancel()
    unsubscribeNativeLock?.()
    unsubscribeNativeLock = null
  }

  // ---- App Update Actions ----
  function currentUpdateManifestUrl(): string {
    const url = resolveUpdateManifestUrl(updateManifestUrl.value)
    updateManifestUrl.value = url
    writeLocalStorage(UPDATE_MANIFEST_URL_KEY, url)
    return url
  }

  function formatUpdateProgress(progress: AppUpdateProgress): string {
    if (progress.phase === 'download') {
      const downloaded = progress.downloaded ? formatBytes(progress.downloaded) : ''
      const total = progress.total ? formatBytes(progress.total) : ''
      const percent = progress.progress ? `${Math.round(progress.progress)}%` : ''
      if (downloaded && total) return `正在下载 ${downloaded} / ${total}${percent ? ` (${percent})` : ''}`
      if (downloaded) return `正在下载 ${downloaded}`
      return progress.message || '正在下载更新包'
    }
    if (progress.phase === 'verify') return progress.message || '正在校验更新包'
    return progress.message || '正在检查更新'
  }

  function handleUpdateProgress(progress: AppUpdateProgress): void {
    updateProgress.value = progress
    const label = formatUpdateProgress(progress)
    if (label) updateStatus.value = label
  }

  async function checkUpdate(): Promise<void> {
    if (updateBusy.value) return
    const manifestUrl = currentUpdateManifestUrl()
    if (!manifestUrl) return

    updateBusy.value = 'check'
    updateProgress.value = { action: 'check', phase: 'check', progress: 8, message: '正在获取版本信息' }
    updateStatus.value = '正在获取版本信息'
    downloadedUpdatePath.value = ''
    try {
      const result = await api.checkAppUpdate(manifestUrl, handleUpdateProgress)
      if (!result.ok || !result.data) {
        updateStatus.value = result.message || '检查更新失败'
        feedback.failToast(updateStatus.value)
        return
      }
      updateInfo.value = result.data
      if (result.data.currentVersion) {
        syncAppVersion(result.data.currentVersion)
      }
      updateStatus.value = result.data.updateAvailable
        ? `发现新版本 ${result.data.latestVersion}`
        : '当前已是最新版本'
      feedback.toast(updateStatus.value)
    } catch (err) {
      console.error('checkAppUpdate error:', err)
      updateStatus.value = err instanceof Error ? err.message : '检查更新失败'
      feedback.failToast(updateStatus.value)
    } finally {
      updateBusy.value = ''
      updateProgress.value = null
    }
  }

  async function downloadUpdate(): Promise<void> {
    if (updateBusy.value) return
    const manifestUrl = currentUpdateManifestUrl()
    if (!manifestUrl) return

    updateBusy.value = 'download'
    updateProgress.value = { action: 'download', phase: 'download', progress: 3, message: '正在准备下载' }
    updateStatus.value = '正在准备下载'
    try {
      const result = await api.downloadAppUpdate(manifestUrl, handleUpdateProgress)
      if (!result.ok || !result.data) {
        updateStatus.value = result.message || '下载更新失败'
        feedback.failToast(updateStatus.value)
        return
      }
      if (result.data.update) {
        updateInfo.value = result.data.update
        if (result.data.update.currentVersion) {
          syncAppVersion(result.data.update.currentVersion)
        }
      }
      downloadedUpdatePath.value = result.data.packagePath || ''
      const sizeStr = result.data.size ? `，大小 ${formatBytes(result.data.size)}` : ''
      updateStatus.value = `更新包已下载并校验通过${sizeStr}`
      feedback.successToast('更新包已下载')
    } catch (err) {
      console.error('downloadAppUpdate error:', err)
      updateStatus.value = err instanceof Error ? err.message : '下载更新失败'
      feedback.failToast(updateStatus.value)
    } finally {
      updateBusy.value = ''
      updateProgress.value = null
    }
  }

  function resetAndroidInstallBusy(): void {
    if (updateBusy.value === 'apply' && updatePlatform.value === 'android') {
      updateBusy.value = ''
      updateStatus.value = downloadedUpdatePath.value ? '安装未完成，可再次打开安装器' : updateStatus.value
    }
  }

  async function applyUpdate(): Promise<void> {
    if (updateBusy.value || !downloadedUpdatePath.value) return
    const isAndroidUpdate = updatePlatform.value === 'android'
    try {
      await feedback.confirm({
        title: isAndroidUpdate ? '安装 Android 更新' : '安装更新',
        message: isAndroidUpdate
          ? '将打开系统安装器。Android 会要求你确认安装，安装完成后重新打开应用即可。继续吗？'
          : '将临时关闭浏览器插件 Host，关闭当前桌面端，覆盖当前安装目录里的程序文件，然后自动重启。更新脚本只会清理更新缓存目录，不会删除保险库数据。继续吗？',
        confirmButtonText: isAndroidUpdate ? '打开安装器' : '安装并重启',
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }

    updateBusy.value = 'apply'
    let keepBusyUntilExit = false
    try {
      const result = await api.applyAppUpdate(downloadedUpdatePath.value)
      if (!result.ok) {
        feedback.failToast(result.message || '安装更新失败')
        return
      }
      if (result.data?.permissionRequired) {
        updateStatus.value = '请在系统页面允许安装未知应用，返回后再次点击打开安装器'
        feedback.toast('请先允许安装未知应用')
        return
      }
      keepBusyUntilExit = !isAndroidUpdate && result.data?.willRestart !== false
      updateStatus.value = isAndroidUpdate ? '已打开系统安装器' : '正在关闭并安装更新'
      feedback.successToast(isAndroidUpdate ? '请在系统安装器中确认' : '正在安装更新')
    } catch {
      updateStatus.value = '安装更新失败'
      feedback.failToast(updateStatus.value)
    } finally {
      if (!keepBusyUntilExit) updateBusy.value = ''
    }
  }

  return {
    // Bridges
    bindVaultBridge,
    bindSyncBridge,
    // Constants
    SESSION_TIMEOUT_MIN_MINUTES,
    SESSION_TIMEOUT_MAX_MINUTES,
    SESSION_TIMEOUT_DEFAULT_MINUTES,
    DEFAULT_UPDATE_MANIFEST_URL,
    // Core Session State
    state,
    unlocked,
    busy,
    stateLoading,
    stateError,
    appVersion,
    displayAppVersion,
    sessionTimeoutMinutes,
    vaultSession,
    // Auth & Password Change Form State
    password,
    newPassword,
    confirmPassword,
    changePasswordValue,
    changePasswordConfirm,
    // Device Unlock State
    deviceUnlockState,
    deviceUnlockPassword,
    deviceUnlockReauthSeconds,
    deviceUnlockSettingsLabel,
    // App Update State
    updateBusy,
    updateStatus,
    updateManifestUrl,
    updateInfo,
    updateProgress,
    downloadedUpdatePath,
    showUpdateSettings,
    updatePlatform,
    updateInstallButtonText,
    updateInstallModeText,
    updateProgressPercent,
    updateProgressLabel,
    // Busy & Session Actions
    beginBusyOperation,
    finishBusyOperation,
    resetBusyOperation,
    scheduleSessionLock,
    handleSessionActivity,
    updateSessionTimeout,
    activateVaultSession,
    saveVaultForCurrentSession,
    applyAdoptedSessionState,
    loadState,
    loadAppInfo,
    createVault,
    unlockVault,
    unlockWithPassword,
    unlockWithDevice,
    loadUnlockedVault,
    lockVault,
    handleDesktopLockRequest,
    safeExit,
    applyLockedUiState,
    // Device Unlock & Password Change Actions
    refreshDeviceUnlockState,
    rebindDeviceUnlockAfterPasswordChange,
    toggleDeviceUnlock,
    enableDeviceUnlock,
    disableDeviceUnlock,
    resetDeviceUnlockDraft,
    openPasswordSheet,
    resetPasswordDraft,
    changePassword,
    changeMasterPassword: changePassword,
    // External Refresh & Native Lock
    scheduleExternalVaultRefresh,
    refreshVaultFromDisk,
    handleVisibilityChange,
    mountNativeLockSubscription,
    unmountNativeLockSubscription,
    // App Update Actions
    checkUpdate,
    downloadUpdate,
    applyUpdate,
    checkAppUpdate: checkUpdate,
    downloadAppUpdate: downloadUpdate,
    applyAppUpdate: applyUpdate,
    resetAndroidInstallBusy
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>
export const useSessionStore = createSessionStore
