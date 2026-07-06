import type { AndroidAutofillState, ApiResult, PluginListenerState } from '../types'

export type StorageState = {
  hasVault: boolean
  legacyAvailable: boolean
  vaultPath: string
}

export type WriteEnvelopeResult = {
  vaultPath: string
  backupPath: string
}

export interface VaultStorageAdapter {
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
  safeExit: () => Promise<ApiResult<null>>
}
