import type { ApiResult, AppState, DesktopTraySettings, DeviceUnlockState, PortableBackupExport, PortableBackupImport, PortableBackupSelection, VaultAttachment, VaultBackupExport, VaultBackupImport, VaultPayload } from '../types.ts'
import { androidStorageAdapter, exportAndroidAttachmentFile, exportAndroidVaultFile } from './androidStorageAdapter.ts'
import { fail, ok, type AttachmentCreateResult, type CreateVaultResult, type PasswordManagerApiAdapter, type StartupData } from './apiTypes.ts'
import { callDesktopApi, desktopStorageAdapter, showDesktopWindow as showDesktopWindowAdapter, subscribeDesktopVaultLocked } from './desktopStorageAdapter.ts'
import { decryptAttachmentObject, encryptAttachmentObject, generateAttachmentKey, importAttachmentKey, verifyAttachmentCiphertext } from './attachmentCrypto.ts'
import { migrateLegacyStorageText } from './legacyWeb.ts'
import { removePasskeyWithTombstone } from './passkeyManagement.ts'
import { SessionGeneration } from './sessionGeneration.ts'
import type { VaultStorageAdapter } from './storageTypes.ts'
import { cloneVaultPayload, defaultVaultPayload, normalizeVaultPayload, nowSeconds } from './vaultDefaults.ts'
import { decryptPayload, decryptPayloadWithKey, encryptPayload, encryptPayloadWithKey, setEnvelopePasswordless, validateEnvelope, type VaultKey } from './vaultCrypto.ts'
import { webStorageAdapter } from './webStorageAdapter.ts'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const MAX_VAULT_ENVELOPE_TEXT_LENGTH = 24 * 1024 * 1024

let payload: VaultPayload | null = null
let vaultKey: VaultKey | null = null
let attachmentObjectKey: CryptoKey | null = null
let attachmentKeyMaterial = ''
let passwordless = false
let expiresAt = 0
const sessionGeneration = new SessionGeneration()

