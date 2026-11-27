export const AUTO_SYNC_POSTPONE_UNTIL_KEY = 'mypwdmg.autoSyncPostponedUntil.v1'
export const AUTO_SYNC_POSTPONE_PRESET_MINUTES = [5, 15, 30, 60] as const
export const AUTO_SYNC_POSTPONE_DEFAULT_MINUTES = 15
export const AUTO_SYNC_POSTPONE_MIN_MINUTES = 1
export const AUTO_SYNC_POSTPONE_MAX_MINUTES = 1440

export function normalizeAutoSyncPostponeMinutes(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return AUTO_SYNC_POSTPONE_DEFAULT_MINUTES
  return Math.min(
    Math.max(Math.round(numeric), AUTO_SYNC_POSTPONE_MIN_MINUTES),
    AUTO_SYNC_POSTPONE_MAX_MINUTES
  )
}

export function normalizeAutoSyncPostponedUntil(value: unknown, now = Date.now()): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= now) return 0
  return Math.round(numeric)
}

export function isAutoSyncPostponedAt(until: number, now = Date.now()): boolean {
  return Number.isFinite(until) && until > now
}

export function remainingAutoSyncPostponeMs(until: number, now = Date.now()): number {
  if (!isAutoSyncPostponedAt(until, now)) return 0
  return Math.max(0, until - now)
}

export function formatAutoSyncPostponePresetLabel(minutes: number): string {
  const normalized = normalizeAutoSyncPostponeMinutes(minutes)
  if (normalized % 60 === 0) {
    return `${normalized / 60} 小时`
  }
  return `${normalized} 分钟`
}

export function formatAutoSyncPostponeTime(until: number, now = Date.now()): string {
  if (!Number.isFinite(until) || until <= 0) return ''
  const target = new Date(until)
  if (Number.isNaN(target.getTime())) return ''
  const hh = String(target.getHours()).padStart(2, '0')
  const mm = String(target.getMinutes()).padStart(2, '0')
  const current = new Date(now)
  const sameDay = (
    target.getFullYear() === current.getFullYear() &&
    target.getMonth() === current.getMonth() &&
    target.getDate() === current.getDate()
  )
  if (sameDay) return `${hh}:${mm}`
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${month}-${day} ${hh}:${mm}`
}
