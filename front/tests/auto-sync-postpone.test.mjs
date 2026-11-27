import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AUTO_SYNC_POSTPONE_DEFAULT_MINUTES,
  AUTO_SYNC_POSTPONE_MAX_MINUTES,
  AUTO_SYNC_POSTPONE_MIN_MINUTES,
  AUTO_SYNC_POSTPONE_PRESET_MINUTES,
  formatAutoSyncPostponePresetLabel,
  formatAutoSyncPostponeTime,
  isAutoSyncPostponedAt,
  normalizeAutoSyncPostponeMinutes,
  normalizeAutoSyncPostponedUntil,
  remainingAutoSyncPostponeMs
} from '../src/services/autoSyncPostpone.ts'

test('auto-sync postpone minutes normalize and clamp safely', () => {
  assert.deepEqual([...AUTO_SYNC_POSTPONE_PRESET_MINUTES], [5, 15, 30, 60])
  assert.equal(normalizeAutoSyncPostponeMinutes('bad'), AUTO_SYNC_POSTPONE_DEFAULT_MINUTES)
  assert.equal(normalizeAutoSyncPostponeMinutes(0), AUTO_SYNC_POSTPONE_MIN_MINUTES)
  assert.equal(normalizeAutoSyncPostponeMinutes(-10), AUTO_SYNC_POSTPONE_MIN_MINUTES)
  assert.equal(normalizeAutoSyncPostponeMinutes(9999), AUTO_SYNC_POSTPONE_MAX_MINUTES)
  assert.equal(normalizeAutoSyncPostponeMinutes(14.6), 15)
})

test('auto-sync postpone deadline helpers distinguish active vs expired deadlines', () => {
  const now = Date.UTC(2026, 10, 27, 7, 30, 0)
  const future = now + 15 * 60 * 1000
  const past = now - 1000

  assert.equal(normalizeAutoSyncPostponedUntil(String(future), now), future)
  assert.equal(normalizeAutoSyncPostponedUntil(String(past), now), 0)
  assert.equal(normalizeAutoSyncPostponedUntil('not-a-number', now), 0)

  assert.equal(isAutoSyncPostponedAt(future, now), true)
  assert.equal(isAutoSyncPostponedAt(past, now), false)
  assert.equal(remainingAutoSyncPostponeMs(future, now), 15 * 60 * 1000)
  assert.equal(remainingAutoSyncPostponeMs(past, now), 0)
})

test('auto-sync postpone formatters produce readable preset and time labels', () => {
  assert.equal(formatAutoSyncPostponePresetLabel(5), '5 分钟')
  assert.equal(formatAutoSyncPostponePresetLabel(15), '15 分钟')
  assert.equal(formatAutoSyncPostponePresetLabel(30), '30 分钟')
  assert.equal(formatAutoSyncPostponePresetLabel(60), '1 小时')

  const base = new Date(2026, 10, 27, 15, 30, 0).getTime()
  const sameDay = new Date(2026, 10, 27, 15, 45, 0).getTime()
  const nextDay = new Date(2026, 10, 28, 9, 5, 0).getTime()
  assert.equal(formatAutoSyncPostponeTime(sameDay, base), '15:45')
  assert.equal(formatAutoSyncPostponeTime(nextDay, base), '11-28 09:05')
  assert.equal(formatAutoSyncPostponeTime(0, base), '')
})

test('auto-sync postpone is wired across store, review modal, settings drawer, and app shell', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const syncStoreSrc = fs.readFileSync(path.join(root, 'src/stores/syncStore.ts'), 'utf8')
  const reviewSrc = fs.readFileSync(path.join(root, 'src/components/sync/CloudSyncReview.vue'), 'utf8')
  const settingsSrc = fs.readFileSync(path.join(root, 'src/components/settings/SettingsDrawer.vue'), 'utf8')
  const appSrc = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8')

  assert.match(syncStoreSrc, /function postponeAutoSync\(/)
  assert.match(syncStoreSrc, /function resumeAutoSync\(/)
  assert.match(syncStoreSrc, /expireAutoSyncPostponeIfNeeded\(\)/)
  assert.match(reviewSrc, /postpone:\s*\[minutes:\s*number\]/)
  assert.match(reviewSrc, /推迟同步/)
  assert.match(settingsSrc, /sync\.postponeAutoSync\(minutes\)/)
  assert.match(settingsSrc, /sync\.resumeAutoSync\(\)/)
  assert.match(appSrc, /@postpone="sync\.postponeAutoSync\(\$event,\s*\{\s*fromReview:\s*true\s*\}\)"/)
  assert.match(appSrc, /sync\.isAutoSyncPostponed/)
})
