import type { ApiResult, AppState, PluginListenerState, VaultBackupExport, VaultBackupImport, VaultPayload } from '../types'
import { androidStorageAdapter } from './androidStorageAdapter'
import { fail, ok, type CreateVaultResult, type PasswordManagerApiAdapter } from './apiTypes'
import { desktopStorageAdapter } from './desktopStorageAdapter'
import { migrateLegacyStorageText } from './legacyWeb'
import type { VaultStorageAdapter } from './storageTypes'
import { cloneVaultPayload, defaultVaultPayload, normalizeVaultPayload, nowSeconds } from './vaultDefaults'
import { decryptPayload, decryptPayloadWithKey, encryptPayload, encryptPayloadWithKey, validateEnvelope, type VaultKey } from './vaultCrypto'
import { webStorageAdapter } from './webStorageAdapter'

const SESSION_SECONDS = 10 * 60

let payload: VaultPayload | null = null
let vaultKey: VaultKey | null = null
let expiresAt = 0

export const api: PasswordManagerApiAdapter = {
  getState: () => useAndroidNativeApi() ? callAndroidApi('getState') : guard(getState),
  createVault: (password, importLegacy) => useAndroidNativeApi() ? callAndroidApi('createVault', password, importLegacy) : guard(() => createVault(password, importLegacy)),
  unlock: (password) => useAndroidNativeApi() ? callAndroidApi('unlock', password) : guard(() => unlock(password)),
  lock: () => useAndroidNativeApi() ? callAndroidApi('lock') : guard(lock),
  getVault: () => useAndroidNativeApi() ? callAndroidApi('getVault') : guard(getVault),
  saveVault: (nextPayload) => useAndroidNativeApi() ? callAndroidApi('saveVault', JSON.stringify(nextPayload)) : guard(() => saveVault(nextPayload)),
  changePassword: (newPassword) => useAndroidNativeApi() ? callAndroidApi('changePassword', newPassword) : guard(() => changePassword(newPassword)),
  exportVaultBackup: () => useAndroidNativeApi() ? callAndroidApi('exportVaultBackup') : guard(exportVaultBackup),
  importVaultBackup: (envelopeText) => useAndroidNativeApi() ? callAndroidApi('importVaultBackup', envelopeText) : guard(() => importVaultBackup(envelopeText)),
  getPluginListenerState: () => selectedStorage().getPluginListenerState(),
  enablePluginListener: (extensionId, browsers) => selectedStorage().enablePluginListener(extensionId, browsers),
  disablePluginListener: () => selectedStorage().disablePluginListener(),
  getAndroidAutofillState: () => selectedStorage().getAndroidAutofillState(),
  openAndroidAutofillSettings: () => selectedStorage().openAndroidAutofillSettings(),
  safeExit: () => selectedStorage().safeExit()
}

async function getState(): Promise<AppState> {
  const storageState = unwrap(await selectedStorage().getStorageState())
  return {
    hasVault: storageState.hasVault,
    locked: !isUnlocked(),
    expiresAt: isUnlocked() ? Math.floor(expiresAt / 1000) : 0,
    legacyAvailable: storageState.legacyAvailable,
    vaultPath: storageState.vaultPath
  }
}

async function createVault(password: string, importLegacy: boolean): Promise<CreateVaultResult> {
  const storage = selectedStorage()
  const storageState = unwrap(await storage.getStorageState())
  if (storageState.hasVault) throw new Error('Vault already exists; unlock it instead')

  let nextPayload = defaultVaultPayload()
  let migrated = 0
  if (importLegacy && storageState.legacyAvailable) {
    const legacyText = unwrap(await storage.readLegacyLocalStorage())
    const migratedResult = migrateLegacyStorageText(legacyText)
    nextPayload = migratedResult.payload
    migrated = migratedResult.migrated
  }

  const normalized = normalizeVaultPayload(nextPayload)
  const encrypted = await encryptPayload(password || '', normalized)
  unwrap(await storage.writeVaultEnvelope(JSON.stringify(encrypted.envelope, null, 2), false))
  payload = normalized
  vaultKey = encrypted.vaultKey
  refreshSession()
  await cacheNativeSession(password || '')
  return { vault: cloneVaultPayload(normalized), migrated }
}

