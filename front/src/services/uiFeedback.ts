import { ref } from 'vue'
import type { ConfirmDialogOptions, UiFeedback } from './runtime.ts'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export type ToastInput = {
  message: string
  type?: ToastType
  duration?: number
}

export type ToastItem = {
  id: number
  message: string
  type: ToastType
  duration: number
}

export type UiConfirmOptions = ConfirmDialogOptions & {
  danger?: boolean
}

export type ActiveConfirmState = {
  id: number
  title: string
  message: string
  confirmButtonText: string
  cancelButtonText: string
  danger: boolean
}

type PendingConfirmEntry = {
  state: ActiveConfirmState
  resolve: () => void
  reject: (reason?: unknown) => void
}

const DEFAULT_TOAST_DURATION = 2600
const DEFAULT_ERROR_TOAST_DURATION = 3400
const MAX_VISIBLE_TOASTS = 4

export const toasts = ref<ToastItem[]>([])
export const activeConfirm = ref<ActiveConfirmState | null>(null)

let nextToastId = 1
let nextConfirmId = 1
let currentConfirmEntry: PendingConfirmEntry | null = null
const confirmQueue: PendingConfirmEntry[] = []
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()

function isDangerColor(color?: string): boolean {
  if (!color) return false
  const normalized = color.trim().toLowerCase()
  return (
    normalized === 'red' ||
    normalized === 'var(--danger)' ||
    normalized === '#ee0a24' ||
    normalized === '#dc2626' ||
    normalized === '#ba1a1a' ||
    normalized === '#f87171' ||
    normalized === '#e53935'
  )
}

function unrefTimer(timer: unknown): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    const candidate = (timer as { unref?: unknown }).unref
    if (typeof candidate === 'function') {
      candidate.call(timer)
    }
  }
}

export function dismissToast(id: number): void {
  const timer = toastTimers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    toastTimers.delete(id)
  }
  const index = toasts.value.findIndex((item) => item.id === id)
  if (index !== -1) {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }
}

export function showToast(input: string | ToastInput): number {
  const normalized: ToastInput = typeof input === 'string' ? { message: input } : input
  const message = String(normalized.message ?? '').trim()
  if (!message) return 0

  const type: ToastType = normalized.type ?? 'info'
  const fallbackDuration =
    type === 'error' || type === 'warning' ? DEFAULT_ERROR_TOAST_DURATION : DEFAULT_TOAST_DURATION
  const duration = normalized.duration !== undefined ? normalized.duration : fallbackDuration

  const id = nextToastId++
  const item: ToastItem = { id, message, type, duration }

  const nextList = [...toasts.value, item]
  while (nextList.length > MAX_VISIBLE_TOASTS) {
    const removed = nextList.shift()
    if (removed) {
      const existingTimer = toastTimers.get(removed.id)
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer)
        toastTimers.delete(removed.id)
      }
    }
  }
  toasts.value = nextList

  if (duration > 0) {
    const timer = setTimeout(() => {
      dismissToast(id)
    }, duration)
    unrefTimer(timer)
    toastTimers.set(id, timer)
  }

  return id
}

export function showSuccessToast(message: string, duration?: number): number {
  return showToast({ message, type: 'success', duration })
}

export function showFailToast(message: string, duration?: number): number {
  return showToast({ message, type: 'error', duration })
}

export function showWarningToast(message: string, duration?: number): number {
  return showToast({ message, type: 'warning', duration })
}

function pumpConfirmQueue(): void {
  if (currentConfirmEntry) return
  const next = confirmQueue.shift() ?? null
  currentConfirmEntry = next
  activeConfirm.value = next ? next.state : null
}

export function showConfirmDialog(options: UiConfirmOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const entry: PendingConfirmEntry = {
      state: {
        id: nextConfirmId++,
        title: String(options.title ?? ''),
        message: String(options.message ?? ''),
        confirmButtonText: options.confirmButtonText || '确认',
        cancelButtonText: options.cancelButtonText || '取消',
        danger: Boolean(options.danger) || isDangerColor(options.confirmButtonColor)
      },
      resolve,
      reject
    }
    confirmQueue.push(entry)
    pumpConfirmQueue()
  })
}

export function resolveActiveConfirm(): void {
  const entry = currentConfirmEntry
  if (!entry) return
  currentConfirmEntry = null
  activeConfirm.value = null
  entry.resolve()
  pumpConfirmQueue()
}

export function cancelActiveConfirm(reason: unknown = new Error('cancel')): void {
  const entry = currentConfirmEntry
  if (!entry) return
  currentConfirmEntry = null
  activeConfirm.value = null
  entry.reject(reason)
  pumpConfirmQueue()
}

export function clearAllFeedback(): void {
  for (const timer of toastTimers.values()) {
    clearTimeout(timer)
  }
  toastTimers.clear()
  toasts.value = []

  const pending: PendingConfirmEntry[] = []
  if (currentConfirmEntry) {
    pending.push(currentConfirmEntry)
    currentConfirmEntry = null
  }
  while (confirmQueue.length > 0) {
    const queued = confirmQueue.shift()
    if (queued) pending.push(queued)
  }
  activeConfirm.value = null

  const cancelError = new Error('cancelled')
  for (const entry of pending) {
    entry.reject(cancelError)
  }
}

export const uiFeedback: UiFeedback = {
  toast: (message: string) => {
    showToast(message)
  },
  successToast: (message: string) => {
    showSuccessToast(message)
  },
  failToast: (message: string) => {
    showFailToast(message)
  },
  confirm: async (options: ConfirmDialogOptions) => {
    await showConfirmDialog(options)
  }
}
