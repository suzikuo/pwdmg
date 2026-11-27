import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  MOBILE_SWIPE_LEFT_EDGE_EXCLUSION_PX,
  MOBILE_SWIPE_OPEN_THRESHOLD_PX,
  canStartMobileDrawerSwipe,
  evaluateMobileDrawerSwipeMove
} from '../src/services/mobileDrawerSwipe.ts'

test('mobile drawer swipe avoids Android left-edge back zone when opening', () => {
  assert.equal(canStartMobileDrawerSwipe(0, false), false)
  assert.equal(canStartMobileDrawerSwipe(MOBILE_SWIPE_LEFT_EDGE_EXCLUSION_PX - 1, false), false)
  assert.equal(canStartMobileDrawerSwipe(MOBILE_SWIPE_LEFT_EDGE_EXCLUSION_PX, false), true)
  assert.equal(canStartMobileDrawerSwipe(180, false), true)
  assert.equal(canStartMobileDrawerSwipe(0, true), true)
})

test('mobile drawer swipe tracks horizontal progress and cancels vertical scrolling', () => {
  const pending = evaluateMobileDrawerSwipeMove(8, 2, false)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.ready, false)

  const active = evaluateMobileDrawerSwipeMove(30, 5, false)
  assert.equal(active.status, 'active')
  assert.equal(active.ready, false)
  assert.ok(active.progress > 0 && active.progress < 1)

  const ready = evaluateMobileDrawerSwipeMove(MOBILE_SWIPE_OPEN_THRESHOLD_PX, 8, false)
  assert.equal(ready.status, 'active')
  assert.equal(ready.ready, true)
  assert.equal(ready.progress, 1)

  const verticalScroll = evaluateMobileDrawerSwipeMove(12, 30, false)
  assert.equal(verticalScroll.status, 'cancelled')

  const wrongDirection = evaluateMobileDrawerSwipeMove(-15, 0, false)
  assert.equal(wrongDirection.status, 'cancelled')

  const closeReady = evaluateMobileDrawerSwipeMove(-MOBILE_SWIPE_OPEN_THRESHOLD_PX, 6, true)
  assert.equal(closeReady.status, 'active')
  assert.equal(closeReady.ready, true)
})

test('App.vue wires mobile swipe gesture listeners and visual swipe indicator', () => {
  const appSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/App.vue'),
    'utf8'
  )
  assert.match(appSrc, /mobile-swipe-indicator/)
  assert.match(appSrc, /松手打开菜单/)
  assert.match(appSrc, /window\.addEventListener\('touchstart', handleMobileTouchStart/)
  assert.match(appSrc, /window\.addEventListener\('touchmove', handleMobileTouchMove/)
  assert.match(appSrc, /window\.addEventListener\('touchend', handleMobileTouchEnd/)
})
