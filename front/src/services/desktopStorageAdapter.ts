import type { ApiResult, AppInfo, AppUpdateApply, AppUpdateCheck, AppUpdateDownload, AttachmentObjectRetention, AttachmentObjectWrite, AttachmentStorageState, PluginListenerState } from '../types'
import { emptyAndroidPasskeyProviderState, fail, ok } from './apiTypes'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes'

const pywebviewWaitMs = import.meta.env.DEV ? 600 : 15000

let pyApiReadyPromise: Promise<ReturnType<typeof pyApi>> | null = null

export const desktopStorageAdapter: VaultStorageAdapter = {
  getAppInfo: () => call<AppInfo>('getAppInfo'),
  getStorageState: () => call<StorageState>('getStorageState'),
  readVaultEnvelope: () => call<string>('readVaultEnvelope'),
  writeVaultEnvelope: (envelopeText, protectBackup = false, expectedRevision) => expectedRevision === undefined
    ? call<WriteEnvelopeResult>('writeVaultEnvelope', envelopeText, protectBackup)
    : call<WriteEnvelopeResult>('writeVaultEnvelope', envelopeText, protectBackup, expectedRevision),
  readLegacyLocalStorage: () => call<string>('readLegacyLocalStorage'),
  getAttachmentStorageState: () => call<AttachmentStorageState>('getAttachmentStorageState'),
  readAttachmentObject: (attachmentId) => call<string>('readAttachmentObject', attachmentId),
  writeAttachmentObject: (attachmentId, objectText) => call<AttachmentObjectWrite>('writeAttachmentObject', attachmentId, objectText),
  retainAttachmentObject: (attachmentId) => call<AttachmentObjectRetention>('retainAttachmentObject', attachmentId),
  collectAttachmentObjects: (referencedIds) => call<{ retained: number; deleted: number }>('collectAttachmentObjects', referencedIds),
  cleanupLegacyStorage: (expectedDigest) => call<unknown>('cleanupLegacyStorage', expectedDigest),
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
  getAndroidPasskeyProviderState: async () => ok(emptyAndroidPasskeyProviderState()),
  setAndroidPasskeyProviderEnabled: async () => fail('ANDROID_ONLY', 'Android only.'),
  openAndroidPasskeyProviderSettings: async () => fail('ANDROID_ONLY', 'Android only.'),
  safeExit: () => call<null>('safeExit')
}

function getTauriInvoke(): ((cmd: string, payload?: any) => Promise<any>) | null {
  const w = typeof window !== 'undefined' ? (window as any) : null
  if (!w) return null
  if (w.__TAURI_INTERNALS__?.invoke) return w.__TAURI_INTERNALS__.invoke
  if (w.__TAURI__?.core?.invoke) return w.__TAURI__.core.invoke
  return null
}

export function callDesktopApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return call<T>(method, ...args)
}

export async function showDesktopWindow(): Promise<void> {
  const invoke = getTauriInvoke()
  if (invoke) {
    try {
      await invoke('desktop_api', { method: 'showWindow', args: [] })
      return
    } catch {
      // ignore
    }
  }
  void callDesktopApi('showWindow')
}

async function call<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const invoke = getTauriInvoke()
  if (invoke) {
    try {
      const res = (await invoke('desktop_api', { method, args })) as ApiResult<T>
      if (res && typeof res === 'object' && 'ok' in res) return res
      return ok(res as T)
    } catch (err) {
      return fail('DESKTOP_API_ERROR', err instanceof Error ? err.message : String(err))
    }
  }

  const api = await resolvePyApi()
  if (api?.[method]) return api[method](...args) as Promise<ApiResult<T>>

  const lateInvoke = getTauriInvoke()
  if (lateInvoke) {
    try {
      const res = (await lateInvoke('desktop_api', { method, args })) as ApiResult<T>
      if (res && typeof res === 'object' && 'ok' in res) return res
      return ok(res as T)
    } catch (err) {
      return fail('DESKTOP_API_ERROR', err instanceof Error ? err.message : String(err))
    }
  }

  return fail('DESKTOP_API_NOT_READY', '正在等待桌面端本地 API。若长时间停留，请确认桌面应用正常运行。')
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
      let elapsed = 0
      const pollTimer = window.setInterval(() => {
        elapsed += 25
        if (pyApi() || getTauriInvoke() || elapsed >= 1000) {
          window.clearInterval(pollTimer)
          finish()
        }
      }, 25)
    })
  }

  return pyApiReadyPromise
}
