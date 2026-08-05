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
vm.runInNewContext(compiled, { module, exports: module.exports })
const { removePasskeyWithTombstone } = module.exports

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
