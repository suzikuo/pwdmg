export const UI_SCALE_DEFAULT_PERCENT = 92
export const UI_SCALE_MIN_PERCENT = 75
export const UI_SCALE_MAX_PERCENT = 125

export function clampUiScalePercent(value: number) {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT_PERCENT
  return Math.min(Math.max(Math.round(value), UI_SCALE_MIN_PERCENT), UI_SCALE_MAX_PERCENT)
}

export function legacyUiScalePercent(level: number) {
  if (!Number.isFinite(level) || level < 1 || level > 100) return null
  const scale = level <= 50
    ? 0.5 + ((level - 1) / 49) * (0.92 - 0.5)
    : 0.92 + ((level - 50) / 50) * (1.3 - 0.92)
  return clampUiScalePercent(scale * 100)
}

export function loadUiScalePercent(currentValue: string | null, legacyValue: string | null) {
  if (currentValue !== null && currentValue.trim() !== '') {
    const parsed = Number(currentValue)
    if (Number.isFinite(parsed)) return clampUiScalePercent(parsed)
  }

  if (legacyValue !== null && legacyValue.trim() !== '') {
    const migrated = legacyUiScalePercent(Number(legacyValue))
    if (migrated !== null) return migrated
  }

  return UI_SCALE_DEFAULT_PERCENT
}
