import assert from 'node:assert/strict'
import test from 'node:test'

import { filterVaultEntries } from '../src/services/entryWorkspace.ts'
import { buildVaultSearchIndex } from '../src/services/searchIndex.ts'

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

test('favorite filter preserves matching folder ancestors', () => {
  const result = filterVaultEntries(entries, '', 'favorites', {
    favoriteIds: new Set(['login-a'])
  })
  assert.deepEqual(result.map((entry) => entry.id), ['folder'])
  assert.deepEqual(result[0].children.map((entry) => entry.id), ['login-a'])
})

test('shared search index preserves filtering and excludes protected values', () => {
  const entries = [
    {
      id: 'folder', kind: 'folder', title: '生产', children: [
        { id: 'visible', kind: 'login', title: '账号', username: 'alice', password: 'hidden-password', note: '服务', customFields: [{ label: '备注', value: '公开', protected: false }] },
        { id: 'secret-only', kind: 'login', title: '其他', password: 'needle-secret', customFields: [{ label: '令牌', value: 'secret-token', protected: true }] }
      ]
    }
  ]
  const index = buildVaultSearchIndex(entries)
  assert.equal(index.filter('公开', 'all')[0].children[0].id, 'visible')
  assert.deepEqual(index.filter('hidden-password', 'all'), [])
  assert.deepEqual(index.filter('secret-token', 'all'), [])
  assert.deepEqual(index.quickAccess('needle-secret'), [])
})

test('recent filter orders opened entries newest first', () => {
  const result = filterVaultEntries([
    entries[0].children[0],
    entries[0].children[1]
  ], '', 'recent', {
    recentIds: ['login-b', 'login-a']
  })
  assert.deepEqual(result.map((entry) => entry.id), ['login-b', 'login-a'])
})
