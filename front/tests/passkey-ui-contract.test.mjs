import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(new URL('../src/components/tools/PasskeyManager.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/DetailContent.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('passkey manager receives only the safe presentation projection', () => {
  assert.match(managerSource, /PasskeyPresentationItem\[\]/)
  assert.doesNotMatch(managerSource, /credentialId|userHandle|publicKeyCose|privateKeyPkcs8/)
  assert.match(managerSource, /emit\('save'/)
  assert.match(managerSource, /emit\('delete'/)
})

test('settings and login details expose passkey management entry points', () => {
  assert.match(settingsSource, /title="通行密钥"/)
  assert.match(settingsSource, /emit\('open-passkeys'\)/)
  assert.match(detailSource, /linkedPasskeys\.length/)
  assert.match(detailSource, /\$emit\('unlink-passkey'/)
  assert.match(detailSource, /\$emit\('open-passkey'/)
})

test('app keeps metadata updates constrained and deletion tombstone-backed', () => {
  assert.match(appSource, /updatePasskeyMetadata\(/)
  assert.match(appSource, /api\.deletePasskey\(passkeyId\)/)
  assert.match(appSource, /scheduleAutoCloudUpload\(\)/)
  assert.doesNotMatch(managerSource, /VaultPasskey\[\]/)
})

test('passkey management closes at the vault lock boundary', () => {
  const start = appSource.indexOf('function applyLockedUiState()')
  const lockBoundary = appSource.slice(start, start + 3000)
  assert.match(lockBoundary, /passkeyManagerOpen\.value = false/)
  assert.match(lockBoundary, /passkeyManagerInitialId\.value = ''/)
})
