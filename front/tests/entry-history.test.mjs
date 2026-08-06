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
const {
  buildEntryHistoryChanges,
  clearEntryHistoryRecords,
  createEntrySnapshot,
  limitEntryHistory,
  restoreEntrySnapshot,
  shouldRecordEntryHistory
} = module.exports

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

test('summarizes only key field changes and ignores domain ordering and position metadata', () => {
  const before = fixture()
  const after = {
    ...fixture(),
    title: 'Renamed',
    domains: ['secondary.example.com', 'example.com'],
    password: 'new-longer-secret',
    note: 'new note',
    statusUpdatedAt: 999,
    deletedAt: 999
  }
  before.domains = ['example.com', 'secondary.example.com']
  const changes = buildEntryHistoryChanges(before, after)

  assert.deepEqual(Array.from(changes, (change) => change.field), ['title', 'password', 'note'])
  assert.deepEqual({ ...changes[0] }, { field: 'title', before: 'Example', after: 'Renamed' })
  assert.equal(changes[1].before, '已设置（10 位）')
  assert.equal(changes[1].after, '已设置（17 位）')
  assert.equal(changes.some((change) => change.before.includes('old-secret')), false)
})

test('caps entry history at the newest ten records', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ id: `history-${index}`, at: 12 - index }))
  const limited = limitEntryHistory(history)
  assert.equal(limited.length, 10)
  assert.equal(limited[0].id, 'history-0')
  assert.equal(limited[9].id, 'history-9')
})

test('does not record creation or no-op edits as modification history', () => {
  assert.equal(shouldRecordEntryHistory('created', 7), false)
  assert.equal(shouldRecordEntryHistory('updated', 0), false)
  assert.equal(shouldRecordEntryHistory('updated', 1), true)
  assert.equal(shouldRecordEntryHistory('disabled', 1), true)
})

test('clears stored history without changing the current entry content', () => {
  const entry = fixture()
  const currentPassword = entry.password
  const removed = clearEntryHistoryRecords(entry)
  assert.equal(removed, 1)
  assert.deepEqual(Array.from(entry.history), [])
  assert.equal(entry.title, 'Example')
  assert.equal(entry.password, currentPassword)
  assert.equal(entry.children.length, 0)
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