export const api: PasswordManagerApiAdapter = {
  getAppInfo: () => selectedStorage().getAppInfo(),
  getStartupData: () => getStartupData(),
  getState: () => useDesktopNativeApi()
    ? callDesktopVaultApi<AppState>('getState')
    : nativeVaultCall('getState', () => guard(getState)),
  createVault: (password, importLegacy) => useDesktopNativeApi()
    ? desktopCreateVault(password, importLegacy)
    : nativeVaultCall('createVault', () => guard(() => createVault(password, importLegacy)), password, importLegacy),
  unlock: (password) => useDesktopNativeApi()
    ? desktopUnlock(password)
    : nativeVaultCall('unlock', () => guard(() => unlock(password)), password),
  getDeviceUnlockState: () => getDeviceUnlockState(),
  enableDeviceUnlock: (password, reauthSeconds) => enableDeviceUnlock(password, reauthSeconds),
  disableDeviceUnlock: () => disableDeviceUnlock(),
  quickUnlock: () => quickUnlock(),
  getAttachmentStorageState: () => selectedStorage().getAttachmentStorageState(),
  createAttachmentObject: (name, mimeType, bytes) => createAttachmentObject(name, mimeType, bytes),
  readAttachmentBytes: (reference) => readAttachmentBytes(reference),
  saveAttachmentToFile: (reference) => saveAttachmentToFile(reference),
  readAttachmentCiphertext: (reference) => readAttachmentCiphertext(reference),
  writeAttachmentCiphertext: (reference, objectText) => writeAttachmentCiphertext(reference, objectText),
  retainAttachmentObject: (attachmentId) => selectedStorage().retainAttachmentObject(attachmentId),
  collectAttachmentObjects: (referencedIds) => selectedStorage().collectAttachmentObjects(referencedIds),
  lock: () => lockVault(),
  getVault: () => useDesktopNativeApi()
    ? desktopGetVault()
    : nativeVaultCall('getVault', () => guard(getVault)),
  saveVault: (nextPayload) => useDesktopNativeApi()
    ? desktopSaveVault(nextPayload)
    : nativeVaultCall('saveVault', () => guard(() => saveVault(nextPayload)), nextPayload),
  deletePasskey: (passkeyId) => useDesktopNativeApi()
    ? desktopDeletePasskey(passkeyId)
    : nativeVaultCall('deletePasskey', () => guard(() => deletePasskey(passkeyId)), passkeyId),
  changePassword: (newPassword, currentPassword) => useDesktopNativeApi()
    ? desktopChangePassword(newPassword, currentPassword)
    : nativeVaultCall('changePassword', () => guard(() => changePassword(newPassword)), newPassword),
  adoptVaultEncryptionFromEnvelope: (envelopeText, password) => useDesktopNativeApi()
    ? desktopAdoptVaultEncryptionFromEnvelope(envelopeText, password)
    : nativeVaultCall(
      'adoptVaultEncryptionFromEnvelope',
      () => guard(() => adoptVaultEncryptionFromEnvelope(envelopeText, password)),
      envelopeText,
      password
    ),
  exportVaultBackup: () => useDesktopNativeApi()
    ? desktopExportVaultBackup()
    : nativeVaultCall('exportVaultBackup', () => guard(exportVaultBackup)),
  exportAndroidVaultFile: (displayName, contentText) => exportAndroidVaultFile(displayName, contentText),
  exportVaultBackupForPayload: (nextPayload) => useDesktopNativeApi()
    ? desktopExportVaultBackupForPayload(nextPayload)
    : nativeVaultCall('exportVaultBackupForPayload', () => guard(() => exportVaultBackupForPayload(nextPayload)), nextPayload),
  previewVaultBackup: (envelopeText) => useDesktopNativeApi()
    ? desktopPreviewVaultBackup(envelopeText)
    : nativeVaultCall('previewVaultBackup', () => guard(() => previewVaultBackup(envelopeText)), envelopeText),
  previewVaultBackupWithPassword: (envelopeText, password) => useDesktopNativeApi()
    ? desktopPreviewVaultBackupWithPassword(envelopeText, password)
    : nativeVaultCall('previewVaultBackupWithPassword', () => guard(() => previewVaultBackupWithPassword(envelopeText, password)), envelopeText, password),
  importVaultBackup: (envelopeText) => useDesktopNativeApi()
    ? desktopImportVaultBackup(envelopeText)
    : nativeVaultCall('importVaultBackup', () => guard(() => importVaultBackup(envelopeText)), envelopeText),
  exportPortableBackupPackage: () => exportPortableBackupPackage(),
  selectPortableBackupPackage: () => selectPortableBackupPackage(),
  importPortableBackupPackage: (selectionToken, password) => importPortableBackupPackage(selectionToken, password),
  discardPortableBackupSelection: (selectionToken) => discardPortableBackupSelection(selectionToken),
  getPluginListenerState: () => selectedStorage().getPluginListenerState(),
  enablePluginListener: (extensionId, browsers) => selectedStorage().enablePluginListener(extensionId, browsers),
  disablePluginListener: () => selectedStorage().disablePluginListener(),
  getDesktopTraySettings: async () => useDesktopStorage()
    ? callDesktopApi<DesktopTraySettings>('getDesktopTraySettings')
    : fail('DESKTOP_ONLY', '托盘设置仅在桌面端可用。'),
  setDesktopTraySettings: async (trayEnabled, closeBehavior) => useDesktopStorage()
    ? callDesktopApi<DesktopTraySettings>('setDesktopTraySettings', trayEnabled, closeBehavior)
    : fail('DESKTOP_ONLY', '托盘设置仅在桌面端可用。'),
  setDesktopGpuAcceleration: async (enabled) => useDesktopStorage()
    ? callDesktopApi<DesktopTraySettings>('setDesktopGpuAcceleration', enabled)
    : fail('DESKTOP_ONLY', 'GPU 硬件加速设置仅在 Windows 桌面端可用。'),
  getAndroidAutofillState: () => selectedStorage().getAndroidAutofillState(),
  setAndroidAutofillInlineEnabled: (enabled) => selectedStorage().setAndroidAutofillInlineEnabled(enabled),
  openAndroidAutofillSettings: () => selectedStorage().openAndroidAutofillSettings(),
  getAndroidPasskeyProviderState: () => selectedStorage().getAndroidPasskeyProviderState(),
  setAndroidPasskeyProviderEnabled: (enabled) => selectedStorage().setAndroidPasskeyProviderEnabled(enabled),
  openAndroidPasskeyProviderSettings: () => selectedStorage().openAndroidPasskeyProviderSettings(),
  checkAppUpdate: (manifestUrl, onProgress) => selectedStorage().checkAppUpdate(manifestUrl, onProgress),
  downloadAppUpdate: (manifestUrl, onProgress) => selectedStorage().downloadAppUpdate(manifestUrl, onProgress),
  applyAppUpdate: (packagePath) => selectedStorage().applyAppUpdate(packagePath),
  openExternalUrl: (url) => openExternalUrl(url),
  copySensitiveText: (text, clearAfterSeconds) => useDesktopStorage()
    ? callDesktopApi<{ copied: boolean; clearAfterSeconds: number }>('copySensitiveText', text, clearAfterSeconds)
    : Promise.resolve(fail('DESKTOP_ONLY', '原生安全剪贴板仅在桌面端可用。')),
  clearSensitiveClipboard: () => useDesktopStorage()
    ? callDesktopApi<{ cleared: boolean }>('clearSensitiveClipboard')
    : Promise.resolve(fail('DESKTOP_ONLY', '原生安全剪贴板仅在桌面端可用。')),
  safeExit: () => selectedStorage().safeExit(),
  showDesktopWindow: () => showDesktopWindow(),
  subscribeNativeLock: (handler) => subscribeNativeLock(handler)
}

export async function showDesktopWindow(): Promise<void> {
  if (useDesktopStorage()) {
    await showDesktopWindowAdapter()
  }
}

function subscribeNativeLock(handler: (reason: string) => void): () => void {
  if (!useDesktopNativeApi()) return () => {}
  return subscribeDesktopVaultLocked((reason) => {
    clearLocalSession()
    handler(reason)
  })
}

async function createAttachmentObject(name: string, mimeType: string, bytes: Uint8Array): Promise<ApiResult<AttachmentCreateResult>> {
  return guard(async () => {
    const generation = sessionGeneration.capture()
    let current = await requireAttachmentPayload()
    let currentKey: CryptoKey
    if (!current.attachmentKey) {
      const generated = await generateAttachmentKey()
      current = { ...cloneVaultPayload(current), attachmentKey: generated.encoded }
      currentKey = generated.key
    } else {
      currentKey = await requireAttachmentObjectKey(current)
    }
    if (!globalThis.crypto?.randomUUID) throw new Error('Secure attachment IDs are unavailable')
    const encrypted = await encryptAttachmentObject(currentKey, crypto.randomUUID(), bytes, name, mimeType)
    sessionGeneration.requireCurrent(generation)
    unwrap(await selectedStorage().writeAttachmentObject(encrypted.reference.id, encrypted.objectText))
    sessionGeneration.requireCurrent(generation)
    return { reference: encrypted.reference, vault: cloneVaultPayload(current) }
  })
}

