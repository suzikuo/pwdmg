import assert from 'node:assert/strict'
import test from 'node:test'

import { insertDuplicateEntry } from '../src/services/entryDuplication.ts'

test('duplicates a folder beside its source with fresh recursive identity and clean state', () => {
  const entries = [{
    id: 'folder-1',
    kind: 'folder',
    title: '工作',
    status: 'active',
    domains: [],
    history: [{ id: 'history-1', action: 'updated', at: 1, title: '旧名称' }],
    children: [{
      id: 'login-1',
      kind: 'login',
      title: '控制台',
      status: 'active',
      statusReason: '',
      statusUpdatedAt: 0,
      deletedAt: 0,
      domains: ['example.com'],
      password: 'secret',
      history: [{ id: 'history-2', action: 'updated', at: 2, title: '旧登录' }],
      children: []
    }, {
      id: 'login-archived',
      kind: 'login',
      title: '已归档登录',
      status: 'disabled',
      domains: [],
      children: []
    }]
  }]
  const ids = ['folder-2', 'login-2']

  const duplicate = insertDuplicateEntry(entries, 'folder-1', () => ids.shift())

  assert.equal(entries.length, 2)
  assert.equal(duplicate.id, 'folder-2')
  assert.equal(duplicate.title, '工作 副本')
  assert.deepEqual(duplicate.history, [])
  assert.equal(duplicate.children[0].id, 'login-2')
  assert.equal(duplicate.children[0].title, '控制台')
  assert.equal(duplicate.children[0].status, 'active')
  assert.equal(duplicate.children[0].statusReason, '')
  assert.equal(duplicate.children[0].password, 'secret')
  assert.deepEqual(duplicate.children[0].history, [])
  assert.equal(duplicate.children.length, 1)
  assert.equal(entries[0].children.length, 2)
})

test('refuses generated IDs that collide with source entries', () => {
  const entries = [{ id: 'login-1', kind: 'login', title: 'A', domains: [], children: [] }]
  const ids = ['login-1', 'login-2']
  const duplicate = insertDuplicateEntry(entries, 'login-1', () => ids.shift())
  assert.equal(duplicate.id, 'login-2')
})
