import { callDesktopApi } from './desktopStorageAdapter.ts'
import { sha256Hex } from './shared/encoding.ts'

export const SENSITIVE_CLIPBOARD_TTL_MS = 30_000

type ClipboardPort = Pick<Clipboard, 'writeText'> & Partial<Pick<Clipboard, 'readText'>>
type Schedule = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
type Cancel = (timer: ReturnType<typeof setTimeout>) => void

export type NativeClipboardPort = {
  copySensitiveText: (value: string, clearAfterSeconds?: number) => Promise<{ ok: boolean }>
  clearSensitiveClipboard: () => Promise<{ ok: boolean }>
}

type PendingClear = {
  digest: string
  clipboard: ClipboardPort
  cancel: Cancel
  timer: ReturnType<typeof setTimeout> | null
}

let pendingClear: PendingClear | null = null
let activeNativeBridge: NativeClipboardPort | null = null
let clipboardWriteVersion = 0

function isDesktopClipboardRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.core?.invoke
  )
}

const desktopNativeClipboardBridge: NativeClipboardPort = {
  copySensitiveText: (value, clearAfterSeconds) =>
    callDesktopApi<{ copied: boolean; clearAfterSeconds: number }>(
      'copySensitiveText',
      value,
      clearAfterSeconds
    ),
  clearSensitiveClipboard: () =>
    callDesktopApi<{ cleared: boolean }>('clearSensitiveClipboard')
}

function cancelPendingBrowserClear() {
  const previous = pendingClear
  pendingClear = null
  if (previous?.timer !== null && previous?.timer !== undefined) {
    previous.cancel(previous.timer)
  }
}

export async function copySensitiveText(
  value: string,
  clipboard?: ClipboardPort,
  schedule: Schedule = setTimeout,
  cancel: Cancel = clearTimeout,
  nativeBridge?: NativeClipboardPort | null
): Promise<void> {
  const effectiveNativeBridge = nativeBridge !== undefined
    ? nativeBridge
    : (clipboard === undefined && isDesktopClipboardRuntime() ? desktopNativeClipboardBridge : null)

  if (effectiveNativeBridge) {
    const version = ++clipboardWriteVersion
    const ttlSeconds = Math.max(1, Math.ceil(SENSITIVE_CLIPBOARD_TTL_MS / 1000))
    try {
      const result = await effectiveNativeBridge.copySensitiveText(value, ttlSeconds)
      if (result?.ok) {
        if (version !== clipboardWriteVersion) return
        cancelPendingBrowserClear()
        activeNativeBridge = effectiveNativeBridge
        return
      }
    } catch {
      // Fall back to Web Clipboard API if native clipboard is unavailable.
    }
  }

  const targetClipboard = clipboard ?? globalThis.navigator?.clipboard
  if (!targetClipboard) throw new Error('当前环境不支持剪贴板')
  const digest = await sha256Hex(value)
  const version = ++clipboardWriteVersion
  await targetClipboard.writeText(value)
  if (version !== clipboardWriteVersion) return
  cancelPendingBrowserClear()
  activeNativeBridge = null
  const scheduled: PendingClear = { digest, clipboard: targetClipboard, cancel, timer: null }
  pendingClear = scheduled
  scheduled.timer = schedule(() => {
    if (pendingClear !== scheduled) return
    pendingClear = null
    return clearIfUnchanged(scheduled).catch(() => {})
  }, SENSITIVE_CLIPBOARD_TTL_MS)
}

export async function clearSensitiveClipboard(
  nativeBridge?: NativeClipboardPort | null
): Promise<void> {
  const scheduled = pendingClear
  pendingClear = null
  if (scheduled) {
    if (scheduled.timer !== null) scheduled.cancel(scheduled.timer)
    await clearIfUnchanged(scheduled)
  }

  const bridgeToClear = nativeBridge !== undefined
    ? nativeBridge
    : (activeNativeBridge ?? (isDesktopClipboardRuntime() ? desktopNativeClipboardBridge : null))
  activeNativeBridge = null
  if (bridgeToClear) {
    await bridgeToClear.clearSensitiveClipboard().catch(() => {})
  }
}

async function clearIfUnchanged({ digest, clipboard }: PendingClear): Promise<void> {
  if (!clipboard.readText) return
  const version = clipboardWriteVersion
  const currentDigest = await sha256Hex(await clipboard.readText())
  if (currentDigest === digest && version === clipboardWriteVersion) await clipboard.writeText('')
}