async function readAttachmentBytes(reference: VaultAttachment): Promise<ApiResult<Uint8Array>> {
  return guard(async () => {
    const generation = sessionGeneration.capture()
    const current = await requireAttachmentPayload()
    const currentKey = await requireAttachmentObjectKey(current)
    sessionGeneration.requireCurrent(generation)
    const objectText = unwrap(await selectedStorage().readAttachmentObject(reference.id))
    const bytes = await decryptAttachmentObject(currentKey, reference, objectText)
    sessionGeneration.requireCurrent(generation)
    return bytes
  })
}

async function saveAttachmentToFile(reference: VaultAttachment): Promise<ApiResult<{ saved: boolean; path: string }>> {
  const result = await readAttachmentBytes(reference)
  if (!result.ok || !result.data) return fail(result.code || 'ATTACHMENT_READ_FAILED', result.message || 'Attachment could not be read')
  const bytes = result.data
  try {
    if (useDesktopStorage()) {
      return callDesktopApi<{ saved: boolean; path: string }>('saveAttachmentFile', reference.name, bytesToBase64(bytes))
    }
    if (useAndroidNativeApi()) {
      return exportAndroidAttachmentFile(reference.name, reference.mimeType, bytesToBase64(bytes))
    }
    if (!useWebStorage()) return fail('UNSUPPORTED', 'Attachments are not supported on this platform yet.')
    const blob = new Blob([toOwnedArrayBuffer(bytes)], { type: reference.mimeType })
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = reference.name
      anchor.rel = 'noopener'
      anchor.click()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    return ok({ saved: true, path: '' })
  } finally {
    bytes.fill(0)
  }
}

async function readAttachmentCiphertext(reference: VaultAttachment): Promise<ApiResult<string>> {
  return guard(async () => {
    const generation = sessionGeneration.capture()
    await requireAttachmentPayload()
    sessionGeneration.requireCurrent(generation)
    const objectText = unwrap(await selectedStorage().readAttachmentObject(reference.id))
    await verifyAttachmentCiphertext(reference, objectText)
    sessionGeneration.requireCurrent(generation)
    return objectText
  })
}

async function writeAttachmentCiphertext(reference: VaultAttachment, objectText: string): Promise<ApiResult<null>> {
  return guard(async () => {
    const generation = sessionGeneration.capture()
    await requireAttachmentPayload()
    await verifyAttachmentCiphertext(reference, objectText)
    sessionGeneration.requireCurrent(generation)
    unwrap(await selectedStorage().writeAttachmentObject(reference.id, objectText))
    return null
  })
}

async function getDeviceUnlockState(): Promise<ApiResult<DeviceUnlockState>> {
  if (useDesktopStorage()) return callDesktopApi<DeviceUnlockState>('getDeviceUnlockState')
  if (useAndroidNativeApi()) return callAndroidApi<DeviceUnlockState>('getDeviceUnlockState')
  return ok({ supported: false, enabled: false, expiresAt: 0 })
}

async function enableDeviceUnlock(password: string, reauthSeconds: number): Promise<ApiResult<DeviceUnlockState>> {
  if (useDesktopStorage()) return callDesktopApi<DeviceUnlockState>('enableDeviceUnlock', password, reauthSeconds)
  if (useAndroidNativeApi()) return callAndroidApi<DeviceUnlockState>('enableDeviceUnlock', password, reauthSeconds)
  return fail('UNSUPPORTED_PLATFORM', '设备快速解锁仅支持桌面端与移动端。')
}

async function disableDeviceUnlock(): Promise<ApiResult<DeviceUnlockState>> {
  if (useDesktopStorage()) return callDesktopApi<DeviceUnlockState>('disableDeviceUnlock')
  if (useAndroidNativeApi()) return callAndroidApi<DeviceUnlockState>('disableDeviceUnlock')
  return fail('UNSUPPORTED_PLATFORM', '设备快速解锁仅支持桌面端与移动端。')
}

async function quickUnlock(): Promise<ApiResult<VaultPayload>> {
  if (useAndroidNativeApi()) {
    const result = await callAndroidApi<VaultPayload>('quickUnlock')
    if (result.ok && result.data) {
      payload = result.data
      passwordless = false
      return ok(cloneVaultPayload(result.data))
    }
    return fail(result.code || 'DEVICE_UNLOCK_FAILED', result.message || '设备快速解锁失败')
  }
  if (useDesktopNativeApi()) {
    return desktopQuickUnlock()
  }
  return fail('UNSUPPORTED_PLATFORM', '设备快速解锁仅支持桌面端与移动端。')
}

async function openExternalUrl(value: string): Promise<ApiResult<null>> {
  let url: URL
  try {
    url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return fail('INVALID_URL', '只允许打开不含登录凭据的 HTTP 或 HTTPS 地址')
    }
  } catch {
    return fail('INVALID_URL', '网站地址无效')
  }
  if (useDesktopStorage()) return callDesktopApi<null>('openExternalUrl', url.toString())
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
  return ok(null)
}

async function getStartupData(): Promise<ApiResult<StartupData>> {
  if (useAndroidNativeApi()) {
    const response = await callAndroidApi<AppState>('getState')
    if (!response.ok || !response.data) return fail(response.code || 'ERROR', response.message || '读取启动状态失败')
    return ok({ state: response.data })
  }
  if (useDesktopNativeApi()) {
    const response = await callDesktopVaultApi<AppState>('getState')
    if (!response.ok || !response.data) return fail(response.code || 'ERROR', response.message || '读取启动状态失败')
    const currentState = response.data
    if (currentState.hasVault && currentState.locked && currentState.passwordless) {
      const unlocked = await desktopUnlock('')
      if (unlocked.ok && unlocked.data) {
        return ok({
          state: { ...currentState, locked: false },
          vault: unlocked.data
        })
      }
    }
    return ok({ state: currentState })
  }
  return guard(async () => {
    const state = await getState()
    if (state.hasVault && state.locked && state.passwordless) {
      return {
        state,
        vault: await unlock('')
      }
    }
    return { state }
  })
}

