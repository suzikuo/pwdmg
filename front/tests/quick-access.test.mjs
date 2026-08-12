import assert from 'node:assert/strict'
import test from 'node:test'

import { searchQuickAccessEntries } from '../src/services/quickAccess.ts'
import { buildVaultSearchIndex } from '../src/services/searchIndex.ts'

const entries = [
  {
    id: 'folder', kind: 'folder', title: '工作', status: 'active', children: [
      { id: 'alpha', kind: 'login', title: 'Alpha Console', username: 'alice', domains: ['alpha.example.com'], password: 'never-index-me', children: [] },
      { id: 'note', kind: 'secure-note', title: '恢复资料', note: '生产环境恢复说明', children: [] }
    ]
  },
  { id: 'beta', kind: 'login', title: 'Beta', email: 'beta@example.com', domains: ['beta.example.com'], children: [] },
  {
    id: 'archived-folder', kind: 'folder', title: 'Archived', status: 'disabled', children: [
      { id: 'hidden', kind: 'login', title: 'Hidden Login', status: 'active', children: [] }
    ]
  },
  {
    id: 'api', kind: 'api-key', title: 'Deploy Key', customFields: [
      { id: 'safe', label: '环境', value: 'staging', type: 'text', protected: false },
      { id: 'secret', label: 'Token', value: 'secret-token-value', type: 'secret', protected: true }
    ], children: []
  }
]

test('quick access searches active non-folder entries by useful visible fields', () => {
  assert.deepEqual(searchQuickAccessEntries(entries, 'alpha').map((entry) => entry.id), ['alpha'])
  assert.deepEqual(searchQuickAccessEntries(entries, '生产环境').map((entry) => entry.id), ['note'])
  assert.deepEqual(searchQuickAccessEntries(entries, 'staging').map((entry) => entry.id), ['api'])
  assert.deepEqual(searchQuickAccessEntries(entries, 'Hidden').map((entry) => entry.id), [])
})

test('quick access never indexes passwords or protected custom field values', () => {
  assert.deepEqual(searchQuickAccessEntries(entries, 'never-index-me'), [])
  assert.deepEqual(searchQuickAccessEntries(entries, 'secret-token-value'), [])
})

test('empty quick access ranks favorites, then recent entries, deterministically', () => {
  const result = searchQuickAccessEntries(entries, '', {
    favoriteIds: new Set(['api']),
    recentIds: ['beta', 'alpha']
  })
  assert.deepEqual(result.map((entry) => entry.id), ['api', 'beta', 'alpha', 'note'])
})

test('text relevance wins before preference ranking for explicit searches', () => {
  const result = searchQuickAccessEntries([
    { id: 'exact', kind: 'login', title: 'Mail', children: [] },
    { id: 'favorite', kind: 'login', title: 'Work Mail', children: [] }
  ], 'mail', { favoriteIds: new Set(['favorite']) })
  assert.deepEqual(result.map((entry) => entry.id), ['exact', 'favorite'])
})

test('shared search index keeps quick access ranking stable', () => {
  const entries = [
    { id: 'folder', kind: 'folder', title: 'Folder', children: [
      { id: 'beta', kind: 'login', title: 'Beta', username: 'same' },
      { id: 'alpha', kind: 'login', title: 'Alpha', username: 'same' }
    ] }
  ]
  const index = buildVaultSearchIndex(entries)
  assert.deepEqual(index.quickAccess('same').map((entry) => entry.id), ['alpha', 'beta'])
})
