import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  WEB_ATTACHMENT_ORPHAN_GRACE_SECONDS,
  WEB_ATTACHMENT_RETAIN_SECONDS,
  normalizeWebAttachmentManifest,
  planWebAttachmentCollection
} from '../src/services/webAttachmentRetention.ts'

const activeId = '123e4567-e89b-42d3-a456-426614174000'
const retainedId = '223e4567-e89b-42d3-a456-426614174001'
const referencedId = '323e4567-e89b-42d3-a456-426614174002'
const now = 2_000_000
const adapterSource = readFileSync(new URL('../src/services/webStorageAdapter.ts', import.meta.url), 'utf8')
const indexedDbSource = readFileSync(new URL('../src/services/indexedDbStore.ts', import.meta.url), 'utf8')

test('Web attachment collection retains old orphans and deletes expired retained objects', () => {
  const plan = planWebAttachmentCollection({
    [activeId]: {
      objectBytes: 120,
      retained: false,
      createdAt: now - WEB_ATTACHMENT_ORPHAN_GRACE_SECONDS
    },
    [retainedId]: {
      objectBytes: 240,
      retained: true,
      createdAt: now - WEB_ATTACHMENT_ORPHAN_GRACE_SECONDS,
      deletedAt: now - WEB_ATTACHMENT_RETAIN_SECONDS
    }
  }, [], now)

  assert.deepEqual(plan.retainIds, [activeId])
  assert.deepEqual(plan.deleteIds, [retainedId])
  assert.equal(plan.manifest[activeId].retained, true)
  assert.equal(plan.manifest[activeId].deletedAt, now)
  assert.equal(plan.manifest[retainedId], undefined)
})

test('referenced retained attachments are restored without changing their original creation time', () => {
  const createdAt = 100
  const plan = planWebAttachmentCollection({
    [referencedId]: {
      objectBytes: 320,
      retained: true,
      createdAt,
      deletedAt: 200
    }
  }, [referencedId], now)

  assert.deepEqual(plan.restoreIds, [referencedId])
  assert.equal(plan.manifest[referencedId].retained, false)
  assert.equal(plan.manifest[referencedId].createdAt, createdAt)
  assert.equal(plan.manifest[referencedId].deletedAt, undefined)
})

test('legacy manifests receive timestamps before they become eligible for collection', () => {
  const plan = planWebAttachmentCollection({
    [activeId]: { objectBytes: 120, retained: false },
    [retainedId]: { objectBytes: 240, retained: true }
  }, [], now)

  assert.deepEqual(plan.retainIds, [])
  assert.deepEqual(plan.deleteIds, [])
  assert.equal(plan.manifest[activeId].createdAt, now)
  assert.equal(plan.manifest[retainedId].deletedAt, now)
})

test('Web attachment manifests and reference IDs fail closed when malformed', () => {
  assert.throws(() => normalizeWebAttachmentManifest({ bad: { objectBytes: 1, retained: false } }), /ID is invalid/i)
  assert.throws(() => normalizeWebAttachmentManifest({ [activeId]: { objectBytes: 0, retained: false } }), /size is invalid/i)
  assert.throws(() => planWebAttachmentCollection({}, ['../vault'], now), /ID is invalid/i)
})

test('Web attachment object moves and manifests share an abortable transaction', () => {
  assert.match(adapterSource, /collectAttachmentObjects: \(referencedIds\) => guard\(async \(\) => idbRunReadwrite/)
  assert.doesNotMatch(adapterSource, /collectAttachmentObjects: async \(\) => ok\(\{ retained: 0, deleted: 0 \}\)/)
  assert.match(indexedDbSource, /transaction\.abort\(\)/)
})
