import { emptyPluginListenerState, fail, ok } from './apiTypes'
import { idbDelete, idbGet, idbSet, idbSetIfCurrentRevision, idbSetIfRevision } from './indexedDbStore'
import { clearLegacyWebData, currentLegacyStorageSnapshot, hasLegacyWebData } from './legacyWeb'
import type { VaultStorageAdapter } from './storageTypes'

type StoredBackup = {
  name: string
  content: string
  createdAt: number
}

const VAULT_KEY = 'vault'
const BACKUPS_KEY = 'importBackups'
const MAX_IMPORT_BACKUPS = 5
const VAULT_PATH_LABEL = 'IndexedDB:mypwdmg-web-vault/vault'
const PACKAGED_APP_VERSION = String(import.meta.env.PACKAGE_VERSION || '0.0.0')
const ATTACHMENT_MANIFEST_KEY = 'attachmentManifest'
const ATTACHMENT_OBJECT_PREFIX = 'attachmentObject:'
const ATTACHMENT_RETAINED_PREFIX = 'attachmentRetained:'
const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENT_STORE_BYTES = 256 * 1024 * 1024

type WebAttachmentManifestItem = { objectBytes: number; retained: boolean; deletedAt?: number }
type WebAttachmentManifest = Record<string, WebAttachmentManifestItem>

