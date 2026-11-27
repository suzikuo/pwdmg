export const MOBILE_SWIPE_LEFT_EDGE_EXCLUSION_PX = 24
export const MOBILE_SWIPE_OPEN_THRESHOLD_PX = 56
export const MOBILE_SWIPE_CLOSE_THRESHOLD_PX = 56
export const MOBILE_SWIPE_HORIZONTAL_RATIO = 1.6
export const MOBILE_SWIPE_LOCK_MIN_PX = 14

export type MobileDrawerSwipeEvaluation = {
  status: 'pending' | 'active' | 'cancelled'
  progress: number
  ready: boolean
}

export function canStartMobileDrawerSwipe(startX: number, drawerOpen: boolean): boolean {
  if (!Number.isFinite(startX) || startX < 0) return false
  if (drawerOpen) return true
  return startX >= MOBILE_SWIPE_LEFT_EDGE_EXCLUSION_PX
}

export function evaluateMobileDrawerSwipeMove(
  dx: number,
  dy: number,
  drawerOpen: boolean
): MobileDrawerSwipeEvaluation {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const directionalDelta = drawerOpen ? -dx : dx
  const threshold = drawerOpen ? MOBILE_SWIPE_CLOSE_THRESHOLD_PX : MOBILE_SWIPE_OPEN_THRESHOLD_PX

  if (directionalDelta < -10) {
    return { status: 'cancelled', progress: 0, ready: false }
  }
  if (absY >= MOBILE_SWIPE_LOCK_MIN_PX && absX < absY * MOBILE_SWIPE_HORIZONTAL_RATIO) {
    return { status: 'cancelled', progress: 0, ready: false }
  }
  if (directionalDelta >= MOBILE_SWIPE_LOCK_MIN_PX && directionalDelta >= absY * MOBILE_SWIPE_HORIZONTAL_RATIO) {
    const progress = Math.min(1, directionalDelta / threshold)
    return {
      status: 'active',
      progress,
      ready: directionalDelta >= threshold
    }
  }
  return { status: 'pending', progress: 0, ready: false }
}
