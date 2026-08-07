import assert from 'node:assert/strict'
import test from 'node:test'

import { filterVaultEntries } from '../src/services/entryWorkspace.ts'

const entries = [
  {
    id: 'folder',
    kind: 'folder',
    title: '工作',
    domains: [],
    children: [
      { id: 'login-a', kind: 'login', title: '控制台', domains: ['example.com'], username: 'alice', note: '生产环境', children: [] },
      { id: 'login-b', kind: 'login', title: '邮箱', domains: ['mail.example.com'], username: 'bob', totpSecret: 'SECRET', children: [] }
    ]
  },
  { id: 'folder-empty', kind: 'folder', title: '空分组', domains: [], children: [] }
]

test('precision filters preserve parent folders for matching descendants', () => {
  const result = filterVaultEntries(entries, '', 'totp')
  assert.deepEqual(result.map((entry) => entry.id), ['folder'])
  assert.deepEqual(result[0].children.map((entry) => entry.id), ['login-b'])
})

test('search includes notes but never password or TOTP secret values', () => {
  assert.equal(filterVaultEntries(entries, '生产环境', 'all')[0].children[0].id, 'login-a')
  assert.deepEqual(filterVaultEntries([{ ...entries[0].children[0], password: 'needle-secret' }], 'needle-secret', 'all'), [])
  assert.deepEqual(filterVaultEntries([entries[0].children[1]], 'SECRET', 'all'), [])
})

test('folder mode returns matching folders without leaking login rows', () => {
  const result = filterVaultEntries(entries, '', 'folder')
  assert.deepEqual(result.map((entry) => entry.id), ['folder', 'folder-empty'])
  assert.deepEqual(result[0].children, [])
})

test('other item filter searches only unprotected custom fields', () => {
  const items = [{
    id: 'card-1',
    kind: 'card',
    title: '差旅卡',
    domains: [],
    customFields: [
      { id: 'label', label: '银行', value: 'Example Bank', type: 'text', protected: false },
      { id: 'number', label: '卡号', value: '4111111111111111', type: 'secret', protected: true }
    ],
    children: []
  }, entries[0].children[0]]

  assert.deepEqual(filterVaultEntries(items, '', 'other').map((entry) => entry.id), ['card-1'])
  assert.equal(filterVaultEntries(items, 'Example Bank', 'other')[0].id, 'card-1')
  assert.deepEqual(filterVaultEntries(items, '4111111111111111', 'other'), [])
})