function nativeVaultCall<T>(method: string, webFallback: () => Promise<ApiResult<T>>, ...args: unknown[]): Promise<ApiResult<T>> {
  if (useAndroidNativeApi()) return callAndroidApi(method, ...androidArgs(method, args))
  return webFallback()
}

function androidArgs(method: string, args: unknown[]) {
  if (method === 'saveVault' || method === 'exportVaultBackupForPayload') return [JSON.stringify(args[0])]
  return args
}

async function getState(): Promise<AppState> {
  const storageState = unwrap(await selectedStorage().getStorageState())
  return {
    hasVault: storageState.hasVault,
    locked: !isUnlocked(),
    expiresAt: isUnlocked() ? Math.floor(expiresAt / 1000) : 0,
    legacyAvailable: storageState.legacyAvailable,
    vaultPath: storageState.vaultPath,
    passwordless: storageState.passwordless === true
  }
}

async function createVault(password: string, importLegacy: boolean): Promise<CreateVaultResult> {
  const generation = sessionGeneration.capture()
  const storage = selectedStorage()
  const storageState = unwrap(await storage.getStorageState())
  sessionGeneration.requireCurrent(generation)
  if (storageState.hasVault) throw new Error('Vault already exists; unlock it instead')

  let nextPayload = defaultVaultPayload()
  let migrated = 0
  let legacyDigest = ''
  if (importLegacy && storageState.legacyAvailable) {
    const legacyText = unwrap(await storage.readLegacyLocalStorage())
    sessionGeneration.requireCurrent(generation)
    const migratedResult = migrateLegacyStorageText(legacyText)
    if (migratedResult.failed > 0) {
      throw new Error(`旧数据中有 ${migratedResult.failed} 条损坏记录，保险库尚未创建；请先保留并修复旧数据`)
    }
    nextPayload = migratedResult.payload
    migrated = migratedResult.migrated
    legacyDigest = await sha256Text(legacyText)
    sessionGeneration.requireCurrent(generation)
  }

  const normalized = normalizeVaultPayload(nextPayload)
  const encrypted = await encryptPayload(password || '', normalized)
  sessionGeneration.requireCurrent(generation)
  unwrap(await storage.writeVaultEnvelope(JSON.stringify(encrypted.envelope, null, 2), false, 0))
  sessionGeneration.requireCurrent(generation)
  const persistedEnvelope = parseEnvelopeText(unwrap(await storage.readVaultEnvelope()))
  const verified = normalizeVaultPayload(await decryptPayloadWithKey(encrypted.vaultKey, persistedEnvelope))
  sessionGeneration.requireCurrent(generation)
  if (JSON.stringify(verified) !== JSON.stringify(normalized)) {
    throw new Error('Encrypted vault verification failed; legacy data was not removed')
  }
  let legacyCleanupPending = false
  if (legacyDigest) {
    const cleanup = storage.cleanupLegacyStorage
    const cleanupResult = cleanup ? await cleanup(legacyDigest) : fail('UNSUPPORTED', 'Legacy cleanup is unavailable')
    sessionGeneration.requireCurrent(generation)
    legacyCleanupPending = !cleanupResult.ok
  }
  await cacheNativeSessionForGeneration(password || '', generation)
  payload = normalized
  vaultKey = encrypted.vaultKey
  passwordless = (password || '') === ''
  refreshSession()
  return { vault: cloneVaultPayload(normalized), migrated, legacyCleanupPending }
}

async function unlock(password: string): Promise<VaultPayload> {
  const generation = sessionGeneration.capture()
  const envelope = parseEnvelopeText(unwrap(await selectedStorage().readVaultEnvelope()))
  sessionGeneration.requireCurrent(generation)
  const decrypted = await decryptPayload(password || '', envelope)
  sessionGeneration.requireCurrent(generation)
  const rawPayload = decrypted.payload as Partial<VaultPayload>
  const unlockedPasswordless = (password || '') === ''
  let unlockedPayload = normalizeVaultPayload(rawPayload)
  const needsSchemaRewrite = rawPayload.version !== unlockedPayload.version ||
    rawPayload.passkeySchemaVersion !== unlockedPayload.passkeySchemaVersion ||
    JSON.stringify(rawPayload.passkeys ?? []) !== JSON.stringify(unlockedPayload.passkeys) ||
    JSON.stringify(rawPayload.passkeyTombstones ?? []) !== JSON.stringify(unlockedPayload.passkeyTombstones)
  if (needsSchemaRewrite || envelope.passwordless !== unlockedPasswordless) {
    const expectedRevision = unlockedPayload.revision
    if (needsSchemaRewrite) {
      unlockedPayload = normalizeVaultPayload({
        ...unlockedPayload,
        revision: expectedRevision + 1,
        updatedAt: nowSeconds()
      })
    }
    const upgradedEnvelope = await encryptPayloadWithKey(decrypted.vaultKey, unlockedPayload)
    sessionGeneration.requireCurrent(generation)
    setEnvelopePasswordless(upgradedEnvelope, unlockedPasswordless)
    unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(upgradedEnvelope, null, 2), false, expectedRevision))
    sessionGeneration.requireCurrent(generation)
  }
  await cacheNativeSessionForGeneration(password || '', generation)
  payload = unlockedPayload
  vaultKey = decrypted.vaultKey
  passwordless = unlockedPasswordless
  refreshSession()
  return cloneVaultPayload(unlockedPayload)
}

