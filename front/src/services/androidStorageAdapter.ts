import type {
  ApiResult,
  AppInfo,
  AppUpdateApply,
  AppUpdateCheck,
  AppUpdateDownload,
  AppUpdateProgress,
  AppUpdateProgressHandler,
  PluginListenerState
} from '../types'
import { emptyPluginListenerState, fail, ok } from './apiTypes'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes'

export const androidStorageAdapter: VaultStorageAdapter = {
  getAppInfo: () => call<AppInfo>('getAppInfo'),
  getStorageState: () => call<StorageState>('getStorageState'),
  readVaultEnvelope: () => call<string>('readVaultEnvelope'),
  writeVaultEnvelope: (envelopeText, protectBackup = false) => call<WriteEnvelopeResult>('writeVaultEnvelope', envelopeText, protectBackup),
  readLegacyLocalStorage: () => call<string>('readLegacyLocalStorage'),
  cacheUnlockedSession: (password) => call('unlock', password),
  clearUnlockedSession: () => call('lock'),
  getPluginListenerState: async () => ok(emptyPluginListenerState('android')),
  enablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  disablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  getAndroidAutofillState: () => call('getAutofillState'),
  openAndroidAutofillSettings: () => call('openAutofillSettings'),
  checkAppUpdate: (manifestUrl, onProgress) => runUpdateTask<AppUpdateCheck>('check', manifestUrl, onProgress, () => call<AppUpdateCheck>('checkAppUpdate', manifestUrl)),
  downloadAppUpdate: (manifestUrl, onProgress) => runUpdateTask<AppUpdateDownload>('download', manifestUrl, onProgress, () => call<AppUpdateDownload>('downloadAppUpdate', manifestUrl)),
  applyAppUpdate: (packagePath) => call<AppUpdateApply>('applyAppUpdate', packagePath),
  safeExit: () => call<null>('safeExit')
}

export function hasAndroidBridge() {
  return Boolean(window.androidPasswordApi)
}

function call<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const api = window.androidPasswordApi
  if (!api?.[method]) return Promise.resolve(fail<T>('ANDROID_API_NOT_READY', 'Android 本地 API 未就绪。'))

  try {
    return Promise.resolve(JSON.parse(String(api[method](...args))) as ApiResult<T>)
  } catch (error) {
    return Promise.resolve(fail<T>('ANDROID_API_ERROR', error instanceof Error ? error.message : String(error)))
  }
}

type AndroidUpdateTaskState<T> = AppUpdateProgress & {
  id: string
  status: 'running' | 'done' | 'error'
  result?: T
  errorCode?: string
  errorMessage?: string
}

const UPDATE_TASK_POLL_MS = 250

async function runUpdateTask<T>(
  action: 'check' | 'download',
  value: string,
  onProgress: AppUpdateProgressHandler | undefined,
  fallback: () => Promise<ApiResult<T>>
): Promise<ApiResult<T>> {
  const api = window.androidPasswordApi
  if (!api?.startUpdateTask || !api?.getUpdateTaskState) return fallback()

  const start = await call<AndroidUpdateTaskState<T>>('startUpdateTask', action, value)
  if (!start.ok || !start.data) return start as ApiResult<T>
  onProgress?.(start.data)

  return pollUpdateTask<T>(start.data.id, onProgress)
}

async function pollUpdateTask<T>(taskId: string, onProgress?: AppUpdateProgressHandler): Promise<ApiResult<T>> {
  while (true) {
    await delay(UPDATE_TASK_POLL_MS)
    const state = await call<AndroidUpdateTaskState<T>>('getUpdateTaskState', taskId)
    if (!state.ok || !state.data) return state as ApiResult<T>
    onProgress?.(state.data)

    if (state.data.status === 'done') return ok(state.data.result as T)
    if (state.data.status === 'error') {
      return fail(state.data.errorCode || 'ERROR', state.data.errorMessage || '更新失败')
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
