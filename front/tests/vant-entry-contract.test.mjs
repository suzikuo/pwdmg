import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

test('application entry registers only the Vant components used by templates', () => {
  assert.doesNotMatch(mainSource, /import Vant from 'vant'/)
  assert.doesNotMatch(mainSource, /vant\/lib\/index\.css/)
  assert.match(mainSource, /const vantComponents = \[/)
  assert.match(mainSource, /for \(const component of vantComponents\) app\.use\(component\)/)
})

test('programmatic Dialog and Toast styles remain explicit', () => {
  assert.match(mainSource, /vant\/es\/dialog\/style/)
  assert.match(mainSource, /vant\/es\/toast\/style/)
})
