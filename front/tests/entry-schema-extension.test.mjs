import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeVaultPayload } from '../src/services/vaultDefaults.ts'
import { buildEntryHistoryChanges } from '../src/services/entryHistory.ts'
import { buildCloudSyncDiff } from '../src/services/sync/legacyDiff.ts'

function payload(entry) {
  return {
    version: 1,
    revision: 1,
    entries: [entry],
    passkeys: [],
    passkeyTombstones: [],
    settings: { oss: {} },
    updatedAt: 1
  }
}

test('normalization preserves supported item kinds and bounded custom fields', () => {
  const normalized = normalizeVaultPayload(payload({
    id: 'card',
    kind: 'card',
    title: 'Primary card',
    domains: [],
    customFields: [
      { id: 'number', label: '卡号', value: '4111111111111111', type: 'secret', protected: false },
      { id: 'expiry', label: '有效期', value: '2030-12', type: 'date', protected: false }
    ],
    children: [{ id: 'must-drop', kind: 'login', title: 'Nested', domains: [] }]
  }))
  const entry = normalized.entries[0]
  assert.equal(entry.kind, 'card')
  assert.equal(entry.customFields?.[0].protected, true)
  assert.equal(entry.customFields?.[1].type, 'date')
  assert.deepEqual(entry.children, [])
})

test('custom field history reports labels without displaying protected values', () => {
  const before = { id: 'key', kind: 'api-key', title: 'API', domains: [], customFields: [], children: [] }
  const after = {
    ...before,
    customFields: [{ id: 'secret', label: 'Secret', value: 'never-show-this', type: 'secret', protected: true }]
  }
  const [change] = buildEntryHistoryChanges(before, after).filter((item) => item.field === 'customFields')
  assert.equal(change.after, '1 项：Secret')
  assert.doesNotMatch(change.after, /never-show-this/)
})

test('cloud review detects custom field changes without exposing field values', () => {
  const base = payload({ id: 'key', kind: 'api-key', title: 'API', domains: [], customFields: [], children: [] })
  const source = payload({
    id: 'key', kind: 'api-key', title: 'API', domains: [],
    customFields: [{ id: 'secret', label: 'Secret', value: 'never-show-this', type: 'secret', protected: true }],
    children: []
  })
  const [item] = buildCloudSyncDiff(source, base)
  const detail = item.details.find((candidate) => candidate.key === 'customFields')
  assert.equal(detail?.sourceText, '1 项：Secret')
  assert.doesNotMatch(JSON.stringify(detail), /never-show-this/)
})
