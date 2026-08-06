import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'
import {
  applyResolvedPasskeyState,
  canonicalVaultReadCandidates,
  loadPreferredVaultObject,
  mergePasskeyState,
  passkeyStateFingerprint,
  resolvePasskeyState,
  versionedVaultObjectName
} from '../src/services/sync/passkeyRemoteGate.ts'

function v2Payload(id = 'passkey-1') {
  return {
    ...defaultVaultPayload(),
    version: 2,
    passkeys: [{ id }],
    passkeyTombstones: []
  }
}

test('routes canonical v2 state to a sibling object and prefers it on reads', () => {
  assert.equal(versionedVaultObjectName('vault.json', 1), 'vault.json')
  assert.equal(versionedVaultObjectName('vault.json', 2), 'vault.json.passkeys-v2')
  assert.deepEqual(canonicalVaultReadCandidates('vault.json', 'vault.json'), [
    'vault.json.passkeys-v2',
    'vault.json'
  ])
  assert.deepEqual(canonicalVaultReadCandidates('vault.json', 'vault.json.2026-07-31'), [
    'vault.json.2026-07-31'
  ])
})

test('falls back only when the preferred v2 object is absent', async () => {
  const calls = []
  const found = await loadPreferredVaultObject('vault.json', 'vault.json', async (objectName) => {
    calls.push(objectName)
    if (objectName.endsWith('.passkeys-v2')) return { status: 'not-found', content: 'missing' }
    return { status: 'success', content: 'legacy' }
  })
  assert.equal(found.objectName, 'vault.json')
  assert.equal(found.response.content, 'legacy')
  assert.deepEqual(calls, ['vault.json.passkeys-v2', 'vault.json'])

  calls.length = 0
  const failed = await loadPreferredVaultObject('vault.json', 'vault.json', async (objectName) => {
    calls.push(objectName)
    return { status: 'error', content: 'network error' }
  })
  assert.equal(failed.objectName, 'vault.json.passkeys-v2')
  assert.deepEqual(calls, ['vault.json.passkeys-v2'])

  calls.length = 0
  const backup = await loadPreferredVaultObject('vault.json', 'vault.json.backup', async (objectName) => {
    calls.push(objectName)
    return { status: 'success', content: 'backup' }
  })
  assert.equal(backup.objectName, 'vault.json.backup')
  assert.deepEqual(calls, ['vault.json.backup'])
})

test('v2 state wins over a v1 peer while equal v2 state remains unchanged', () => {
  const v1 = defaultVaultPayload()
  const v2 = v2Payload()
  assert.equal(resolvePasskeyState(v2, v1).status, 'local')
  assert.equal(resolvePasskeyState(v1, v2).status, 'remote')
  assert.equal(resolvePasskeyState(v2, structuredCloneValue(v2)).status, 'same')
})

test('different v2 passkey snapshots fail closed', () => {
  assert.equal(resolvePasskeyState(v2Payload('passkey-1'), v2Payload('passkey-2')).status, 'conflict')
})

test('canonical passkey fingerprints ignore collection and transport ordering', () => {
  const left = v2Payload('passkey-1')
  left.passkeys = [credential('passkey-2', 20, ['usb', 'internal']), credential('passkey-1', 10, ['internal'])]
  const right = structuredCloneValue(left)
  right.passkeys.reverse()
  right.passkeys[0].transports.reverse()
  assert.equal(passkeyStateFingerprint(left), passkeyStateFingerprint(right))
})

test('passkey fingerprints bind the explicit sub-schema version', () => {
  const current = v2Payload('passkey-1')
  current.passkeySchemaVersion = 1
  const legacy = structuredCloneValue(current)
  delete legacy.passkeySchemaVersion
  assert.notEqual(passkeyStateFingerprint(current), passkeyStateFingerprint(legacy))
})