function lockVault(): Promise<ApiResult<AppState>> {
  if (useAndroidNativeApi()) {
    clearLocalSession()
    return callAndroidApi('lock')
  }
  if (useDesktopNativeApi()) {
    clearLocalSession()
    return callDesktopVaultApi<AppState>('lock')
  }
  return guard(lock)
}

async function lock(): Promise<AppState> {
  clearLocalSession()
  if (useDesktopNativeApi()) {
    return unwrap(await callDesktopVaultApi<AppState>('lock'))
  }
  await clearNativeSession()
  return getState()
}

function clearLocalSession() {
  sessionGeneration.invalidate()
  payload = null
  vaultKey = null
  attachmentObjectKey = null
  attachmentKeyMaterial = ''
  passwordless = false
  expiresAt = 0
}

async function requireAttachmentPayload(): Promise<VaultPayload> {
  if (useAndroidNativeApi()) return unwrap(await callAndroidApi<VaultPayload>('getVault'))
  if (useDesktopNativeApi()) return unwrap(await desktopGetVault())
  return requirePayload()
}

async function requireAttachmentObjectKey(current: VaultPayload) {
  const material = String(current.attachmentKey || '')
  if (!material) throw new Error('Vault attachment key is missing')
  if (useAndroidNativeApi() || useDesktopNativeApi()) return importAttachmentKey(material)
  if (!attachmentObjectKey || attachmentKeyMaterial !== material) {
    const generation = sessionGeneration.capture()
    const key = await importAttachmentKey(material)
    sessionGeneration.requireCurrent(generation)
    attachmentObjectKey = key
    attachmentKeyMaterial = material
  }
  return attachmentObjectKey
}

async function getVault(): Promise<VaultPayload> {
  return cloneVaultPayload(await requirePayload())
}

async function saveVault(nextPayload: VaultPayload): Promise<VaultPayload> {
  const generation = sessionGeneration.capture()
  const current = await requirePayload()
  sessionGeneration.requireCurrent(generation)
  const currentKey = vaultKey
  const currentPasswordless = passwordless
  if (!currentKey) throw new Error('Vault is locked')
  const expectedRevision = Math.max(1, Math.floor(Number(nextPayload.revision || 1)))
  if (expectedRevision !== current.revision) {
    throw new ApiResultError('CONFLICT', 'Vault changed in another window; reload before saving')
  }

  const normalized = normalizeVaultPayload({ ...nextPayload, revision: expectedRevision + 1, updatedAt: nowSeconds() })
  assertNoKnownVaultDowngrade(current, normalized)
  const envelope = await encryptPayloadWithKey(currentKey, normalized)
  sessionGeneration.requireCurrent(generation)
  setEnvelopePasswordless(envelope, currentPasswordless)
  unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(envelope, null, 2), false, expectedRevision))
  sessionGeneration.requireCurrent(generation)
  payload = normalized
  refreshSession()
  return cloneVaultPayload(payload)
}

async function deletePasskey(passkeyId: string): Promise<VaultPayload> {
  const current = cloneVaultPayload(await requirePayload())
  if (!removePasskeyWithTombstone(current, passkeyId, nowSeconds())) {
    throw new Error('通行密钥不存在')
  }
  return saveVault(current)
}

async function changePassword(newPassword: string): Promise<AppState> {
  const generation = sessionGeneration.capture()
  const currentPayload = cloneVaultPayload(await requirePayload())
  sessionGeneration.requireCurrent(generation)
  const expectedRevision = currentPayload.revision
  const current = normalizeVaultPayload({ ...currentPayload, revision: expectedRevision + 1, updatedAt: nowSeconds() })
  const encrypted = await encryptPayload(newPassword || '', current)
  sessionGeneration.requireCurrent(generation)
  unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(encrypted.envelope, null, 2), false, expectedRevision))
  sessionGeneration.requireCurrent(generation)
  await verifyPersistedVaultAfterWrite(encrypted.vaultKey, current, generation)
  await cacheNativeSessionForGeneration(newPassword || '', generation)
  payload = current
  vaultKey = encrypted.vaultKey
  passwordless = (newPassword || '') === ''
  refreshSession()
  return getState()
}

/**
 * Bind the local vault to the exact KDF parameters from a verified remote
 * envelope. The remote payload is only used to validate the password; local
 * sync has already decided which payload must be kept.
 */
async function adoptVaultEncryptionFromEnvelope(envelopeText: string, password: string): Promise<AppState> {
  const generation = sessionGeneration.capture()
  const currentPayload = cloneVaultPayload(await requirePayload())
  sessionGeneration.requireCurrent(generation)
  const expectedRevision = currentPayload.revision
  const targetEnvelope = parseEnvelopeText(envelopeText)
  const decrypted = await decryptPayload(password || '', targetEnvelope)
  sessionGeneration.requireCurrent(generation)
  const nextPayload = normalizeVaultPayload({
    ...currentPayload,
    revision: expectedRevision + 1,
    updatedAt: nowSeconds()
  })
  const nextEnvelope = await encryptPayloadWithKey(decrypted.vaultKey, nextPayload)
  setEnvelopePasswordless(nextEnvelope, (password || '') === '')
  sessionGeneration.requireCurrent(generation)
  unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(nextEnvelope, null, 2), false, expectedRevision))
  sessionGeneration.requireCurrent(generation)
  await verifyPersistedVaultAfterWrite(decrypted.vaultKey, nextPayload, generation)
  await cacheNativeSessionForGeneration(password || '', generation)
  payload = nextPayload
  vaultKey = decrypted.vaultKey
  passwordless = (password || '') === ''
  refreshSession()
  return getState()
}

