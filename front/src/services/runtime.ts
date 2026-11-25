import type { ApiResult } from '../types.ts'

export type ConfirmDialogOptions = {
  title: string
  message: string
  confirmButtonText?: string
  confirmButtonColor?: string
  cancelButtonText?: string
  danger?: boolean
  className?: string
  overlayStyle?: Record<string, string | number>
}

export type UiFeedback = {
  toast: (message: string) => void
  successToast: (message: string) => void
  failToast: (message: string) => void
  confirm: (options: ConfirmDialogOptions) => Promise<void>
}

export const noopUiFeedback: UiFeedback = {
  toast: () => {},
  successToast: () => {},
  failToast: () => {},
  confirm: async () => {}
}

export async function confirmTwiceWithFeedback(
  feedback: UiFeedback,
  options: {
    title: string
    message: string
    secondTitle: string
    secondMessage: string
    confirmButtonText: string
  }
): Promise<void> {
  await feedback.confirm({
    title: options.title,
    message: options.message,
    confirmButtonText: '继续',
    confirmButtonColor: '#ee0a24'
  })
  await feedback.confirm({
    title: options.secondTitle,
    message: options.secondMessage,
    confirmButtonText: options.confirmButtonText,
    confirmButtonColor: '#ee0a24'
  })
}

function readStaticEnv(getter: () => unknown): string {
  try {
    return String(getter() ?? '')
  } catch {
    return ''
  }
}

export const packagedAppVersion = readStaticEnv(() => import.meta.env.PACKAGE_VERSION).trim()
export const frontendBuildId = readStaticEnv(() => import.meta.env.FRONTEND_BUILD_ID).trim() || 'dev'
export const runtimeMode = (
  readStaticEnv(() => import.meta.env.VITE_STORAGE_MODE) ||
  readStaticEnv(() => import.meta.env.VITE_API_MODE) ||
  readStaticEnv(() => import.meta.env.MODE) ||
  ''
).toLowerCase()

export const isDesktopRuntime = ['desktop', 'pywebview', 'native'].includes(runtimeMode)
export const isAndroidRuntime = runtimeMode === 'android'
export const isExternalNativeRuntime = isDesktopRuntime || isAndroidRuntime

export function formatBytes(value: number): string {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
}

export function formatDateTime(value: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatUnixTime(value: number): string {
  const seconds = Number(value) || 0
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleString()
}

export async function androidBridgeCall<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const nativeApi = typeof window !== 'undefined' ? window.androidPasswordApi : undefined
  if (!nativeApi?.[method]) {
    return { ok: false, code: 'ANDROID_API_NOT_READY', message: 'Android 本地 API 未就绪。' }
  }
  try {
    return JSON.parse(String(nativeApi[method](...args))) as ApiResult<T>
  } catch (error) {
    return {
      ok: false,
      code: 'ANDROID_API_ERROR',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

export function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    // Ignore storage write errors in restricted environments.
  }
}

export function removeLocalStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  } catch {
    // Ignore storage removal errors in restricted environments.
  }
}

export function blurActiveElement(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement as HTMLElement | null
  active?.blur?.()
}
