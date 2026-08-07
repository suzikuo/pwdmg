export const SESSION_TIMEOUT_DEFAULT_MINUTES = 15
export const SESSION_TIMEOUT_MIN_MINUTES = 0
export const SESSION_TIMEOUT_MAX_MINUTES = 120

export function loadSessionTimeoutMinutes(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return SESSION_TIMEOUT_DEFAULT_MINUTES
  }
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return SESSION_TIMEOUT_DEFAULT_MINUTES
  return Math.min(SESSION_TIMEOUT_MAX_MINUTES, Math.max(SESSION_TIMEOUT_MIN_MINUTES, parsed))
}

export function sessionTimeoutMilliseconds(minutes: unknown) {
  return loadSessionTimeoutMinutes(minutes) * 60 * 1000
}
