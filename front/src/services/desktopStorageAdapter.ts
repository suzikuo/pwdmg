import type { ApiResult, AppInfo, AppUpdateApply, AppUpdateCheck, AppUpdateDownload, AttachmentObjectRetention, AttachmentObjectWrite, AttachmentStorageState, PluginListenerState } from '../types.ts'
import { emptyAndroidPasskeyProviderState, fail, ok } from './apiTypes.ts'
import type { StorageState, VaultStorageAdapter, WriteEnvelopeResult } from './storageTypes.ts'

const BRIDGE_READY_TIMEOUT_MS = 1000
const BRIDGE_POLL_INTERVAL_MS = 25

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
    settingsAvailable: false,
    inlineSupported: false,
    inlineEnabled: false
  }),
  setAndroidAutofillInlineEnabled: async () => fail('ANDROID_ONLY', '键盘内联填充只能在 Android 端配置。'),
  openAndroidAutofillSettings: async () => fail('ANDROID_ONLY', '自动填充服务只能在 Android 端配置。'),
  checkAppUpdate: (manifestUrl) => call<AppUpdateCheck>('checkDesktopUpdate', manifestUrl),
  downloadAppUpdate: (manifestUrl) => call<AppUpdateDownload>('downloadDesktopUpdate', manifestUrl),
  applyAppUpdate: (packagePath) => call<AppUpdateApply>('applyDesktopUpdate', packagePath),
  getAndroidPasskeyProviderState: async () => ok(emptyAndroidPasskeyProviderState()),
  setAndroidPasskeyProviderEnabled: async () => fail('ANDROID_ONLY', 'Android only.'),
  openAndroidPasskeyProviderSettings: async () => fail('ANDROID_ONLY', 'Android only.'),
  safeExit: () => call<null>('safeExit')
}

type TauriInvoke = (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null
  if (window.__TAURI_INTERNALS__?.invoke) return window.__TAURI_INTERNALS__.invoke
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke
  return null
}

function getTauriEventListen() {
  if (typeof window === 'undefined') return null
  return window.__TAURI__?.event?.listen ?? null
}

export function callDesktopApi<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return call<T>(method, ...args)
}

export async function showDesktopWindow(): Promise<void> {
  try {
    await callDesktopApi('showWindow')
  } catch {
    // ignore
  }
}

export function subscribeDesktopVaultLocked(handler: (reason: string) => void): () => void {
  const listen = getTauriEventListen()
  if (!listen) return () => {}

  let disposed = false
  let unlisten: (() => void) | null = null

  const onEvent = (event: { payload?: { reason?: unknown } }) => {
    if (disposed) return
    const reason = typeof event?.payload?.reason === 'string' && event.payload.reason
      ? event.payload.reason
      : 'native'
    handler(reason)
  }

  try {
    const registration = listen<{ reason?: unknown }>('vault-locked', onEvent)
    Promise.resolve(registration)
      .then((cleanup) => {
        if (typeof cleanup !== 'function') return
        if (disposed) {
          try { cleanup() } catch { /* ignore */ }
          return
        }
        unlisten = cleanup
      })
      .catch(() => {
        // Ignore registration failure outside Tauri runtime
      })
  } catch {
    return () => {}
  }

  return () => {
    disposed = true
    if (unlisten) {
      const cleanup = unlisten
      unlisten = null
      try { cleanup() } catch { /* ignore */ }
    }
  }
}

async function invokeTauriDesktopApi<T>(invoke: TauriInvoke, method: string, args: unknown[]): Promise<ApiResult<T>> {
  try {
    const command = window.__mypwdmgAsyncDesktopUpdateMethods?.includes(method) ? 'desktop_update' : 'desktop_api'
    const res = (method === 'unlock' && window.__mypwdmgAsyncDesktopUnlock
      ? await invoke('desktop_unlock', { args })
      : await invoke(command, { method, args })) as ApiResult<T>
    if (res && typeof res === 'object' && 'ok' in res) return res
    return ok(res as T)
  } catch (err) {
    return fail('DESKTOP_API_ERROR', err instanceof Error ? err.message : String(err))
  }
}

async function call<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const invoke = getTauriInvoke()
  if (invoke) return invokeTauriDesktopApi<T>(invoke, method, args)

  const api = await resolvePyApi()
  if (api?.[method]) return api[method](...args) as Promise<ApiResult<T>>

  const lateInvoke = getTauriInvoke()
  if (lateInvoke) return invokeTauriDesktopApi<T>(lateInvoke, method, args)

  return fail('DESKTOP_API_NOT_READY', '正在等待桌面端本地 API。若长时间停留，请确认桌面应用正常运行。')
}

function pyApi() {
  return typeof window !== 'undefined' ? window.pywebview?.api : undefined
}

async function resolvePyApi() {
  const current = pyApi()
  if (current) return current
  if (typeof window === 'undefined') return undefined

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
        elapsed += BRIDGE_POLL_INTERVAL_MS
        if (pyApi() || getTauriInvoke() || elapsed >= BRIDGE_READY_TIMEOUT_MS) {
          window.clearInterval(pollTimer)
          finish()
        }
      }, BRIDGE_POLL_INTERVAL_MS)
    })
  }

  return pyApiReadyPromise
}
