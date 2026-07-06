import type { ApiResult, AppUpdateApply, AppUpdateCheck, AppUpdateDownload, PluginListenerState } from '../types'
import { emptyPluginListenerState, fail, ok } from './apiTypes'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes'

export const androidStorageAdapter: VaultStorageAdapter = {
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
  checkAppUpdate: (manifestUrl) => call<AppUpdateCheck>('checkAppUpdate', manifestUrl),
  downloadAppUpdate: (manifestUrl) => call<AppUpdateDownload>('downloadAppUpdate', manifestUrl),
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
