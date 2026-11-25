import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const pkgSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')

test('application entry has zero Vant imports and loads design tokens + base stylesheet', () => {
  assert.doesNotMatch(mainSource, /\bvant\b/i)
  assert.doesNotMatch(mainSource, /app\.css/)
  assert.match(mainSource, /import '\.\/styles\/tokens\.css'/)
  assert.match(mainSource, /import '\.\/styles\/base\.css'/)
  assert.doesNotMatch(pkgSource, /"vant"\s*:/)
})

test('global toast and confirm feedback uses native UiFeedbackHost instead of Vant', () => {
  assert.match(appSource, /<UiFeedbackHost\s*\/>/)
  assert.match(appSource, /from '\.\/services\/uiFeedback'/)
  assert.doesNotMatch(appSource, /vantFeedback/)
})
