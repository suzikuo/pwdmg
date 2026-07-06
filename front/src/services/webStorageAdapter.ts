import { emptyPluginListenerState, fail, ok } from './apiTypes'
import { idbGet, idbSet } from './indexedDbStore'
import { currentLegacyStorageSnapshot, hasLegacyWebData } from './legacyWeb'
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

export const webStorageAdapter: VaultStorageAdapter = {
  getStorageState: async () => guard(async () => ({
    hasVault: Boolean(await idbGet<unknown>(VAULT_KEY)),
    legacyAvailable: hasLegacyWebData(),
    vaultPath: VAULT_PATH_LABEL
  })),
  readVaultEnvelope: async () => guard(async () => {
    const envelope = await idbGet<unknown>(VAULT_KEY)
    if (!envelope) throw new Error('Vault does not exist')
    return JSON.stringify(envelope, null, 2)
  }),
  writeVaultEnvelope: async (envelopeText, protectBackup = false) => guard(async () => {
    const backupPath = protectBackup ? await backupCurrentEnvelope() : ''
    await idbSet(VAULT_KEY, JSON.parse(envelopeText))
    return { vaultPath: VAULT_PATH_LABEL, backupPath }
  }),
  readLegacyLocalStorage: async () => ok(JSON.stringify(currentLegacyStorageSnapshot())),
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
