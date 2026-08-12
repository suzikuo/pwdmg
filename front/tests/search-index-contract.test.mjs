import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')

test('search index is rebuilt on vault publication and cleared at lock', () => {
  assert.match(appSource, /vaultSearchIndex\.value = buildVaultSearchIndex\(next\.entries\)/)
  assert.match(appSource, /vaultSearchIndex\.value = null/)
  assert.match(appSource, /:search-index="vaultSearchIndex"/)
})

test('long history and sync log rows use browser-native deferred rendering', () => {
  assert.match(cssSource, /\.detail-history-row[\s\S]*content-visibility: auto/)
  assert.match(cssSource, /\.cloud-sync-log-item[\s\S]*content-visibility: auto/)
  assert.match(cssSource, /contain-intrinsic-size:/)
})
