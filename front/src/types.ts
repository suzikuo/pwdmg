export type EntryKind = 'login' | 'secure-note' | 'card' | 'identity' | 'api-key' | 'folder'
export type LoginAccountSource = 'auto' | 'username' | 'email' | 'phone'
export type AutofillMatchMode = 'base-domain' | 'exact-host' | 'subdomain' | 'url-prefix' | 'never'
export type EntryStatus = 'active' | 'disabled' | 'trashed'
export type EntryHistoryAction = 'created' | 'updated' | 'disabled' | 'restored' | 'trashed'
export type EntryHistoryField = 'title' | 'domains' | 'autofillMatchMode' | 'username' | 'email' | 'password' | 'phone' | 'loginAccountSource' | 'note' | 'totpSecret' | 'customFields' | 'attachments' | 'status'
export type VaultPayloadVersion = 1 | 2
export type PasskeyTransport = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'
export type VaultCustomFieldType = 'text' | 'secret' | 'date' | 'url' | 'email' | 'phone'

export interface VaultCustomField {
  id: string
  label: string
  value: string
  type: VaultCustomFieldType
  protected: boolean
}

export interface VaultAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
  ciphertextSha256: string
  createdAt: number
}

export interface VaultEntryHistoryChange {
  field: EntryHistoryField
  before: string
  after: string
}

export interface VaultEntryHistory {
  id: string
  action: EntryHistoryAction
  at: number
  title: string
  username?: string
  email?: string
  phone?: string
  domains?: string[]
  note?: string
  changes?: VaultEntryHistoryChange[]
  snapshot?: VaultEntrySnapshot
}

export interface VaultEntry {
  id: string
  kind: EntryKind
  title: string
  status?: EntryStatus
  statusReason?: string
  statusUpdatedAt?: number
  deletedAt?: number
  domains: string[]
  autofillMatchMode?: AutofillMatchMode
  username?: string
  email?: string
  password?: string
  phone?: string
  loginAccountSource?: LoginAccountSource
  note?: string
  totpSecret?: string
  customFields?: VaultCustomField[]
  attachments?: VaultAttachment[]
  history?: VaultEntryHistory[]
  children?: VaultEntry[]
}

export type VaultEntrySnapshot = Omit<VaultEntry, 'history' | 'children'>

export interface VaultPasskey {
  id: string
  label?: string
  credentialId: string
  rpId: string
  rpName?: string
  userHandle: string
  userName: string
  userDisplayName?: string
  algorithm: number
  publicKeyCose: string
  privateKeyPkcs8: string
  discoverable: boolean
  backupEligible: boolean
  backupState: boolean
  transports: PasskeyTransport[]
  entryId?: string
  createdAt: number
  updatedAt: number
}

export interface VaultPasskeyTombstone {
  id: string
  credentialId: string
  deletedAt: number
}

export interface VaultPayload {
  version: VaultPayloadVersion
  attachmentKey?: string
  passkeySchemaVersion?: 1
  revision: number
  entries: VaultEntry[]
  passkeys: VaultPasskey[]
  passkeyTombstones: VaultPasskeyTombstone[]
  settings: {
    oss: {
      bucketName: string
      accessKeyId: string
      accessKeySecret: string
      region: string
      objectName: string
      autoSync: boolean
      autoSyncIntervalMinutes: number
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

export interface DeviceUnlockState {
  supported: boolean
  enabled: boolean
  expiresAt: number
}

export interface AttachmentStorageState {
  maxFileBytes: number
  quotaBytes: number
  activeCount: number
  activeBytes: number
  retainedCount: number
  retainedBytes: number
}

export interface AttachmentObjectWrite {
  attachmentId: string
  objectBytes: number
}

export interface AttachmentObjectRetention {
  attachmentId: string
  retained: boolean
  deletedAt?: number
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
  urls?: string[]
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

export interface PortableBackupExport {
  saved: boolean
  path: string
  createdAt?: number
  attachmentCount?: number
  packageBytes?: number
}

export interface PortableBackupSelection {
  selected: boolean
  selectionToken?: string
  name?: string
  createdAt?: number
  attachmentCount?: number
  packageBytes?: number
}

export interface PortableBackupImport extends VaultBackupImport {
  attachmentCount: number
}
