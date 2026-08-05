export const SENSITIVE_CLIPBOARD_TTL_MS = 30_000

type ClipboardPort = Pick<Clipboard, 'writeText'> & Partial<Pick<Clipboard, 'readText'>>
type Schedule = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
type Cancel = (timer: ReturnType<typeof setTimeout>) => void

type PendingClear = {
  value: string
  clipboard: ClipboardPort
  cancel: Cancel
  timer: ReturnType<typeof setTimeout> | null
}

let pendingClear: PendingClear | null = null

export async function copySensitiveText(
  value: string,
  clipboard: ClipboardPort | undefined = globalThis.navigator?.clipboard,
  schedule: Schedule = setTimeout,
  cancel: Cancel = clearTimeout
): Promise<void> {
  if (!clipboard) throw new Error('当前环境不支持剪贴板')
  await clipboard.writeText(value)
  const previous = pendingClear
  if (previous?.timer !== null && previous?.timer !== undefined) previous.cancel(previous.timer)
  const scheduled: PendingClear = { value, clipboard, cancel, timer: null }
  pendingClear = scheduled
  scheduled.timer = schedule(() => {
    if (pendingClear !== scheduled) return
    pendingClear = null
    clearIfUnchanged(value, clipboard).catch(() => {})
  }, SENSITIVE_CLIPBOARD_TTL_MS)
}

export async function clearSensitiveClipboard(): Promise<void> {
  const scheduled = pendingClear
  if (!scheduled) return
  pendingClear = null
  if (scheduled.timer !== null) scheduled.cancel(scheduled.timer)
  await clearIfUnchanged(scheduled.value, scheduled.clipboard)
}

async function clearIfUnchanged(value: string, clipboard: ClipboardPort): Promise<void> {
  if (!clipboard.readText) return
  const current = await clipboard.readText()
  if (current === value) await clipboard.writeText('')
}
