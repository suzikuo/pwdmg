import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/services/entryHistory.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports })
const { createEntrySnapshot, restoreEntrySnapshot } = module.exports

test('entry history snapshots preserve secrets without recursively copying history or children', () => {
  const entry = fixture()
  const snapshot = createEntrySnapshot(entry)
  assert.equal(snapshot.password, 'old-secret')
  assert.equal(snapshot.totpSecret, 'JBSWY3DPEHPK3PXP')
  assert.equal(snapshot.note, 'old note')
  assert.equal('history' in snapshot, false)
  assert.equal('children' in snapshot, false)
})

test('restoring a snapshot preserves identity, history, children, and clears newer optional values', () => {
  const entry = fixture()
  const history = entry.history
  const children = entry.children
  const snapshot = createEntrySnapshot({ ...entry, title: 'Old title', email: undefined })
  entry.title = 'New title'
  entry.email = 'new@example.com'
  entry.password = 'new-secret'
  restoreEntrySnapshot(entry, snapshot)
  assert.equal(entry.id, 'entry-1')
  assert.equal(entry.title, 'Old title')
  assert.equal(entry.email, undefined)
  assert.equal(entry.password, 'old-secret')
  assert.equal(entry.history, history)
  assert.equal(entry.children, children)
})

function fixture() {
  return {
    id: 'entry-1',
    kind: 'login',
    title: 'Example',
    domains: ['example.com'],
    username: 'alice',
    email: 'alice@example.com',
    password: 'old-secret',
    note: 'old note',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    history: [{ id: 'history-1', action: 'created', at: 1, title: 'Example' }],
    children: []
  }
}
