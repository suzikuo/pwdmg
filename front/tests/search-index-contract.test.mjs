import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const vaultStoreSource = readFileSync(new URL('../src/stores/vaultStore.ts', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/DetailContent.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')

test('search index is rebuilt on vault publication and cleared at lock', () => {
  assert.match(vaultStoreSource, /vaultSearchIndex\.value = buildVaultSearchIndex\(next\.entries\)/)
  assert.match(vaultStoreSource, /vaultSearchIndex\.value = null/)
  assert.match(appSource, /:search-index="vaultSearchIndex"/)
})

test('long history and sync log rows use browser-native deferred rendering', () => {
  assert.match(detailSource, /\.history-item[\s\S]*content-visibility:\s*auto/)
  assert.match(detailSource, /contain-intrinsic-size:/)
  assert.match(settingsSource, /\.cloud-sync-log-item[\s\S]*content-visibility:\s*auto/)
  assert.match(settingsSource, /contain-intrinsic-size:/)
})
