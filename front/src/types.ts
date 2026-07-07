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
  passwordless?: boolean
}

export interface AppInfo {
  version: string
  versionCode?: number
  platform: string
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

export interface AppUpdateAsset {
  url: string
  sha256: string
  size: number
  fileName: string
}

export interface AppUpdateCheck {
  supported: boolean
  currentVersion: string
  currentCode?: number
  latestVersion: string
  latestCode?: number
  updateAvailable: boolean
  manifestUrl: string
  notes: string
  publishedAt: string
  canApply: boolean
  platform?: string
  installPermissionGranted?: boolean
  asset: AppUpdateAsset
}

export interface AppUpdateDownload {
  update: AppUpdateCheck
  packagePath: string
  sha256: string
  size: number
}

export interface AppUpdateProgress {
  action?: string
  phase?: string
  progress?: number
  downloaded?: number
  total?: number
  message?: string
}

export type AppUpdateProgressHandler = (progress: AppUpdateProgress) => void

export interface AppUpdateApply {
  packagePath: string
  scriptPath?: string
  installDir?: string
  permissionRequired?: boolean
  installerOpened?: boolean
  willRestart: boolean
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
