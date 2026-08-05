import assert from 'node:assert/strict'
import test from 'node:test'

import { SessionGeneration } from '../src/services/sessionGeneration.ts'

test('session generation rejects stale work after lock and re-unlock cycles', () => {
  const generation = new SessionGeneration()
  const firstSession = generation.capture()

  generation.invalidate()
  const secondSession = generation.capture()

  assert.equal(generation.isCurrent(firstSession), false)
  assert.equal(generation.isCurrent(secondSession), true)
  assert.throws(() => generation.requireCurrent(firstSession), /session changed/i)
  assert.doesNotThrow(() => generation.requireCurrent(secondSession))
})
