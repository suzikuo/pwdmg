import assert from 'node:assert/strict'
import test from 'node:test'

import {
  UI_SCALE_DEFAULT_PERCENT,
  loadUiScalePercent
} from '../src/services/uiScale.ts'

test('current UI scale is authoritative and clamped to the supported range', () => {
  assert.equal(loadUiScalePercent('108', '50'), 108)
  assert.equal(loadUiScalePercent('20', null), 75)
  assert.equal(loadUiScalePercent('180', null), 125)
})

test('legacy nonlinear levels migrate to their equivalent visual percentage', () => {
  assert.equal(loadUiScalePercent(null, '1'), 75)
  assert.equal(loadUiScalePercent(null, '50'), 92)
  assert.equal(loadUiScalePercent(null, '100'), 125)
})

test('invalid UI scale values use the stable default', () => {
  assert.equal(loadUiScalePercent('', ''), UI_SCALE_DEFAULT_PERCENT)
  assert.equal(loadUiScalePercent('invalid', 'invalid'), UI_SCALE_DEFAULT_PERCENT)
})