async function exportVaultBackup(): Promise<VaultBackupExport> {
  const generation = sessionGeneration.capture()
  await requirePayload()
  const content = unwrap(await selectedStorage().readVaultEnvelope())
  sessionGeneration.requireCurrent(generation)
  return {
    content,
    vaultPath: unwrap(await selectedStorage().getStorageState()).vaultPath,
    updatedAt: nowSeconds()
  }
}

async function verifyPersistedVaultAfterWrite(
  expectedKey: VaultKey,
  expectedPayload: VaultPayload,
  generation: number
) {
  try {
    const persistedEnvelope = parseEnvelopeText(unwrap(await selectedStorage().readVaultEnvelope()))
    const persistedPayload = normalizeVaultPayload(await decryptPayloadWithKey(expectedKey, persistedEnvelope))
    sessionGeneration.requireCurrent(generation)
    if (JSON.stringify(persistedPayload) !== JSON.stringify(expectedPayload)) {
      throw new Error('payload mismatch')
    }
  } catch {
    throw new Error('保险库写入校验失败，修改未生效')
  }
}

async function exportVaultBackupForPayload(nextPayload: VaultPayload): Promise<VaultBackupExport> {
  const generation = sessionGeneration.capture()
  const current = await requirePayload()
  sessionGeneration.requireCurrent(generation)
  const currentKey = vaultKey
  const currentPasswordless = passwordless
  if (!currentKey) throw new Error('Vault is locked')
  const normalized = normalizeVaultPayload({ ...nextPayload, updatedAt: nowSeconds() })
  assertNoKnownVaultDowngrade(current, normalized)
  const envelope = await encryptPayloadWithKey(currentKey, normalized)
  sessionGeneration.requireCurrent(generation)
  setEnvelopePasswordless(envelope, currentPasswordless)
  return {
    content: JSON.stringify(envelope, null, 2),
    vaultPath: unwrap(await selectedStorage().getStorageState()).vaultPath,
    updatedAt: normalized.updatedAt
  }
}

async function previewVaultBackup(envelopeText: string): Promise<VaultPayload> {
  const generation = sessionGeneration.capture()
  await requirePayload()
  sessionGeneration.requireCurrent(generation)
  const currentKey = vaultKey
  if (!currentKey) throw new Error('Vault is locked')
  const envelope = parseEnvelopeText(envelopeText)
  const decrypted = await decryptPayloadWithKey(currentKey, envelope)
  sessionGeneration.requireCurrent(generation)
  refreshSession()
  return cloneVaultPayload(normalizeVaultPayload(decrypted))
}

async function previewVaultBackupWithPassword(envelopeText: string, password: string): Promise<VaultPayload> {
  const generation = sessionGeneration.capture()
  await requirePayload()
  sessionGeneration.requireCurrent(generation)
  const envelope = parseEnvelopeText(envelopeText)
  const decrypted = await decryptPayload(password || '', envelope)
  sessionGeneration.requireCurrent(generation)
  refreshSession()
  return cloneVaultPayload(normalizeVaultPayload(decrypted.payload))
}

async function importVaultBackup(envelopeText: string): Promise<VaultBackupImport> {
  const generation = sessionGeneration.capture()
  const current = await requirePayload()
  sessionGeneration.requireCurrent(generation)
  const incoming = parseEnvelopeText(envelopeText)
  if (current.version === 2 && incoming.version < 2) {
    throw new Error('Refusing to replace a version 2 vault with version 1')
  }
  const writeResult = unwrap(await selectedStorage().writeVaultEnvelope(envelopeText, true, current.revision))
  sessionGeneration.requireCurrent(generation)
  await lock()
  return {
    state: await getState(),
    backupPath: writeResult.backupPath,
    vaultPath: writeResult.vaultPath
  }
}

async function exportPortableBackupPackage() {
  if (!useDesktopStorage()) return fail('UNSUPPORTED', 'Portable backup packages are currently available on desktop only.')
  const active = await desktopGetVault()
  if (!active.ok) return fail(active.code || 'LOCKED', active.message || 'Vault is locked')
  return callDesktopApi<PortableBackupExport>('exportPortableBackupPackage')
}

async function selectPortableBackupPackage() {
  if (!useDesktopStorage()) return fail('UNSUPPORTED', 'Portable backup packages are currently available on desktop only.')
  const active = await desktopGetVault()
  if (!active.ok) return fail(active.code || 'LOCKED', active.message || 'Vault is locked')
  return callDesktopApi<PortableBackupSelection>('selectPortableBackupPackage')
}

async function importPortableBackupPackage(selectionToken: string, password: string) {
  if (!useDesktopStorage()) return fail('UNSUPPORTED', 'Portable backup packages are currently available on desktop only.')
  const active = await desktopGetVault()
  if (!active.ok) return fail(active.code || 'LOCKED', active.message || 'Vault is locked')
  const result = await callDesktopApi<PortableBackupImport>('importPortableBackupPackage', selectionToken, password)
  if (result.ok) await lock()
  return result
}

async function discardPortableBackupSelection(selectionToken: string) {
  if (!useDesktopStorage()) return fail('UNSUPPORTED', 'Portable backup packages are currently available on desktop only.')
  return callDesktopApi<{ discarded: boolean }>('discardPortableBackupSelection', selectionToken)
}

