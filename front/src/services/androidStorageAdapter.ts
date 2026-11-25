import type {
  ApiResult,
  AppInfo,
  AppUpdateApply,
  AppUpdateCheck,
  AppUpdateDownload,
  AppUpdateProgress,
  AppUpdateProgressHandler,
  PluginListenerState
} from '../types.ts'
import { emptyPluginListenerState, fail, ok } from './apiTypes.ts'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes.ts'

export const androidStorageAdapter: VaultStorageAdapter = {
  getAppInfo: () => call<AppInfo>('getAppInfo'),
  getStorageState: () => call<StorageState>('getStorageState'),
  readVaultEnvelope: () => call<string>('readVaultEnvelope'),
  writeVaultEnvelope: (envelopeText, protectBackup = false, expectedRevision) => call<WriteEnvelopeResult>(
    'writeVaultEnvelope',
    envelopeText,
    protectBackup,
    expectedRevision ?? -1
  ),
  readLegacyLocalStorage: () => call<string>('readLegacyLocalStorage'),
  getAttachmentStorageState: () => call('getAttachmentStorageState'),
  readAttachmentObject: (attachmentId) => call('readAttachmentObject', attachmentId),
  writeAttachmentObject: (attachmentId, objectText) => call('writeAttachmentObject', attachmentId, objectText),
  retainAttachmentObject: (attachmentId) => call('retainAttachmentObject', attachmentId),
  collectAttachmentObjects: (referencedIds) => call('collectAttachmentObjects', JSON.stringify(referencedIds)),
  cacheUnlockedSession: (password) => call('unlock', password),
  clearUnlockedSession: () => call('lock'),
  getPluginListenerState: async () => ok(emptyPluginListenerState('android')),
  enablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  disablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  getAndroidAutofillState: () => call('getAutofillState'),
  openAndroidAutofillSettings: () => call('openAutofillSettings'),
  getAndroidPasskeyProviderState: () => call('getPasskeyProviderState'),
  setAndroidPasskeyProviderEnabled: (enabled) => call('setPasskeyProviderEnabled', enabled),
  openAndroidPasskeyProviderSettings: () => call('openPasskeyProviderSettings'),
  checkAppUpdate: (manifestUrl, onProgress) => runUpdateTask<AppUpdateCheck>('check', manifestUrl, onProgress, () => call<AppUpdateCheck>('checkAppUpdate', manifestUrl)),
  downloadAppUpdate: (manifestUrl, onProgress) => runUpdateTask<AppUpdateDownload>('download', manifestUrl, onProgress, () => call<AppUpdateDownload>('downloadAppUpdate', manifestUrl)),
  applyAppUpdate: (packagePath) => call<AppUpdateApply>('applyAppUpdate', packagePath),
  safeExit: () => call<null>('safeExit')
}

export function hasAndroidBridge() {
  return Boolean(window.androidPasswordApi)
}

const DOCUMENT_EXPORT_TIMEOUT_MS = 5 * 60 * 1000
const UPDATE_TASK_TIMEOUT_MS = 10 * 60 * 1000
const TASK_POLL_INTERVAL_MS = 250

type AndroidDocumentExportTask = {
  id: string
  status: 'waiting' | 'running' | 'done' | 'error'
  result?: { saved: boolean; path: string }
  errorCode?: string
  errorMessage?: string
}

export async function exportAndroidAttachmentFile(
  displayName: string,
  mimeType: string,
  contentBase64: string
): Promise<ApiResult<{ saved: boolean; path: string }>> {
  return exportAndroidDocumentFile(
    'startAttachmentExport',
    'getAttachmentExportTaskState',
    displayName,
    mimeType,
    contentBase64,
    'ATTACHMENT_EXPORT_FAILED',
    '附件'
  )
}

export async function exportAndroidVaultFile(
  displayName: string,
  contentText: string
): Promise<ApiResult<{ saved: boolean; path: string }>> {
  const bytes = new TextEncoder().encode(contentText)
  try {
    return await exportAndroidDocumentFile(
      'startVaultExport',
      'getVaultExportTaskState',
      displayName,
      'application/json',
      bytesToBase64(bytes),
      'VAULT_EXPORT_FAILED',
      '保险库'
    )
  } finally {
    bytes.fill(0)
  }
}

async function exportAndroidDocumentFile(
  startMethod: 'startAttachmentExport' | 'startVaultExport',
  stateMethod: 'getAttachmentExportTaskState' | 'getVaultExportTaskState',
  displayName: string,
  mimeType: string,
  contentBase64: string,
  failureCode: string,
  label: string
): Promise<ApiResult<{ saved: boolean; path: string }>> {
  const nativeApi = window.androidPasswordApi
  if (!nativeApi?.[startMethod] || !nativeApi?.[stateMethod]) {
    return fail('ANDROID_API_NOT_READY', `Android ${label}导出接口未就绪。`)
  }
  const started = await call<AndroidDocumentExportTask>(startMethod, displayName, mimeType, contentBase64)
  if (!started.ok) return fail(started.code || failureCode, started.message || `${label}导出失败`)
  if (!started.data) return fail(failureCode, `Android ${label}导出任务未创建。`)
  return pollDocumentExport(started.data, stateMethod, failureCode, label)
}

async function pollDocumentExport(
  initial: AndroidDocumentExportTask,
  stateMethod: 'getAttachmentExportTaskState' | 'getVaultExportTaskState',
  failureCode: string,
  label: string
): Promise<ApiResult<{ saved: boolean; path: string }>> {
  const deadline = performance.now() + DOCUMENT_EXPORT_TIMEOUT_MS
  let state = initial
  while (true) {
    if (state.status === 'done') return ok(state.result || { saved: false, path: '' })
    if (state.status === 'error') {
      return fail(state.errorCode || failureCode, state.errorMessage || `${label}导出失败`)
    }
    await delay(TASK_POLL_INTERVAL_MS)
    if (performance.now() >= deadline) return fail('TIMEOUT', `等待 Android ${label}导出超时。`)
    const next = await call<AndroidDocumentExportTask>(stateMethod, state.id)
    if (!next.ok) return fail(next.code || failureCode, next.message || `${label}导出失败`)
    if (!next.data) return fail(failureCode, `Android ${label}导出状态缺失。`)
    state = next.data
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
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
  const deadline = performance.now() + UPDATE_TASK_TIMEOUT_MS
  while (performance.now() < deadline) {
    await delay(TASK_POLL_INTERVAL_MS)
    if (performance.now() >= deadline) break
    const state = await call<AndroidUpdateTaskState<T>>('getUpdateTaskState', taskId)
    if (!state.ok) return fail(state.code || 'ERROR', state.message || '更新失败')
    if (!state.data) return fail('ERROR', 'Android 更新状态缺失。')
    onProgress?.(state.data)

    if (state.data.status === 'done') return ok(state.data.result as T)
    if (state.data.status === 'error') {
      return fail(state.data.errorCode || 'ERROR', state.data.errorMessage || '更新失败')
    }
  }
  return fail('TIMEOUT', '等待 Android 更新超时。')
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
