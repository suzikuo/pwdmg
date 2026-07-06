export type EntryKind = 'login' | 'folder'
export type LoginAccountSource = 'auto' | 'username' | 'email' | 'phone'

export interface VaultEntry {
  id: string
  kind: EntryKind
  title: string
  domains: string[]
  username?: string
  email?: string
  password?: string
  phone?: string
  loginAccountSource?: LoginAccountSource
  note?: string
  totpSecret?: string
  children?: VaultEntry[]
}

export interface VaultPayload {
  version: number
  entries: VaultEntry[]
  settings: {
    oss: {
      bucketName: string
      accessKeyId: string
      accessKeySecret: string
      region: string
      objectName: string
    }
  }
  updatedAt: number
}

export interface AppState {
  hasVault: boolean
  locked: boolean
  expiresAt: number
  legacyAvailable: boolean
  vaultPath: string
}

export interface PluginListenerState {
  supported: boolean
  hostName: string
  extensionId: string
  manifestPath: string
  launcherPath: string
  logPath: string
  executablePath: string
  hostExecutablePath: string
  hostExecutableExists: boolean
  hostRunning: boolean
  enabled: boolean
  mode: 'development' | 'packaged' | string
  chromeRegistered: boolean
  edgeRegistered: boolean
  chromeManifestPath: string
  edgeManifestPath: string
}

export interface AndroidAutofillState {
  supported: boolean
  enabled: boolean
  serviceName: string
  settingsAvailable: boolean
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  code?: string
  message?: string
}

export interface VaultBackupExport {
  content: string
  vaultPath: string
  updatedAt: number
}

export interface VaultBackupImport {
  state: AppState
  backupPath: string
  vaultPath: string
}
