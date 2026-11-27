export const MOBILE_FAB_POSITION_KEY = 'mypwdmg.mobileFabPosition.v1'
export const MOBILE_FAB_SIZE_PX = 50
export const MOBILE_FAB_MARGIN_PX = 14
export const MOBILE_FAB_DRAG_THRESHOLD_PX = 6

export type MobileFabPosition = {
  x: number
  y: number
}

export type MobileFabFanOffsets = {
  vertical: { x: number; y: number }
  diagonal: { x: number; y: number }
  horizontal: { x: number; y: number }
}

export function defaultMobileFabPosition(viewportWidth: number, viewportHeight: number, topInset = 0): MobileFabPosition {
  return clampMobileFabPosition(
    {
      x: viewportWidth - MOBILE_FAB_SIZE_PX - 18,
      y: viewportHeight - MOBILE_FAB_SIZE_PX - 22
    },
    viewportWidth,
    viewportHeight,
    topInset
  )
}

export function clampMobileFabPosition(
  position: MobileFabPosition,
  viewportWidth: number,
  viewportHeight: number,
  topInset = 0
): MobileFabPosition {
  const minX = MOBILE_FAB_MARGIN_PX
  const maxX = Math.max(minX, viewportWidth - MOBILE_FAB_SIZE_PX - MOBILE_FAB_MARGIN_PX)
  const minY = Math.max(MOBILE_FAB_MARGIN_PX, topInset + MOBILE_FAB_MARGIN_PX)
  const maxY = Math.max(minY, viewportHeight - MOBILE_FAB_SIZE_PX - MOBILE_FAB_MARGIN_PX)
  const x = Number.isFinite(position.x) ? position.x : maxX
  const y = Number.isFinite(position.y) ? position.y : maxY
  return {
    x: Math.round(Math.min(Math.max(x, minX), maxX)),
    y: Math.round(Math.min(Math.max(y, minY), maxY))
  }
}

export function parseStoredMobileFabPosition(raw: string | null): MobileFabPosition | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MobileFabPosition>
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

export function resolveMobileFabFanOffsets(
  position: MobileFabPosition,
  viewportWidth: number,
  viewportHeight: number,
  topInset = 0
): MobileFabFanOffsets {
  const centerX = position.x + MOBILE_FAB_SIZE_PX / 2
  const centerY = position.y + MOBILE_FAB_SIZE_PX / 2
  const expandRight = centerX < viewportWidth / 2
  const expandDown = centerY - topInset < Math.min(180, viewportHeight * 0.28)
  const dirX = expandRight ? 1 : -1
  const dirY = expandDown ? 1 : -1
  return {
    vertical: { x: 0, y: dirY * 68 },
    diagonal: { x: dirX * 54, y: dirY * 52 },
    horizontal: { x: dirX * 70, y: 0 }
  }
}
