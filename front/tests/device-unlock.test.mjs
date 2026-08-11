import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { importVaultKeyMaterial } from '../src/services/vaultCrypto.ts'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/components/auth/AuthScreen.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../main.py', import.meta.url), 'utf8')

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

test('quick unlock remains desktop-only and validates the current envelope', () => {
  assert.match(apiSource, /if \(!useDesktopStorage\(\)\) return fail\('DESKTOP_ONLY'/)
  assert.match(apiSource, /readDeviceUnlockKey/)
  assert.match(apiSource, /decryptPayloadWithKey\(importedKey, envelope\)/)
  assert.doesNotMatch(apiSource.slice(apiSource.indexOf('async function quickUnlock'), apiSource.indexOf('async function openExternalUrl')), /localStorage/)
})

test('settings and lock screen expose explicit device unlock controls', () => {
  assert.match(authSource, /deviceUnlockEnabled/)
  assert.match(authSource, /emit\('quick-unlock'\)/)
  assert.match(settingsSource, /title="设备快速解锁"/)
  assert.match(settingsSource, /toggle-device-unlock/)
  assert.match(appSource, /当前主密码/)
  assert.match(appSource, /await refreshDeviceUnlockState\(\)/)
})

test('desktop bridge exposes only bounded quick-unlock commands', () => {
  assert.match(mainSource, /def getDeviceUnlockState\(/)
  assert.match(mainSource, /def enableDeviceUnlock\(self, password: str, reauthSeconds: int\)/)
  assert.match(mainSource, /def disableDeviceUnlock\(/)
  assert.match(mainSource, /def readDeviceUnlockKey\(/)
})
