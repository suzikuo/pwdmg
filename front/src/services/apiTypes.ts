import type {
  AndroidAutofillState,
  AttachmentObjectRetention,
  AttachmentStorageState,
  AppUpdateApply,
  AppUpdateCheck,
  AppUpdateDownload,
  AppUpdateProgressHandler,
  ApiResult,
  AppInfo,
  AppState,
  DeviceUnlockState,
  PluginListenerState,
  PortableBackupExport,
  PortableBackupImport,
  PortableBackupSelection,
  VaultBackupExport,
  VaultBackupImport,
  VaultAttachment,
  VaultPayload
} from '../types'

export type CreateVaultResult = {
  vault: VaultPayload
  migrated: number
  legacyCleanupPending?: boolean
}

export type StartupData = {
  state: AppState
  vault?: VaultPayload
}

export type AttachmentCreateResult = {
  reference: VaultAttachment
  vault: VaultPayload
}

export interface PasswordManagerApiAdapter {
  getAppInfo: () => Promise<ApiResult<AppInfo>>
  getStartupData: () => Promise<ApiResult<StartupData>>
  getState: () => Promise<ApiResult<AppState>>
  createVault: (password: string, importLegacy: boolean) => Promise<ApiResult<CreateVaultResult>>
  unlock: (password: string) => Promise<ApiResult<VaultPayload>>
  getDeviceUnlockState: () => Promise<ApiResult<DeviceUnlockState>>
  enableDeviceUnlock: (password: string, reauthSeconds: number) => Promise<ApiResult<DeviceUnlockState>>
  disableDeviceUnlock: () => Promise<ApiResult<DeviceUnlockState>>
  quickUnlock: () => Promise<ApiResult<VaultPayload>>
  getAttachmentStorageState: () => Promise<ApiResult<AttachmentStorageState>>
  createAttachmentObject: (name: string, mimeType: string, bytes: Uint8Array) => Promise<ApiResult<AttachmentCreateResult>>
  readAttachmentBytes: (reference: VaultAttachment) => Promise<ApiResult<Uint8Array>>
  saveAttachmentToFile: (reference: VaultAttachment) => Promise<ApiResult<{ saved: boolean; path: string }>>
  readAttachmentCiphertext: (reference: VaultAttachment) => Promise<ApiResult<string>>
  writeAttachmentCiphertext: (reference: VaultAttachment, objectText: string) => Promise<ApiResult<null>>
  retainAttachmentObject: (attachmentId: string) => Promise<ApiResult<AttachmentObjectRetention>>
  collectAttachmentObjects: (referencedIds: string[]) => Promise<ApiResult<{ retained: number; deleted: number }>>
  lock: () => Promise<ApiResult<AppState>>
  getVault: () => Promise<ApiResult<VaultPayload>>
  saveVault: (payload: VaultPayload) => Promise<ApiResult<VaultPayload>>
  deletePasskey: (passkeyId: string) => Promise<ApiResult<VaultPayload>>
  changePassword: (newPassword: string) => Promise<ApiResult<AppState>>
  exportVaultBackup: () => Promise<ApiResult<VaultBackupExport>>
  exportVaultBackupForPayload: (payload: VaultPayload) => Promise<ApiResult<VaultBackupExport>>
  previewVaultBackup: (envelopeText: string) => Promise<ApiResult<VaultPayload>>
  previewVaultBackupWithPassword: (envelopeText: string, password: string) => Promise<ApiResult<VaultPayload>>
  importVaultBackup: (envelopeText: string) => Promise<ApiResult<VaultBackupImport>>
  exportPortableBackupPackage: () => Promise<ApiResult<PortableBackupExport>>
  selectPortableBackupPackage: () => Promise<ApiResult<PortableBackupSelection>>
  importPortableBackupPackage: (selectionToken: string, password: string) => Promise<ApiResult<PortableBackupImport>>
  discardPortableBackupSelection: (selectionToken: string) => Promise<ApiResult<{ discarded: boolean }>>
  getPluginListenerState: () => Promise<ApiResult<PluginListenerState>>
  enablePluginListener: (extensionId: string, browsers: string[]) => Promise<ApiResult<PluginListenerState>>
  disablePluginListener: () => Promise<ApiResult<PluginListenerState>>
  getAndroidAutofillState: () => Promise<ApiResult<AndroidAutofillState>>
  openAndroidAutofillSettings: () => Promise<ApiResult<AndroidAutofillState>>
  checkAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateCheck>>
  downloadAppUpdate: (manifestUrl: string, onProgress?: AppUpdateProgressHandler) => Promise<ApiResult<AppUpdateDownload>>
  applyAppUpdate: (packagePath: string) => Promise<ApiResult<AppUpdateApply>>
  openExternalUrl: (url: string) => Promise<ApiResult<null>>
  safeExit: () => Promise<ApiResult<null>>
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(code: string, message: string): ApiResult<T> {
  return { ok: false, code, message }
}

export function emptyPluginListenerState(mode: string): PluginListenerState {
  return {
    supported: false,
    hostName: 'com.suzikuo.mypwdmg',
    extensionId: '',
    manifestPath: '',
    launcherPath: '',
    logPath: '',
    executablePath: '',
    hostExecutablePath: '',
    hostExecutableExists: false,
    hostRunning: false,
    enabled: false,
    mode,
    chromeRegistered: false,
    edgeRegistered: false,
    chromeManifestPath: '',
    edgeManifestPath: ''
  }
}
