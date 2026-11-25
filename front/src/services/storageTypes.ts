import type {
  AndroidAutofillState,
  AndroidPasskeyProviderState,
  AttachmentObjectRetention,
  AttachmentObjectWrite,
  AttachmentStorageState,
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
  revision?: number
}

export interface VaultEnvelopeStorage {
  getStorageState: () => Promise<ApiResult<StorageState>>
  readVaultEnvelope: () => Promise<ApiResult<string>>
  writeVaultEnvelope: (
    envelopeText: string,
    protectBackup?: boolean,
    expectedRevision?: number
  ) => Promise<ApiResult<WriteEnvelopeResult>>
  readLegacyLocalStorage: () => Promise<ApiResult<string>>
  cleanupLegacyStorage?: (expectedDigest: string) => Promise<ApiResult<unknown>>
  cacheUnlockedSession?: (password: string) => Promise<ApiResult<unknown>>
  clearUnlockedSession?: () => Promise<ApiResult<unknown>>
}

export interface AttachmentObjectStorage {
  getAttachmentStorageState: () => Promise<ApiResult<AttachmentStorageState>>
  readAttachmentObject: (attachmentId: string) => Promise<ApiResult<string>>
  writeAttachmentObject: (attachmentId: string, objectText: string) => Promise<ApiResult<AttachmentObjectWrite>>
  retainAttachmentObject: (attachmentId: string) => Promise<ApiResult<AttachmentObjectRetention>>
  collectAttachmentObjects: (referencedIds: string[]) => Promise<ApiResult<{ retained: number; deleted: number }>>
}

export interface PluginListenerBridge {
  getPluginListenerState: () => Promise<ApiResult<PluginListenerState>>
  enablePluginListener: (extensionId: string, browsers: string[]) => Promise<ApiResult<PluginListenerState>>
  disablePluginListener: () => Promise<ApiResult<PluginListenerState>>
}

export interface AndroidPlatformBridge {
  getAndroidAutofillState: () => Promise<ApiResult<AndroidAutofillState>>
  openAndroidAutofillSettings: () => Promise<ApiResult<AndroidAutofillState>>
  getAndroidPasskeyProviderState: () => Promise<ApiResult<AndroidPasskeyProviderState>>
  setAndroidPasskeyProviderEnabled: (enabled: boolean) => Promise<ApiResult<AndroidPasskeyProviderState>>
  openAndroidPasskeyProviderSettings: () => Promise<ApiResult<AndroidPasskeyProviderState>>
}

export interface AppUpdateBridge {
  checkAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateCheck>>
  downloadAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateDownload>>
  applyAppUpdate: (packagePath: string) => Promise<ApiResult<AppUpdateApply>>
}

export interface VaultStorageAdapter
  extends VaultEnvelopeStorage,
    AttachmentObjectStorage,
    PluginListenerBridge,
    AndroidPlatformBridge,
    AppUpdateBridge {
  getAppInfo: () => Promise<ApiResult<AppInfo>>
  safeExit: () => Promise<ApiResult<null>>
}