async function unlock(password: string): Promise<VaultPayload> {
  const envelope = JSON.parse(unwrap(await selectedStorage().readVaultEnvelope()))
  const decrypted = await decryptPayload(password || '', validateEnvelope(envelope))
  payload = normalizeVaultPayload(decrypted.payload)
  vaultKey = decrypted.vaultKey
  refreshSession()
  await cacheNativeSession(password || '')
  return cloneVaultPayload(payload)
}

async function lock(): Promise<AppState> {
  payload = null
  vaultKey = null
  expiresAt = 0
  await clearNativeSession()
  return getState()
}

async function getVault(): Promise<VaultPayload> {
  return cloneVaultPayload(await requirePayload())
}

async function saveVault(nextPayload: VaultPayload): Promise<VaultPayload> {
  await requirePayload()
  if (!vaultKey) throw new Error('Vault is locked')

  payload = normalizeVaultPayload({ ...nextPayload, updatedAt: nowSeconds() })
  const envelope = await encryptPayloadWithKey(vaultKey, payload)
  unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(envelope, null, 2), false))
  refreshSession()
  return cloneVaultPayload(payload)
}

async function changePassword(newPassword: string): Promise<AppState> {
  const current = cloneVaultPayload(await requirePayload())
  const encrypted = await encryptPayload(newPassword || '', current)
  unwrap(await selectedStorage().writeVaultEnvelope(JSON.stringify(encrypted.envelope, null, 2), false))
  payload = current
  vaultKey = encrypted.vaultKey
  refreshSession()
  await cacheNativeSession(newPassword || '')
  return getState()
}

async function exportVaultBackup(): Promise<VaultBackupExport> {
  await requirePayload()
  const content = unwrap(await selectedStorage().readVaultEnvelope())
  return {
    content,
    vaultPath: unwrap(await selectedStorage().getStorageState()).vaultPath,
    updatedAt: nowSeconds()
  }
}

async function importVaultBackup(envelopeText: string): Promise<VaultBackupImport> {
  await requirePayload()
  validateEnvelope(JSON.parse(envelopeText))
  const writeResult = unwrap(await selectedStorage().writeVaultEnvelope(envelopeText, true))
  await lock()
  return {
    state: await getState(),
    backupPath: writeResult.backupPath,
    vaultPath: writeResult.vaultPath
  }
}

async function requirePayload(): Promise<VaultPayload> {
  if (!isUnlocked() || !payload || !vaultKey) {
    await lock()
    throw new Error('Vault is locked')
  }

  const envelope = validateEnvelope(JSON.parse(unwrap(await selectedStorage().readVaultEnvelope())))
  payload = normalizeVaultPayload(await decryptPayloadWithKey(vaultKey, envelope))
  refreshSession()
  return payload
}

function selectedStorage(): VaultStorageAdapter {
  if (useDesktopStorage()) return desktopStorageAdapter
  if (useWebStorage()) return webStorageAdapter
  return androidStorageAdapter
}

function useAndroidNativeApi() {
  return !useDesktopStorage() && !useWebStorage() && Boolean(window.androidPasswordApi)
}

async function callAndroidApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const nativeApi = window.androidPasswordApi
  if (!nativeApi?.[method]) return fail('ANDROID_API_NOT_READY', 'Android 本地 API 未就绪。')
  try {
    return JSON.parse(String(nativeApi[method](...args))) as ApiResult<T>
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
  return String(import.meta.env.VITE_STORAGE_MODE || import.meta.env.VITE_API_MODE || import.meta.env.MODE || '').toLowerCase()
}

function isUnlocked() {
  return Boolean(payload && vaultKey && Date.now() < expiresAt)
}

function refreshSession() {
  expiresAt = Date.now() + SESSION_SECONDS * 1000
}

async function cacheNativeSession(password: string) {
  const cache = selectedStorage().cacheUnlockedSession
  if (cache) await cache(password)
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
    if (error instanceof ApiResultError) return fail(error.code, error.message)
    return fail(errorCode(error), error instanceof Error ? error.message : String(error))
  }
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/locked/i.test(message)) return 'LOCKED'
  if (/password|decrypt|corrupt|operationerror|malformed/i.test(message)) return 'BAD_PASSWORD'
  if (/exist/i.test(message)) return 'ERROR'
  return 'ERROR'
}

class ApiResultError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}