export const webStorageAdapter: VaultStorageAdapter = {
  getAppInfo: async () => ok({
    version: PACKAGED_APP_VERSION,
    platform: 'web'
  }),
  getStorageState: async () => guard(async () => {
    const envelope = await idbGet<Record<string, unknown>>(VAULT_KEY)
    return {
      hasVault: Boolean(envelope),
      legacyAvailable: hasLegacyWebData(),
      vaultPath: VAULT_PATH_LABEL,
      passwordless: envelope?.passwordless === true
    }
  }),
  readVaultEnvelope: async () => guard(async () => {
    const envelope = await idbGet<unknown>(VAULT_KEY)
    if (!envelope) throw new Error('Vault does not exist')
    return JSON.stringify(envelope, null, 2)
  }),
  writeVaultEnvelope: async (envelopeText, protectBackup = false, expectedRevision) => guard(async () => {
    const envelope = JSON.parse(envelopeText) as Record<string, unknown>
    const current = await idbGet<Record<string, unknown>>(VAULT_KEY)
    if (current?.version === 2 && envelope.version === 1) {
      throw new Error('Refusing to replace a version 2 vault with version 1')
    }
    const backupPath = protectBackup ? await backupCurrentEnvelope() : ''
    if (expectedRevision === undefined) await idbSet(VAULT_KEY, envelope)
    else if (protectBackup) await idbSetIfCurrentRevision(VAULT_KEY, envelope, expectedRevision)
    else await idbSetIfRevision(VAULT_KEY, envelope, expectedRevision)
    return { vaultPath: VAULT_PATH_LABEL, backupPath }
  }),
  readLegacyLocalStorage: async () => ok(JSON.stringify(currentLegacyStorageSnapshot())),
  getAttachmentStorageState: () => guard(async () => {
    const manifest = (await idbGet<WebAttachmentManifest>(ATTACHMENT_MANIFEST_KEY)) || {}
    const active = Object.values(manifest).filter((item) => !item.retained)
    const retained = Object.values(manifest).filter((item) => item.retained)
    return {
      maxFileBytes: MAX_ATTACHMENT_FILE_BYTES,
      quotaBytes: MAX_ATTACHMENT_STORE_BYTES,
      activeCount: active.length,
      activeBytes: active.reduce((total, item) => total + item.objectBytes, 0),
      retainedCount: retained.length,
      retainedBytes: retained.reduce((total, item) => total + item.objectBytes, 0)
    }
  }),
  readAttachmentObject: (attachmentId) => guard(async () => {
    const activeKey = ATTACHMENT_OBJECT_PREFIX + attachmentId
    let text = await idbGet<string>(activeKey)
    if (!text) {
      const retainedKey = ATTACHMENT_RETAINED_PREFIX + attachmentId
      text = await idbGet<string>(retainedKey)
      if (text) {
        await idbSet(activeKey, text)
        await idbDelete(retainedKey)
        const manifest = (await idbGet<WebAttachmentManifest>(ATTACHMENT_MANIFEST_KEY)) || {}
        if (manifest[attachmentId]) manifest[attachmentId] = { ...manifest[attachmentId], retained: false, deletedAt: undefined }
        await idbSet(ATTACHMENT_MANIFEST_KEY, manifest)
      }
    }
    if (!text) throw new Error('Attachment object does not exist')
    return text
  }),
  writeAttachmentObject: (attachmentId, objectText) => guard(async () => {
    const key = ATTACHMENT_OBJECT_PREFIX + attachmentId
    const existing = await idbGet<string>(key)
    if (existing && existing !== objectText) throw new Error('Attachment objects are immutable')
    const objectBytes = new TextEncoder().encode(objectText).byteLength
    const manifest = (await idbGet<WebAttachmentManifest>(ATTACHMENT_MANIFEST_KEY)) || {}
    const storedBytes = Object.values(manifest).reduce((total, item) => total + item.objectBytes, 0)
    if (!existing && storedBytes + objectBytes > MAX_ATTACHMENT_STORE_BYTES) throw new Error('Attachment storage quota exceeded')
    await idbSet(key, objectText)
    manifest[attachmentId] = { objectBytes, retained: false }
    await idbSet(ATTACHMENT_MANIFEST_KEY, manifest)
    return { attachmentId, objectBytes }
  }),
  retainAttachmentObject: (attachmentId) => guard(async () => {
    const key = ATTACHMENT_OBJECT_PREFIX + attachmentId
    const text = await idbGet<string>(key)
    if (!text) return { attachmentId, retained: false }
    const deletedAt = Math.floor(Date.now() / 1000)
    await idbSet(ATTACHMENT_RETAINED_PREFIX + attachmentId, text)
    await idbDelete(key)
    const manifest = (await idbGet<WebAttachmentManifest>(ATTACHMENT_MANIFEST_KEY)) || {}
    if (manifest[attachmentId]) manifest[attachmentId] = { ...manifest[attachmentId], retained: true, deletedAt }
    await idbSet(ATTACHMENT_MANIFEST_KEY, manifest)
    return { attachmentId, retained: true, deletedAt }
  }),
  collectAttachmentObjects: async () => ok({ retained: 0, deleted: 0 }),
  cleanupLegacyStorage: (expectedDigest) => guard(async () => {
    const current = JSON.stringify(currentLegacyStorageSnapshot())
    if (await sha256Text(current) !== expectedDigest) throw new Error('Legacy data changed during migration')
    clearLegacyWebData()
    return true
  }),
  getPluginListenerState: async () => ok(emptyPluginListenerState('web-indexeddb')),
  enablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  disablePluginListener: async () => fail('DESKTOP_ONLY', '插件监听只能在 Windows 桌面端配置。'),
  getAndroidAutofillState: async () => ok(emptyAndroidAutofillState()),
  openAndroidAutofillSettings: async () => fail('ANDROID_ONLY', '自动填充服务只能在 Android 端配置。'),
  checkAppUpdate: async () => fail('NATIVE_ONLY', '应用更新只能在桌面端或 Android 端使用。'),
  downloadAppUpdate: async () => fail('NATIVE_ONLY', '应用更新只能在桌面端或 Android 端使用。'),
  applyAppUpdate: async () => fail('NATIVE_ONLY', '应用更新只能在桌面端或 Android 端使用。'),
  safeExit: async () => ok(null)
}

function emptyAndroidAutofillState() {
  return {
    supported: false,
    enabled: false,
    serviceName: '',
    settingsAvailable: false
  }
}

async function backupCurrentEnvelope() {
  const envelope = await idbGet<unknown>(VAULT_KEY)
  if (!envelope) return ''
  const name = `vault-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const backups = ((await idbGet<StoredBackup[]>(BACKUPS_KEY)) || [])
    .concat({
      name,
      content: JSON.stringify(envelope, null, 2),
      createdAt: Date.now()
    })
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_IMPORT_BACKUPS)
  await idbSet(BACKUPS_KEY, backups)
  return `IndexedDB:${name}`
}

async function guard<T>(fn: () => Promise<T> | T) {
  try {
    return ok(await fn())
  } catch (error) {
    return fail('WEB_STORAGE_ERROR', error instanceof Error ? error.message : String(error))
  }
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
