import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FAVORITE_ENTRY_IDS_KEY,
  MAX_RECENT_ENTRY_IDS,
  RECENT_ENTRY_IDS_KEY,
  loadFavoriteEntryIds,
  loadRecentEntryIds,
  pruneEntryPreferenceIds,
  rememberRecentEntryId,
  setFavoriteEntryIds,
  toggleFavoriteEntryId
} from '../src/services/entryListPreferences.ts'

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    }
  }
}

test('favorite preferences toggle, deduplicate, and persist locally', () => {
  const storage = createStorage({ [FAVORITE_ENTRY_IDS_KEY]: JSON.stringify(['a', 'a', 4]) })
  assert.deepEqual([...loadFavoriteEntryIds(storage)], ['a'])
  assert.deepEqual([...toggleFavoriteEntryId('b', ['a'], storage)], ['a', 'b'])
  assert.deepEqual([...toggleFavoriteEntryId('a', ['a', 'b'], storage)], ['b'])
  assert.deepEqual([...loadFavoriteEntryIds(storage)], ['b'])
})

test('favorite preferences can be applied to a mixed batch deterministically', () => {
  const storage = createStorage()
  const added = setFavoriteEntryIds(['a', 'b'], true, new Set(['b', 'c']), storage)
  assert.deepEqual([...added], ['b', 'c', 'a'])
  const removed = setFavoriteEntryIds(['b', 'missing'], false, added, storage)
  assert.deepEqual([...removed], ['c', 'a'])
})

test('recent preferences move an opened item to the front and cap the list', () => {
  const storage = createStorage()
  const current = Array.from({ length: MAX_RECENT_ENTRY_IDS }, (_, index) => `entry-${index}`)
  const next = rememberRecentEntryId('new-entry', current, storage)
  assert.equal(next[0], 'new-entry')
  assert.equal(next.length, MAX_RECENT_ENTRY_IDS)
  assert.equal(loadRecentEntryIds(storage)[0], 'new-entry')
  assert.equal(next.includes(`entry-${MAX_RECENT_ENTRY_IDS - 1}`), false)
})

test('invalid and inactive preference IDs are pruned', () => {
  const storage = createStorage()
  const result = pruneEntryPreferenceIds(new Set(['active']), ['active', 'missing'], ['missing', 'active'], storage)
  assert.deepEqual([...result.favoriteIds], ['active'])
  assert.deepEqual(result.recentIds, ['active'])
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITE_ENTRY_IDS_KEY)), ['active'])
  assert.deepEqual(JSON.parse(storage.getItem(RECENT_ENTRY_IDS_KEY)), ['active'])
})

test('malformed preference storage fails closed', () => {
  const storage = createStorage({
    [FAVORITE_ENTRY_IDS_KEY]: '{bad json',
    [RECENT_ENTRY_IDS_KEY]: JSON.stringify({ id: 'not-an-array' })
  })
  assert.deepEqual([...loadFavoriteEntryIds(storage)], [])
  assert.deepEqual(loadRecentEntryIds(storage), [])
})
