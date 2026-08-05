import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPasskeyPresentationItems, displayPasskeyTransports } from '../src/services/passkeyPresentation.ts'

function passkey(overrides = {}) {
  return {
    id: 'passkey-1',
    credentialId: 'AQIDBA',
    rpId: 'login.example.com',
    rpName: 'Example',
    userHandle: 'dXNlci0x',
    userName: 'alice@example.com',
    userDisplayName: 'Alice',
    algorithm: -7,
    publicKeyCose: 'cHVibGljLWtleQ',
    privateKeyPkcs8: 'cHJpdmF0ZS1rZXk',
    discoverable: true,
    backupEligible: true,
    backupState: true,
    transports: ['hybrid', 'internal', 'usb', 'internal'],
    entryId: 'nested-login',
    createdAt: 100,
    updatedAt: 200,
    ...overrides
  }
}

test('projects only safe passkey metadata and resolves nested login links', () => {
  const items = buildPasskeyPresentationItems([passkey()], [{
    id: 'folder-1',
    kind: 'folder',
    title: 'Work',
    domains: [],
    children: [{
      id: 'nested-login',
      kind: 'login',
      title: 'Example login',
      domains: []
    }]
  }])

  assert.deepEqual(items, [{
    id: 'passkey-1',
    rpLabel: 'Example',
    accountLabel: 'Alice',
    linkedEntryTitle: 'Example login',
    transports: ['设备内置', 'USB', '混合设备'],
    createdAt: 100,
    updatedAt: 200
  }])
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'accountLabel',
    'createdAt',
    'id',
    'linkedEntryTitle',
    'rpLabel',
    'transports',
    'updatedAt'
  ])
  assert.doesNotMatch(JSON.stringify(items[0]), /AQIDBA|dXNlci0x|cHVibGlj|cHJpdmF0ZS/)
})

test('uses safe display fallbacks for missing labels and links', () => {
  const [item] = buildPasskeyPresentationItems([
    passkey({ rpName: '', userDisplayName: '', entryId: 'missing-login', transports: [] })
  ], [])

  assert.equal(item.rpLabel, 'login.example.com')
  assert.equal(item.accountLabel, 'alice@example.com')
  assert.equal(item.linkedEntryTitle, null)
  assert.deepEqual(item.transports, [])
})

test('transport labels are deduplicated in a stable safe order', () => {
  assert.deepEqual(
    displayPasskeyTransports(['smart-card', 'ble', 'internal', 'usb', 'ble', 'nfc', 'hybrid']),
    ['设备内置', 'USB', 'NFC', '蓝牙', '混合设备', '智能卡']
  )
})