async function requirePayload(): Promise<VaultPayload> {
  const generation = sessionGeneration.capture()
  if (!isUnlocked() || !payload || !vaultKey) {
    await lock()
    throw new Error('Vault is locked')
  }

  const currentPayload = payload
  const currentKey = vaultKey
  const envelope = parseEnvelopeText(unwrap(await selectedStorage().readVaultEnvelope()))
  sessionGeneration.requireCurrent(generation)
  const reloaded = normalizeVaultPayload(await decryptPayloadWithKey(currentKey, envelope))
  sessionGeneration.requireCurrent(generation)
  assertNoKnownVaultDowngrade(currentPayload, reloaded)
  payload = reloaded
  refreshSession()
  return payload
}

function assertNoKnownVaultDowngrade(current: VaultPayload, next: VaultPayload) {
  if (current.version === 2 && next.version < 2) {
    throw new Error('Refusing to downgrade a version 2 vault')
  }
}

function selectedStorage(): VaultStorageAdapter {
  if (useDesktopStorage()) return desktopStorageAdapter
  if (useWebStorage()) return webStorageAdapter
  return androidStorageAdapter
}

type DesktopPayloadResult =
  | { state?: AppState; payload?: Partial<VaultPayload>; saved?: boolean; revision?: number }
  | Partial<VaultPayload>

type DesktopStateResult =
  | { state?: AppState; payload?: Partial<VaultPayload>; passwordChanged?: boolean }
  | AppState

function useDesktopNativeApi() {
  return useDesktopStorage()
}

async function callDesktopVaultApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const result = await callDesktopApi<T>(method, ...args)
  if (!result.ok && result.code === 'ERROR' && errorCode(result.message) === 'CONFLICT') {
    return { ...result, code: 'CONFLICT' }
  }
  return result
}

function extractDesktopPayload(data: DesktopPayloadResult): Partial<VaultPayload> {
  if (data && typeof data === 'object' && 'payload' in data && data.payload && typeof data.payload === 'object') {
    return data.payload
  }
  return data as Partial<VaultPayload>
}

function extractDesktopState(data: DesktopStateResult): AppState {
  if (data && typeof data === 'object' && 'state' in data && data.state && typeof data.state === 'object') {
    return data.state
  }
  return data as AppState
}

async function desktopCreateVault(password: string, importLegacy: boolean): Promise<ApiResult<CreateVaultResult>> {
  const result = await callDesktopVaultApi<{
    state?: AppState
    payload?: Partial<VaultPayload>
    vault?: Partial<VaultPayload>
    migrated?: number
    legacyCleanupPending?: boolean
  }>('createVault', password || '', importLegacy)
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '创建保险库失败')
  }
  const rawPayload = result.data.payload ?? result.data.vault
  if (!rawPayload) return fail('DESKTOP_API_ERROR', '创建保险库返回数据不完整')
  return ok({
    vault: cloneVaultPayload(normalizeVaultPayload(rawPayload)),
    migrated: Number(result.data.migrated || 0),
    legacyCleanupPending: Boolean(result.data.legacyCleanupPending)
  })
}

async function desktopUnlock(password: string): Promise<ApiResult<VaultPayload>> {
  const result = await callDesktopVaultApi<DesktopPayloadResult>('unlock', password || '')
  if (!result.ok || !result.data) {
    return fail(result.code || 'BAD_PASSWORD', result.message || '解锁失败')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(extractDesktopPayload(result.data))))
}

async function desktopQuickUnlock(): Promise<ApiResult<VaultPayload>> {
  const result = await callDesktopVaultApi<DesktopPayloadResult>('quickUnlock')
  if (!result.ok || !result.data) {
    return fail(result.code || 'DEVICE_UNLOCK_FAILED', result.message || '设备快速解锁失败')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(extractDesktopPayload(result.data))))
}

async function desktopGetVault(): Promise<ApiResult<VaultPayload>> {
  const result = await callDesktopVaultApi<Partial<VaultPayload>>('getVault')
  if (!result.ok || !result.data) {
    return fail(result.code || 'LOCKED', result.message || 'Vault is locked')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(result.data)))
}

async function desktopSaveVault(nextPayload: VaultPayload): Promise<ApiResult<VaultPayload>> {
  const expectedRevision = Math.max(1, Math.floor(Number(nextPayload.revision || 1)))
  const normalized = normalizeVaultPayload(nextPayload)
  const result = await callDesktopVaultApi<DesktopPayloadResult>('saveVault', normalized, expectedRevision)
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '保存保险库失败')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(extractDesktopPayload(result.data))))
}

async function desktopDeletePasskey(passkeyId: string): Promise<ApiResult<VaultPayload>> {
  return guard(async () => {
    const current = cloneVaultPayload(unwrap(await desktopGetVault()))
    if (!removePasskeyWithTombstone(current, passkeyId, nowSeconds())) {
      throw new Error('通行密钥不存在')
    }
    return unwrap(await desktopSaveVault(current))
  })
}

async function desktopChangePassword(newPassword: string, currentPassword?: string): Promise<ApiResult<AppState>> {
  const result = currentPassword !== undefined
    ? await callDesktopVaultApi<DesktopStateResult>('changePasswordVerified', currentPassword, newPassword || '')
    : await callDesktopVaultApi<DesktopStateResult>('changePassword', newPassword || '')
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '修改主密码失败')
  }
  return ok(extractDesktopState(result.data))
}

async function desktopAdoptVaultEncryptionFromEnvelope(envelopeText: string, password: string): Promise<ApiResult<AppState>> {
  const result = await callDesktopVaultApi<DesktopStateResult>('adoptEncryptionFromEnvelope', envelopeText, password || '')
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '同步云端加密参数失败')
  }
  return ok(extractDesktopState(result.data))
}

