import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzePasswordHealth, estimatePasswordStrength } from '../src/services/passwordHealth.ts'

test('analyzes active login entries recursively and respects inactive ancestors', () => {
  const entries = [
    folder('active-folder', [
      login('nested', { password: 'correct horse battery staple' }),
      login('disabled-login', { status: 'disabled', password: 'secret' })
    ]),
    folder('trashed-folder', [login('hidden-child', { password: 'secret' })], { status: 'trashed' }),
    { ...login('folder-shaped-login'), kind: 'folder', password: 'must-not-count' }
  ]

  const report = analyzePasswordHealth(entries)
  assert.equal(report.summary.analyzedCount, 1)
  assert.deepEqual(report.entries.map((item) => item.entryId), ['nested'])
})

test('reports deterministic password reuse groups without exposing password values', () => {
  const secret = 'Shared-secret-that-must-not-leak!'
  const report = analyzePasswordHealth([
    login('z', { title: 'Zulu', password: secret }),
    login('a', { title: 'Alpha', password: secret }),
    login('solo', { password: 'one-off high entropy phrase #42' })
  ])

  assert.equal(report.summary.reuseGroupCount, 1)
  assert.equal(report.summary.reusedEntryCount, 2)
  assert.deepEqual(report.reuseGroups, [{
    id: 'reuse-1',
    count: 2,
    entries: [
      { entryId: 'a', title: 'Alpha' },
      { entryId: 'z', title: 'Zulu' }
    ]
  }])
  assert.equal(JSON.stringify(report).includes(secret), false)
})

test('scores common, repetitive, contextual, and strong passwords with bounded metrics', () => {
  const common = estimatePasswordStrength('password')
  assert.equal(common.score, 0)
  assert.equal(common.weak, true)
  assert.ok(common.reasons.includes('common-password'))

  const repetitive = estimatePasswordStrength('Ab12Ab12Ab12Ab12')
  assert.ok(repetitive.reasons.includes('repetitive'))
  assert.equal(repetitive.weak, true)

  const contextual = estimatePasswordStrength('example-portal-2026!', {
    title: 'Example Portal', username: 'alice', email: '', domains: ['example.com']
  })
  assert.ok(contextual.reasons.includes('contains-account-data'))

  const strong = estimatePasswordStrength('violet harbor piano quartz 47!')
  assert.ok(strong.score >= 3)
  assert.equal(strong.weak, false)
  assert.ok(strong.estimatedEntropyBits >= 0 && strong.estimatedEntropyBits <= 256)
})

test('separates missing passwords from present weak passwords', () => {
  const report = analyzePasswordHealth([
    login('missing', { password: undefined }),
    login('weak', { password: '123456' })
  ])

  assert.equal(report.summary.missingCount, 1)
  assert.equal(report.summary.weakCount, 1)
  assert.deepEqual(report.entries.find((item) => item.entryId === 'missing').issues, ['missing'])
  assert.deepEqual(report.entries.find((item) => item.entryId === 'weak').issues, ['weak'])
})

test('uses password history for age only when it establishes the current password timestamp', () => {
  const now = Date.UTC(2026, 7, 4)
  const changedAt = now - 400 * 86_400_000
  const report = analyzePasswordHealth([
    login('changed', {
      password: 'current-password-value',
      statusUpdatedAt: Math.floor((now - 2 * 86_400_000) / 1000),
      history: [{
        id: 'h1', action: 'updated', at: Math.floor(changedAt / 1000), title: 'changed',
        snapshot: { ...login('changed-old', { password: 'previous-password-value' }), children: undefined, history: undefined }
      }]
    }),
    login('unknown', {
      password: 'current-password-value-2',
      statusUpdatedAt: Math.floor((now - 500 * 86_400_000) / 1000),
      history: []
    })
  ], { now, staleAfterDays: 365 })

  const changed = report.entries.find((item) => item.entryId === 'changed')
  const unknown = report.entries.find((item) => item.entryId === 'unknown')
  assert.equal(changed.passwordAge.changedAt, changedAt)
  assert.equal(changed.passwordAge.ageDays, 400)
  assert.equal(changed.passwordAge.source, 'history-change')
  assert.ok(changed.issues.includes('stale'))
  assert.equal(unknown.passwordAge, undefined)
  assert.equal(unknown.issues.includes('stale'), false)
})

test('supports explicit age metadata, ignores invalid timestamps, and can disable stale flags', () => {
  const now = Date.UTC(2026, 7, 4)
  const entries = [login('known', { password: 'long password phrase 123!' })]
  const known = analyzePasswordHealth(entries, {
    now,
    getPasswordChangedAtMs: () => now - 30 * 86_400_000,
    staleAfterDays: null
  })
  assert.equal(known.entries[0].passwordAge.ageDays, 30)
  assert.equal(known.entries[0].passwordAge.source, 'provided')
  assert.equal(known.entries[0].passwordAge.stale, false)

  const invalid = analyzePasswordHealth(entries, {
    now,
    getPasswordChangedAtMs: () => Number.NaN
  })
  assert.equal(invalid.entries[0].passwordAge, undefined)
})

test('ordering is deterministic across different input order', () => {
  const entries = [
    login('b', { title: 'Beta', password: 'same-shared-value' }),
    login('a', { title: 'Alpha', password: 'same-shared-value' }),
    login('c', { title: 'Charlie', password: '' })
  ]
  const left = analyzePasswordHealth(entries, { now: 1_000_000 })
  const right = analyzePasswordHealth([...entries].reverse(), { now: 1_000_000 })
  assert.deepEqual(left, right)
})

test('handles cycles, duplicate IDs, and configured traversal bounds', () => {
  const cyclic = folder('root', [login('first', { password: 'a' }), login('first', { password: 'b' })])
  cyclic.children.push(cyclic)
  cyclic.children.push(login('second', { password: 'c' }))

  const report = analyzePasswordHealth([cyclic], { maxEntries: 2, maxVisitedNodes: 10 })
  assert.equal(report.summary.analyzedCount, 2)
  assert.equal(report.skippedDuplicateIds, 1)
  assert.equal(report.truncated, true)
  assert.deepEqual(new Set(report.entries.map((item) => item.entryId)), new Set(['first', 'second']))
})

function login(id, overrides = {}) {
  return {
    id,
    kind: 'login',
    title: id,
    status: 'active',
    domains: [],
    username: '',
    email: '',
    password: '',
    history: [],
    children: [],
    ...overrides
  }
}

function folder(id, children, overrides = {}) {
  return { ...login(id), kind: 'folder', children, ...overrides }
}
