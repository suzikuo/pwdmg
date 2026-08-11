import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzePasswordHealth,
  estimatePasswordStrength,
  parseExpiryDate
} from '../src/services/passwordHealth.ts'

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

test('detects only explicit valid insecure HTTP URLs across domains and typed fields', () => {
  const report = analyzePasswordHealth([
    login('http-login', { domains: ['http://example.com/login', 'example.org', 'https://safe.example'] }),
    content('secure-note', 'http-field', {
      customFields: [
        { id: 'u1', label: 'Endpoint', value: 'HTTP://api.example.test/v1', type: 'url', protected: false },
        { id: 'u2', label: 'Text', value: 'http://not-a-url-field.test', type: 'text', protected: false },
        { id: 'u3', label: 'Invalid', value: 'http://', type: 'url', protected: false }
      ]
    }),
    login('safe-login', { domains: ['https://example.com', 'portal.example.com'] })
  ])

  assert.equal(report.summary.insecureUrlCount, 2)
  assert.equal(report.entries.find((item) => item.entryId === 'http-login').insecureUrlCount, 1)
  assert.ok(report.entries.find((item) => item.entryId === 'http-field').issues.includes('insecure-url'))
  assert.equal(report.entries.find((item) => item.entryId === 'safe-login').issues.includes('insecure-url'), false)
})

test('groups exact semantic duplicates without exposing protected comparison content', () => {
  const protectedValue = 'private duplicate material must stay internal'
  const shared = {
    title: 'Recovery note',
    note: 'same note',
    customFields: [{ id: 'field-a', label: 'Code', value: protectedValue, type: 'secret', protected: true }]
  }
  const report = analyzePasswordHealth([
    content('secure-note', 'copy-b', { ...shared, history: [{ id: 'newer-local-history' }] }),
    content('secure-note', 'copy-a', {
      ...shared,
      customFields: [{ ...shared.customFields[0], id: 'different-field-id' }]
    }),
    content('secure-note', 'different', {
      ...shared,
      customFields: [{ ...shared.customFields[0], value: `${protectedValue}-changed` }]
    }),
    login('space-a', { title: 'Whitespace-sensitive', password: ' secret-with-spaces ' }),
    login('space-b', { title: 'Whitespace-sensitive', password: 'secret-with-spaces' })
  ])

  assert.equal(report.summary.duplicateGroupCount, 1)
  assert.equal(report.summary.duplicateEntryCount, 2)
  assert.deepEqual(report.duplicateGroups[0].entries.map((item) => item.entryId), ['copy-a', 'copy-b'])
  assert.equal(report.entries.find((item) => item.entryId === 'space-a').issues.includes('duplicate'), false)
  assert.equal(report.entries.find((item) => item.entryId === 'space-b').issues.includes('duplicate'), false)
  assert.equal(JSON.stringify(report).includes(protectedValue), false)
})

test('does not merge otherwise identical entries with different autofill rules', () => {
  const base = login('base-rule', 'same-secret')
  base.domains = ['example.com']
  base.autofillMatchMode = 'base-domain'
  const exact = { ...base, id: 'exact-rule', autofillMatchMode: 'exact-host' }

  const report = analyzePasswordHealth([base, exact])

  assert.equal(report.summary.duplicateGroupCount, 0)
  assert.equal(report.entries.some((entry) => entry.issues.includes('duplicate')), false)
})

test('parses unambiguous expiry shapes and reports expired and soon-expiring typed dates', () => {
  const now = Date.UTC(2026, 7, 7)
  const report = analyzePasswordHealth([
    content('card', 'card', {
      customFields: [
        { id: 'expired', label: '旧卡', value: '07/26', type: 'date', protected: false },
        { id: 'soon', label: '新卡', value: '08/2026', type: 'date', protected: false },
        { id: 'future', label: '以后', value: '2027-12', type: 'date', protected: false },
        { id: 'ambiguous', label: '不明确', value: '1/2/27', type: 'date', protected: false }
      ]
    })
  ], { now, expiringWithinDays: 30 })

  const card = report.entries[0]
  assert.ok(card.issues.includes('expired'))
  assert.ok(card.issues.includes('expiring'))
  assert.deepEqual(card.expirations.map((item) => item.fieldId), ['expired', 'soon'])
  assert.equal(report.summary.expiredCount, 1)
  assert.equal(report.summary.expiringCount, 1)
  assert.equal(parseExpiryDate('2024-02-29'), Date.UTC(2024, 2, 1) - 1)
  assert.equal(parseExpiryDate('2025-02-29'), undefined)
  assert.equal(parseExpiryDate('13/2027'), undefined)
})

test('reports expected TOTP only for explicitly marked active logins without a secret', () => {
  const report = analyzePasswordHealth([
    login('missing-totp'),
    login('configured-totp', { totpSecret: 'JBSWY3DPEHPK3PXP' }),
    content('secure-note', 'not-a-login')
  ], { totpExpectedIds: new Set(['missing-totp', 'configured-totp', 'not-a-login']) })

  assert.equal(report.summary.missingTotpCount, 1)
  assert.ok(report.entries.find((item) => item.entryId === 'missing-totp').issues.includes('missing-totp'))
  assert.equal(report.entries.find((item) => item.entryId === 'configured-totp').issues.includes('missing-totp'), false)
  assert.equal(report.entries.find((item) => item.entryId === 'not-a-login').issues.includes('missing-totp'), false)
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

function content(kind, id, overrides = {}) {
  return {
    id,
    kind,
    title: id,
    status: 'active',
    domains: [],
    customFields: [],
    history: [],
    children: [],
    ...overrides
  }
}
