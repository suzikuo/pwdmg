import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/services/passkeyManagement.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, TextEncoder })
const { removePasskeyWithTombstone, updatePasskeyMetadata } = module.exports

test('updates only bounded display metadata and preserves credential identity', () => {
  const original = credential('one')
  original.createdAt = 100
  original.updatedAt = 101
  original.rpId = 'example.com'
  original.privateKeyPkcs8 = 'private-key'
  const payload = { version: 2, passkeySchemaVersion: 1, passkeys: [original], passkeyTombstones: [] }

  assert.equal(updatePasskeyMetadata(payload, 'one', {
    label: '  Work account  ',
    entryId: 'login-1'
  }, 200, new Set(['login-1'])), true)
  assert.equal(original.label, 'Work account')
  assert.equal(original.entryId, 'login-1')
  assert.equal(original.updatedAt, 200)
  assert.equal(original.credentialId, 'credential-one')
  assert.equal(original.rpId, 'example.com')
  assert.equal(original.privateKeyPkcs8, 'private-key')
})

test('metadata updates reject invalid links and clear optional values explicitly', () => {
  const item = { ...credential('one'), label: 'Old', entryId: 'login-1', createdAt: 100, updatedAt: 101 }
  const payload = { version: 2, passkeySchemaVersion: 1, passkeys: [item], passkeyTombstones: [] }
  assert.throws(() => updatePasskeyMetadata(payload, 'one', { label: '', entryId: 'missing' }, 200, new Set()), /关联登录项/)
  assert.equal(updatePasskeyMetadata(payload, 'one', { label: '', entryId: '' }, 200, new Set()), true)
  assert.equal('label' in item, false)
  assert.equal('entryId' in item, false)
  assert.equal(updatePasskeyMetadata(payload, 'missing', { label: '', entryId: '' }, 200), false)
})

test('removes one live credential and appends its stable tombstone atomically', () => {
  const payload = { version: 2, passkeySchemaVersion: 1, passkeys: [credential('one'), credential('two')], passkeyTombstones: [] }
  assert.equal(removePasskeyWithTombstone(payload, 'one', 123), true)
  assert.deepEqual(payload.passkeys.map((item) => item.id), ['two'])
  assert.deepEqual(JSON.parse(JSON.stringify(payload.passkeyTombstones)), [{
    id: 'one', credentialId: 'credential-one', deletedAt: 123
  }])
})

test('missing credentials are a no-op and tombstone identity collisions fail closed', () => {
  const payload = { version: 2, passkeySchemaVersion: 1, passkeys: [credential('one')], passkeyTombstones: [] }
  assert.equal(removePasskeyWithTombstone(payload, 'missing', 123), false)
  payload.passkeyTombstones.push({ id: 'old', credentialId: 'credential-one', deletedAt: 100 })
  assert.throws(() => removePasskeyWithTombstone(payload, 'one', 123), /墓碑冲突/)
})

function credential(id) {
  return { id, credentialId: `credential-${id}` }
}
