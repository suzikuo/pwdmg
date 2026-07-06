import type { AndroidAutofillState, ApiResult, AppState, PluginListenerState, VaultBackupExport, VaultBackupImport, VaultPayload } from '../types'

export type CreateVaultResult = {
  vault: VaultPayload
  migrated: number
}

export interface PasswordManagerApiAdapter {
  getState: () => Promise<ApiResult<AppState>>
  createVault: (password: string, importLegacy: boolean) => Promise<ApiResult<CreateVaultResult>>
  unlock: (password: string) => Promise<ApiResult<VaultPayload>>
  lock: () => Promise<ApiResult<AppState>>
  getVault: () => Promise<ApiResult<VaultPayload>>
  saveVault: (payload: VaultPayload) => Promise<ApiResult<VaultPayload>>
  changePassword: (newPassword: string) => Promise<ApiResult<AppState>>
  exportVaultBackup: () => Promise<ApiResult<VaultBackupExport>>
  importVaultBackup: (envelopeText: string) => Promise<ApiResult<VaultBackupImport>>
  getPluginListenerState: () => Promise<ApiResult<PluginListenerState>>
  enablePluginListener: (extensionId: string, browsers: string[]) => Promise<ApiResult<PluginListenerState>>
  disablePluginListener: () => Promise<ApiResult<PluginListenerState>>
  getAndroidAutofillState: () => Promise<ApiResult<AndroidAutofillState>>
  openAndroidAutofillSettings: () => Promise<ApiResult<AndroidAutofillState>>
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