async function desktopExportVaultBackup(): Promise<ApiResult<VaultBackupExport>> {
  const result = await callDesktopVaultApi<VaultBackupExport>('exportBackup')
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '导出备份失败')
  }
  return ok({
    content: result.data.content,
    vaultPath: result.data.vaultPath,
    updatedAt: result.data.updatedAt
  })
}

async function desktopExportVaultBackupForPayload(nextPayload: VaultPayload): Promise<ApiResult<VaultBackupExport>> {
  const normalized = normalizeVaultPayload(nextPayload)
  const result = await callDesktopVaultApi<VaultBackupExport>('exportBackupForPayload', normalized)
  if (!result.ok || !result.data) {
    return fail(result.code || 'ERROR', result.message || '生成备份数据失败')
  }
  return ok({
    content: result.data.content,
    vaultPath: result.data.vaultPath,
    updatedAt: result.data.updatedAt
  })
}

async function desktopPreviewVaultBackup(envelopeText: string): Promise<ApiResult<VaultPayload>> {
  const result = await callDesktopVaultApi<DesktopPayloadResult>('previewBackup', envelopeText)
  if (!result.ok || !result.data) {
    return fail(result.code || 'BAD_PASSWORD', result.message || '预览备份失败')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(extractDesktopPayload(result.data))))
}

async function desktopPreviewVaultBackupWithPassword(envelopeText: string, password: string): Promise<ApiResult<VaultPayload>> {
  const result = await callDesktopVaultApi<DesktopPayloadResult>('previewBackupWithPassword', envelopeText, password || '')
  if (!result.ok || !result.data) {
    return fail(result.code || 'BAD_PASSWORD', result.message || '预览备份失败')
  }
  return ok(cloneVaultPayload(normalizeVaultPayload(extractDesktopPayload(result.data))))
}

async function desktopImportVaultBackup(envelopeText: string): Promise<ApiResult<VaultBackupImport>> {
  const result = await callDesktopVaultApi<VaultBackupImport>('importBackup', envelopeText)
  if (result.ok) clearLocalSession()
  return result
}

function useAndroidNativeApi() {
  return !useDesktopStorage() && !useWebStorage() && Boolean(window.androidPasswordApi)
}

async function callAndroidApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const nativeApi = window.androidPasswordApi
  if (!nativeApi?.[method]) return fail('ANDROID_API_NOT_READY', 'Android 本地 API 未就绪。')
  try {
    const result = JSON.parse(String(nativeApi[method](...args))) as ApiResult<T>
    if (!result.ok && result.code === 'ERROR' && errorCode(result.message) === 'CONFLICT') {
      return { ...result, code: 'CONFLICT' }
    }
    return result
  } catch (error) {
    return fail('ANDROID_API_ERROR', error instanceof Error ? error.message : String(error))
  }
}

function useWebStorage() {
  const mode = storageMode()
  return ['web', 'front', 'browser', 'indexeddb'].includes(mode)
}

function useDesktopStorage() {
  const mode = storageMode()
  return ['desktop', 'pywebview', 'native'].includes(mode)
}

function storageMode() {
  try {
    return String(import.meta.env.VITE_STORAGE_MODE || import.meta.env.VITE_API_MODE || import.meta.env.MODE || '').toLowerCase()
  } catch {
    return ''
  }
}

function isUnlocked() {
  return Boolean(payload && vaultKey && expiresAt > Date.now())
}

function refreshSession() {
  expiresAt = Date.now() + SESSION_TIMEOUT_MS
}

async function cacheNativeSession(password: string) {
  const cache = selectedStorage().cacheUnlockedSession
  if (cache) await cache(password)
}

async function cacheNativeSessionForGeneration(password: string, generation: number) {
  sessionGeneration.requireCurrent(generation)
  await cacheNativeSession(password)
  if (!sessionGeneration.isCurrent(generation)) {
    await clearNativeSession()
    sessionGeneration.requireCurrent(generation)
  }
}

async function clearNativeSession() {
  const clear = selectedStorage().clearUnlockedSession
  if (clear) await clear()
}

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ApiResultError(result.code || 'ERROR', result.message || '操作失败')
  return result.data as T
}

async function guard<T>(fn: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    const code = errorCode(error)
    if (error instanceof ApiResultError && (error.code !== 'ERROR' || code !== 'CONFLICT')) {
      return fail(error.code, error.message)
    }
    return fail(code, error instanceof Error ? error.message : String(error))
  }
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/conflict|revision/i.test(message)) return 'CONFLICT'
  if (/locked/i.test(message)) return 'LOCKED'
  // A malformed/unsupported remote envelope cannot be repaired by asking for
  // another password. Keep it separate so cloud sync reports the actual
  // format problem instead of reopening the password prompt on every retry.
  if (/malformed|unsupported vault|invalid (?:vault|kdf|salt|nonce|ciphertext)/i.test(message)) {
    return 'INVALID_VAULT'
  }
  if (/password|decrypt|corrupt|operationerror/i.test(message)) return 'BAD_PASSWORD'
  if (/exist/i.test(message)) return 'ERROR'
  return 'ERROR'
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  return btoa(binary)
}

function toOwnedArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function parseEnvelopeText(value: string) {
  const text = String(value || '')
  if (text.length > MAX_VAULT_ENVELOPE_TEXT_LENGTH) throw new Error('Vault file exceeds the safe size limit')
  return validateEnvelope(JSON.parse(text))
}

class ApiResultError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
