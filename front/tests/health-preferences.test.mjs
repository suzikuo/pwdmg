import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HEALTH_IGNORED_FINDINGS_KEY,
  HEALTH_TOTP_EXPECTED_IDS_KEY,
  clearIgnoredHealthFindingsForEntry,
  healthFindingKey,
  ignoreHealthFinding,
  loadExpectedTotpEntryIds,
  loadIgnoredHealthFindings,
  pruneHealthPreferences,
  restoreHealthFinding,
  setExpectedTotpEntryId
} from '../src/services/healthPreferences.ts'

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

test('expected TOTP IDs are normalized, toggled, and restricted to valid logins', () => {
  const storage = createStorage({
    [HEALTH_TOTP_EXPECTED_IDS_KEY]: JSON.stringify(['login-a', 'login-a', 42, 'missing'])
  })
  const loaded = loadExpectedTotpEntryIds(storage)
  assert.deepEqual([...loaded], ['login-a', 'missing'])
  const added = setExpectedTotpEntryId('login-b', true, loaded, storage)
  const removed = setExpectedTotpEntryId('login-a', false, added, storage)
  const pruned = pruneHealthPreferences(
    new Set(['login-b', 'note']),
    new Set(['login-b']),
    removed,
    new Map(),
    storage
  )
  assert.deepEqual([...pruned.expectedTotpIds], ['login-b'])
  assert.deepEqual(JSON.parse(storage.getItem(HEALTH_TOTP_EXPECTED_IDS_KEY)), ['login-b'])
})

test('ignored findings require a bounded reason and keep the newest value per issue', () => {
  const storage = createStorage()
  let current = ignoreHealthFinding('entry', 'weak', 'accepted temporarily', new Map(), storage, 100)
  current = ignoreHealthFinding('entry', 'weak', 'newer reason', current, storage, 200)
  current = ignoreHealthFinding('entry', 'expired', 'legacy card', current, storage, 150)

  assert.equal(current.size, 2)
  assert.equal(current.get(healthFindingKey('entry', 'weak')).reason, 'newer reason')
  assert.equal(loadIgnoredHealthFindings(storage).size, 2)
  assert.equal(storage.getItem(HEALTH_IGNORED_FINDINGS_KEY).includes('accepted temporarily'), false)
})

test('ignored findings can be restored, cleared per entry, and pruned', () => {
  const storage = createStorage()
  let current = ignoreHealthFinding('a', 'weak', 'reason a', new Map(), storage, 100)
  current = ignoreHealthFinding('a', 'reused', 'reason b', current, storage, 101)
  current = ignoreHealthFinding('b', 'expired', 'reason c', current, storage, 102)
  current = restoreHealthFinding('a', 'weak', current, storage)
  assert.equal(current.has(healthFindingKey('a', 'weak')), false)
  current = clearIgnoredHealthFindingsForEntry('a', current, storage)
  assert.deepEqual([...current.values()].map((item) => item.entryId), ['b'])

  const pruned = pruneHealthPreferences(new Set(['other']), new Set(), [], current, storage)
  assert.equal(pruned.ignoredFindings.size, 0)
})

test('malformed local health metadata fails closed', () => {
  const storage = createStorage({
    [HEALTH_TOTP_EXPECTED_IDS_KEY]: '{bad json',
    [HEALTH_IGNORED_FINDINGS_KEY]: JSON.stringify([
      { entryId: 'a', issue: 'not-real', reason: 'x', ignoredAt: 1 },
      { entryId: 'b', issue: 'weak', reason: '', ignoredAt: 1 },
      { entryId: 'c', issue: 'weak', reason: 'ok', ignoredAt: -1 }
    ])
  })
  assert.deepEqual([...loadExpectedTotpEntryIds(storage)], [])
  assert.equal(loadIgnoredHealthFindings(storage).size, 0)
})