test('three-way merge converges independent credential additions', () => {
  const base = { ...defaultVaultPayload(), version: 2, passkeys: [], passkeyTombstones: [] }
  const local = structuredCloneValue(base)
  const remote = structuredCloneValue(base)
  local.passkeys.push(credential('local', 10))
  remote.passkeys.push(credential('remote', 20))

  const merged = mergePasskeyState(base, local, remote)
  assert.equal(merged.status, 'same')
  assert.deepEqual(merged.passkeys.map((item) => item.id), ['local', 'remote'])
  assert.deepEqual(merged.conflicts, [])
})

test('three-way merge combines independent field edits on one credential', () => {
  const base = { ...defaultVaultPayload(), version: 2, passkeys: [credential('shared', 10)], passkeyTombstones: [] }
  const local = structuredCloneValue(base)
  const remote = structuredCloneValue(base)
  local.passkeys[0].rpName = 'Local RP name'
  local.passkeys[0].updatedAt = 20
  remote.passkeys[0].userDisplayName = 'Remote user name'
  remote.passkeys[0].updatedAt = 30

  const merged = mergePasskeyState(base, local, remote)
  assert.deepEqual(merged.conflicts, [])
  assert.equal(merged.passkeys[0].rpName, 'Local RP name')
  assert.equal(merged.passkeys[0].userDisplayName, 'Remote user name')
  assert.equal(merged.passkeys[0].updatedAt, 30)
})

test('three-way merge reports a true same-field conflict', () => {
  const base = { ...defaultVaultPayload(), version: 2, passkeys: [credential('shared', 10)], passkeyTombstones: [] }
  const local = structuredCloneValue(base)
  const remote = structuredCloneValue(base)
  local.passkeys[0].userName = 'alice-local'
  remote.passkeys[0].userName = 'alice-remote'

  const merged = mergePasskeyState(base, local, remote)
  assert.equal(merged.status, 'conflict')
  assert.deepEqual(merged.conflicts, [{ id: 'shared', field: 'userName', reason: 'concurrent-update' }])
})

test('a tombstone newer than the competing update wins deterministically', () => {
  const item = credential('shared', 10)
  const base = { ...defaultVaultPayload(), version: 2, passkeys: [item], passkeyTombstones: [] }
  const local = { ...structuredCloneValue(base), passkeys: [], passkeyTombstones: [{ id: item.id, credentialId: item.credentialId, deletedAt: 40 }] }
  const remote = structuredCloneValue(base)
  remote.passkeys[0].userName = 'updated'
  remote.passkeys[0].updatedAt = 30

  const merged = mergePasskeyState(base, local, remote)
  assert.deepEqual(merged.conflicts, [])
  assert.equal(merged.passkeys.length, 0)
  assert.equal(merged.passkeyTombstones[0].deletedAt, 40)
})

test('resolved passkey state is applied atomically without sharing arrays', () => {
  const local = defaultVaultPayload()
  const remote = v2Payload()
  const resolution = resolvePasskeyState(local, remote)
  applyResolvedPasskeyState(local, resolution)
  assert.equal(local.version, 2)
  assert.deepEqual(local.passkeys, remote.passkeys)
  assert.notEqual(local.passkeys, remote.passkeys)
})

test('merging legacy vaults without passkey state does not promote the schema', () => {
  const merged = mergePasskeyState(
    defaultVaultPayload(),
    defaultVaultPayload(),
    defaultVaultPayload()
  )

  assert.equal(merged.version, 1)
  assert.deepEqual(merged.passkeys, [])
  assert.deepEqual(merged.passkeyTombstones, [])
})

function structuredCloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function credential(id, updatedAt, transports = ['internal']) {
  return {
    id,
    credentialId: Buffer.from(`credential-${id}`).toString('base64url'),
    rpId: 'example.com',
    rpName: 'Example',
    userHandle: Buffer.from(`user-${id}`).toString('base64url'),
    userName: `${id}@example.com`,
    userDisplayName: id,
    algorithm: -7,
    publicKeyCose: 'AQ',
    privateKeyPkcs8: 'Ag',
    discoverable: true,
    backupEligible: true,
    backupState: true,
    transports,
    createdAt: 10,
    updatedAt
  }
}
