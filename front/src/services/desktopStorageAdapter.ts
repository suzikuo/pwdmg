import type { ApiResult, AppUpdateApply, AppUpdateCheck, AppUpdateDownload, PluginListenerState } from '../types'
import { fail, ok } from './apiTypes'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes'

const pywebviewWaitMs = import.meta.env.DEV ? 600 : 15000

let pyApiReadyPromise: Promise<ReturnType<typeof pyApi>> | null = null

export const desktopStorageAdapter: VaultStorageAdapter = {
  getStorageState: () => call<StorageState>('getStorageState'),
  readVaultEnvelope: () => call<string>('readVaultEnvelope'),
  writeVaultEnvelope: (envelopeText, protectBackup = false) => call<WriteEnvelopeResult>('writeVaultEnvelope', envelopeText, protectBackup),
  readLegacyLocalStorage: () => call<string>('readLegacyLocalStorage'),
  getPluginListenerState: () => call<PluginListenerState>('getPluginListenerState'),
  enablePluginListener: (extensionId, browsers) => call<PluginListenerState>('enablePluginListener', extensionId, browsers),
  disablePluginListener: () => call<PluginListenerState>('disablePluginListener'),
  getAndroidAutofillState: async () => ok({
    supported: false,
    enabled: false,
    serviceName: '',
    settingsAvailable: false
  }),
  openAndroidAutofillSettings: async () => fail('ANDROID_ONLY', '自动填充服务只能在 Android 端配置。'),
  checkAppUpdate: (manifestUrl) => call<AppUpdateCheck>('checkDesktopUpdate', manifestUrl),
  downloadAppUpdate: (manifestUrl) => call<AppUpdateDownload>('downloadDesktopUpdate', manifestUrl),
  applyAppUpdate: (packagePath) => call<AppUpdateApply>('applyDesktopUpdate', packagePath),
  safeExit: () => call<null>('safeExit')
}

export function callDesktopApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return call<T>(method, ...args)
}

async function call<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const api = await resolvePyApi()
  if (api?.[method]) return api[method](...args) as Promise<ApiResult<T>>
  return fail('PYWEBVIEW_NOT_READY', '正在等待桌面端本地 API。若长时间停留，请确认通过 main.py 启动。')
}

function pyApi() {
  return window.pywebview?.api
}

async function resolvePyApi() {
  const current = pyApi()
  if (current) return current

  if (!pyApiReadyPromise) {
    pyApiReadyPromise = new Promise<ReturnType<typeof pyApi>>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.removeEventListener('pywebviewready', finish)
        if (!pyApi()) pyApiReadyPromise = null
        resolve(pyApi())
      }

      window.addEventListener('pywebviewready', finish, { once: true })
      window.setTimeout(finish, pywebviewWaitMs)
    })
  }

  return pyApiReadyPromise
}
