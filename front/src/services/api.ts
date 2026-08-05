import type { ApiResult, AppState, PluginListenerState, VaultBackupExport, VaultBackupImport, VaultPayload } from '../types'
import { androidStorageAdapter } from './androidStorageAdapter'
import { fail, ok, type CreateVaultResult, type PasswordManagerApiAdapter, type StartupData } from './apiTypes'
import { callDesktopApi, desktopStorageAdapter } from './desktopStorageAdapter'
import { migrateLegacyStorageText } from './legacyWeb'
import { removePasskeyWithTombstone } from './passkeyManagement'
import { SessionGeneration } from './sessionGeneration'
import type { VaultStorageAdapter } from './storageTypes'
import { cloneVaultPayload, defaultVaultPayload, normalizeVaultPayload, nowSeconds } from './vaultDefaults'
import { decryptPayload, decryptPayloadWithKey, encryptPayload, encryptPayloadWithKey, setEnvelopePasswordless, validateEnvelope, type VaultKey } from './vaultCrypto'
import { webStorageAdapter } from './webStorageAdapter'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const MAX_VAULT_ENVELOPE_TEXT_LENGTH = 24 * 1024 * 1024

let payload: VaultPayload | null = null
let vaultKey: VaultKey | null = null
let passwordless = false
let expiresAt = 0
const sessionGeneration = new SessionGeneration()

export const api: PasswordManagerApiAdapter = {
  getAppInfo: () => selectedStorage().getAppInfo(),
  getStartupData: () => getStartupData(),
  getState: () => nativeVaultCall('getState', () => guard(getState)),
  createVault: (password, importLegacy) => nativeVaultCall('createVault', () => guard(() => createVault(password, importLegacy)), password, importLegacy),
  unlock: (password) => nativeVaultCall('unlock', () => guard(() => unlock(password)), password),
  lock: () => nativeVaultCall('lock', () => guard(lock)),
  getVault: () => nativeVaultCall('getVault', () => guard(getVault)),
  saveVault: (nextPayload) => nativeVaultCall('saveVault', () => guard(() => saveVault(nextPayload)), nextPayload),
  deletePasskey: (passkeyId) => nativeVaultCall('deletePasskey', () => guard(() => deletePasskey(passkeyId)), passkeyId),
  changePassword: (newPassword) => nativeVaultCall('changePassword', () => guard(() => changePassword(newPassword)), newPassword),
  exportVaultBackup: () => nativeVaultCall('exportVaultBackup', () => guard(exportVaultBackup)),
  exportVaultBackupForPayload: (nextPayload) => nativeVaultCall('exportVaultBackupForPayload', () => guard(() => exportVaultBackupForPayload(nextPayload)), nextPayload),
  previewVaultBackup: (envelopeText) => nativeVaultCall('previewVaultBackup', () => guard(() => previewVaultBackup(envelopeText)), envelopeText),
  previewVaultBackupWithPassword: (envelopeText, password) => nativeVaultCall('previewVaultBackupWithPassword', () => guard(() => previewVaultBackupWithPassword(envelopeText, password)), envelopeText, password),
  importVaultBackup: (envelopeText) => nativeVaultCall('importVaultBackup', () => guard(() => importVaultBackup(envelopeText)), envelopeText),
  getPluginListenerState: () => selectedStorage().getPluginListenerState(),
  enablePluginListener: (extensionId, browsers) => selectedStorage().enablePluginListener(extensionId, browsers),
  disablePluginListener: () => selectedStorage().disablePluginListener(),
  getAndroidAutofillState: () => selectedStorage().getAndroidAutofillState(),
  openAndroidAutofillSettings: () => selectedStorage().openAndroidAutofillSettings(),
  checkAppUpdate: (manifestUrl, onProgress) => selectedStorage().checkAppUpdate(manifestUrl, onProgress),
  downloadAppUpdate: (manifestUrl, onProgress) => selectedStorage().downloadAppUpdate(manifestUrl, onProgress),
  applyAppUpdate: (packagePath) => selectedStorage().applyAppUpdate(packagePath),
  safeExit: () => selectedStorage().safeExit()
}

async function getStartupData(): Promise<ApiResult<StartupData>> {
  if (useAndroidNativeApi()) {
    const response = await callAndroidApi<AppState>('getState')
    if (!response.ok || !response.data) return fail(response.code || 'ERROR', response.message || '读取启动状态失败')
    return ok({ state: response.data })
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
    unlockedPayload = normalizeVaultPayload({
      ...unlockedPayload,
      revision: expectedRevision + 1,
      updatedAt: nowSeconds()
    })
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

async function lock(): Promise<AppState> {
  sessionGeneration.invalidate()
  payload = null
  vaultKey = null
  passwordless = false
  expiresAt = 0
  await clearNativeSession()
  return getState()
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
  await cacheNativeSessionForGeneration(newPassword || '', generation)
  payload = current
  vaultKey = encrypted.vaultKey
  passwordless = (newPassword || '') === ''
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
    if (error instanceof ApiResultError) return fail(error.code, error.message)
    return fail(errorCode(error), error instanceof Error ? error.message : String(error))
  }
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/conflict|revision/i.test(message)) return 'CONFLICT'
  if (/locked/i.test(message)) return 'LOCKED'
  if (/password|decrypt|corrupt|operationerror|malformed/i.test(message)) return 'BAD_PASSWORD'
  if (/exist/i.test(message)) return 'ERROR'
  return 'ERROR'
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseEnvelopeText(value: string) {
  const text = String(value || '')
  if (text.length > MAX_VAULT_ENVELOPE_TEXT_LENGTH) throw new Error('Vault file exceeds the safe size limit')
  return validateEnvelope(JSON.parse(text))
}

class ApiResultError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}
