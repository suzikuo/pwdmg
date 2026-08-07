import assert from 'node:assert/strict'
import test from 'node:test'

import { useVaultSession } from '../src/composables/useVaultSession.ts'
import {
  SESSION_TIMEOUT_DEFAULT_MINUTES,
  loadSessionTimeoutMinutes,
  sessionTimeoutMilliseconds
} from '../src/services/sessionTimeout.ts'

test('auto-lock timeout uses a safe default and clamps device preferences', () => {
  assert.equal(loadSessionTimeoutMinutes(''), SESSION_TIMEOUT_DEFAULT_MINUTES)
  assert.equal(loadSessionTimeoutMinutes('0'), 0)
  assert.equal(loadSessionTimeoutMinutes('45'), 45)
  assert.equal(loadSessionTimeoutMinutes('999'), 120)
  assert.equal(sessionTimeoutMilliseconds(0), 0)
  assert.equal(sessionTimeoutMilliseconds(2), 120_000)
})

test('rescheduling a live session reads the latest dynamic timeout once', () => {
  const originalWindow = globalThis.window
  const scheduled = []
  const cancelled = []
  let nextTimer = 0
  let timeout = 100
  globalThis.window = {
    setTimeout(callback, delay) {
      nextTimer += 1
      scheduled.push({ callback, delay, timer: nextTimer })
      return nextTimer
    },
    clearTimeout(timer) {
      cancelled.push(timer)
    }
  }

  try {
    const session = useVaultSession(() => {}, () => timeout)
    session.schedule(true)
    timeout = 0
    session.schedule(true)
    timeout = 250
    session.schedule(true)
    assert.deepEqual(scheduled.map((item) => item.delay), [100, 250])
    assert.deepEqual(cancelled, [1])
  } finally {
    globalThis.window = originalWindow
  }
})
