import { emptyAndroidPasskeyProviderState, emptyPluginListenerState, fail, ok } from './apiTypes'
import { validateAttachmentId, validateEncryptedAttachmentObject } from './attachmentCrypto'
import { idbGet, idbRunReadwrite, idbSet, idbSetIfCurrentRevision, idbSetIfRevision } from './indexedDbStore'
import { clearLegacyWebData, currentLegacyStorageSnapshot, hasLegacyWebData } from './legacyWeb'
import type { VaultStorageAdapter } from './storageTypes'
import {
  normalizeWebAttachmentManifest,
  planWebAttachmentCollection
} from './webAttachmentRetention.ts'

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
    const manifest = normalizeWebAttachmentManifest(await idbGet<unknown>(ATTACHMENT_MANIFEST_KEY))
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
    const id = validateAttachmentId(attachmentId)
    return idbRunReadwrite(async (transaction) => {
      const activeKey = ATTACHMENT_OBJECT_PREFIX + id
      const retainedKey = ATTACHMENT_RETAINED_PREFIX + id
      let text = await transaction.get<string>(activeKey)
      if (text === null) text = await transaction.get<string>(retainedKey)
      if (text === null) throw new Error('Attachment object does not exist')
      validateEncryptedAttachmentObject(text, id)

      const manifest = normalizeWebAttachmentManifest(await transaction.get<unknown>(ATTACHMENT_MANIFEST_KEY))
      const existing = manifest[id]
      manifest[id] = {
        objectBytes: new TextEncoder().encode(text).byteLength,
        retained: false,
        createdAt: existing?.createdAt || Math.floor(Date.now() / 1000)
      }
      transaction.set(activeKey, text)
      transaction.delete(retainedKey)
      transaction.set(ATTACHMENT_MANIFEST_KEY, manifest)
      return text
    })
  }),
  writeAttachmentObject: (attachmentId, objectText) => guard(async () => {
    const id = validateAttachmentId(attachmentId)
    validateEncryptedAttachmentObject(objectText, id)
    const objectBytes = new TextEncoder().encode(objectText).byteLength
    return idbRunReadwrite(async (transaction) => {
      const activeKey = ATTACHMENT_OBJECT_PREFIX + id
      const retainedKey = ATTACHMENT_RETAINED_PREFIX + id
      const activeText = await transaction.get<string>(activeKey)
      const retainedText = activeText === null ? await transaction.get<string>(retainedKey) : null
      const existingText = activeText ?? retainedText
      if (existingText !== null && existingText !== objectText) throw new Error('Attachment objects are immutable')

      const manifest = normalizeWebAttachmentManifest(await transaction.get<unknown>(ATTACHMENT_MANIFEST_KEY))
      const existingItem = manifest[id]
      if (existingText === null) {
        const storedBytes = Object.values(manifest).reduce((total, item) => total + item.objectBytes, 0)
        if (storedBytes + objectBytes > MAX_ATTACHMENT_STORE_BYTES) throw new Error('Attachment storage quota exceeded')
      }

      transaction.set(activeKey, objectText)
      transaction.delete(retainedKey)
      manifest[id] = {
        objectBytes,
        retained: false,
        createdAt: existingItem?.createdAt || Math.floor(Date.now() / 1000)
      }
      transaction.set(ATTACHMENT_MANIFEST_KEY, manifest)
      return { attachmentId: id, objectBytes }
    })
  }),
  retainAttachmentObject: (attachmentId) => guard(async () => {
    const id = validateAttachmentId(attachmentId)
    return idbRunReadwrite(async (transaction) => {
      const activeKey = ATTACHMENT_OBJECT_PREFIX + id
      const text = await transaction.get<string>(activeKey)
      if (text === null) return { attachmentId: id, retained: false }
      validateEncryptedAttachmentObject(text, id)

      const now = Math.floor(Date.now() / 1000)
      const manifest = normalizeWebAttachmentManifest(await transaction.get<unknown>(ATTACHMENT_MANIFEST_KEY))
      const existing = manifest[id]
      transaction.set(ATTACHMENT_RETAINED_PREFIX + id, text)
      transaction.delete(activeKey)
      manifest[id] = {
        objectBytes: new TextEncoder().encode(text).byteLength,
        retained: true,
        createdAt: existing?.createdAt || now,
        deletedAt: now
      }
      transaction.set(ATTACHMENT_MANIFEST_KEY, manifest)
      return { attachmentId: id, retained: true, deletedAt: now }
    })
  }),
  collectAttachmentObjects: (referencedIds) => guard(async () => idbRunReadwrite(async (transaction) => {
    const currentManifest = await transaction.get<unknown>(ATTACHMENT_MANIFEST_KEY)
    const plan = planWebAttachmentCollection(currentManifest, referencedIds)

    for (const id of plan.restoreIds) {
      const activeKey = ATTACHMENT_OBJECT_PREFIX + id
      const retainedKey = ATTACHMENT_RETAINED_PREFIX + id
      const activeText = await transaction.get<string>(activeKey)
      const retainedText = await transaction.get<string>(retainedKey)
      if (retainedText === null && activeText === null) throw new Error('Attachment object does not exist')
      if (retainedText !== null) {
        validateEncryptedAttachmentObject(retainedText, id)
        if (activeText !== null && activeText !== retainedText) throw new Error('Attachment objects are immutable')
        transaction.set(activeKey, retainedText)
        transaction.delete(retainedKey)
      }
    }

    for (const id of plan.retainIds) {
      const activeKey = ATTACHMENT_OBJECT_PREFIX + id
      const text = await transaction.get<string>(activeKey)
      if (text === null) throw new Error('Attachment object does not exist')
      validateEncryptedAttachmentObject(text, id)
      transaction.set(ATTACHMENT_RETAINED_PREFIX + id, text)
      transaction.delete(activeKey)
    }

    for (const id of plan.deleteIds) {
      transaction.delete(ATTACHMENT_OBJECT_PREFIX + id)
      transaction.delete(ATTACHMENT_RETAINED_PREFIX + id)
    }

    transaction.set(ATTACHMENT_MANIFEST_KEY, plan.manifest)
    return { retained: plan.retainIds.length, deleted: plan.deleteIds.length }
  })),
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
  getAndroidPasskeyProviderState: async () => ok(emptyAndroidPasskeyProviderState()),
  setAndroidPasskeyProviderEnabled: async () => fail('ANDROID_ONLY', 'Android only.'),
  openAndroidPasskeyProviderSettings: async () => fail('ANDROID_ONLY', 'Android only.'),
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
