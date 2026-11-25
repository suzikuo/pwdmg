import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { importVaultKeyMaterial } from '../src/services/vaultCrypto.ts'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const sessionStoreSource = readFileSync(new URL('../src/stores/sessionStore.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/components/auth/AuthScreen.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../../src-tauri/src/bridge.rs', import.meta.url), 'utf8')

test('imports device material as a non-extractable bounded AES key', async () => {
  const material = await importVaultKeyMaterial(
    Buffer.alloc(32, 7).toString('base64'),
    Buffer.alloc(16, 9).toString('base64'),
    390_000
  )
  assert.equal(material.key.type, 'secret')
  assert.equal(material.key.extractable, false)
  assert.deepEqual([...material.salt], [...Buffer.alloc(16, 9)])
  await assert.rejects(() => importVaultKeyMaterial('AQID', Buffer.alloc(16).toString('base64'), 390_000))
  await assert.rejects(() => importVaultKeyMaterial(Buffer.alloc(32).toString('base64'), Buffer.alloc(16).toString('base64'), 1))
})

test('quick unlock delegates directly to native quickUnlock without reading raw key material or localStorage', () => {
  const quickUnlockBlock = apiSource.slice(
    apiSource.indexOf('async function quickUnlock'),
    apiSource.indexOf('async function openExternalUrl')
  )
  const desktopQuickUnlockBlock = apiSource.slice(
    apiSource.indexOf('async function desktopQuickUnlock'),
    apiSource.indexOf('async function desktopGetVault')
  )
  assert.match(quickUnlockBlock, /if \(useDesktopNativeApi\(\)\)/)
  assert.match(quickUnlockBlock, /return desktopQuickUnlock\(\)/)
  assert.match(quickUnlockBlock, /return fail\('UNSUPPORTED_PLATFORM'/)
  assert.match(desktopQuickUnlockBlock, /callDesktopVaultApi<DesktopPayloadResult>\('quickUnlock'\)/)
  assert.doesNotMatch(apiSource, /readDeviceUnlockKey/)
  assert.doesNotMatch(quickUnlockBlock, /localStorage/)
  assert.doesNotMatch(desktopQuickUnlockBlock, /localStorage/)
})

test('settings and lock screen expose explicit device unlock controls', () => {
  assert.match(authSource, /deviceUnlockEnabled/)
  assert.match(authSource, /emit\('quick-unlock'\)/)
  assert.match(settingsSource, /<strong>设备快速解锁<\/strong>/)
  assert.match(settingsSource, /session\.toggleDeviceUnlock\(\$event\)/)
  assert.match(appSource, /当前主密码/)
  assert.match(sessionStoreSource, /await refreshDeviceUnlockState\(\)/)
})

test('desktop bridge exposes native quickUnlock without exporting raw device key bytes', () => {
  assert.match(bridgeSource, /"quickUnlock"/)
  assert.match(bridgeSource, /"getDeviceUnlockState"/)
  assert.match(bridgeSource, /"enableDeviceUnlock"/)
  assert.match(bridgeSource, /"disableDeviceUnlock"/)
  assert.doesNotMatch(bridgeSource, /"readDeviceUnlockKey"/)
})
