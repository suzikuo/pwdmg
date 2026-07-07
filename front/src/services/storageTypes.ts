import type {
  AndroidAutofillState,
  AppUpdateApply,
  AppUpdateCheck,
  AppUpdateDownload,
  AppUpdateProgressHandler,
  ApiResult,
  AppInfo,
  PluginListenerState
} from '../types'

export type StorageState = {
  hasVault: boolean
  legacyAvailable: boolean
  vaultPath: string
  passwordless?: boolean
}

export type WriteEnvelopeResult = {
  vaultPath: string
  backupPath: string
}

export interface VaultStorageAdapter {
  getAppInfo: () => Promise<ApiResult<AppInfo>>
  getStorageState: () => Promise<ApiResult<StorageState>>
  readVaultEnvelope: () => Promise<ApiResult<string>>
  writeVaultEnvelope: (envelopeText: string, protectBackup?: boolean) => Promise<ApiResult<WriteEnvelopeResult>>
  readLegacyLocalStorage: () => Promise<ApiResult<string>>
  cacheUnlockedSession?: (password: string) => Promise<ApiResult<unknown>>
  clearUnlockedSession?: () => Promise<ApiResult<unknown>>
  getPluginListenerState: () => Promise<ApiResult<PluginListenerState>>
  enablePluginListener: (extensionId: string, browsers: string[]) => Promise<ApiResult<PluginListenerState>>
  disablePluginListener: () => Promise<ApiResult<PluginListenerState>>
  getAndroidAutofillState: () => Promise<ApiResult<AndroidAutofillState>>
  openAndroidAutofillSettings: () => Promise<ApiResult<AndroidAutofillState>>
  checkAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateCheck>>
  downloadAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateDownload>>
  applyAppUpdate: (packagePath: string) => Promise<ApiResult<AppUpdateApply>>
  safeExit: () => Promise<ApiResult<null>>
}
