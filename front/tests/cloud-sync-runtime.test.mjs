import assert from 'node:assert/strict'
import test from 'node:test'

import { useCloudSync } from '../src/composables/useCloudSync.ts'

test('cancelled cloud work cannot be completed by a stale finally block', () => {
  const runtime = useCloudSync()
  const operation = runtime.begin('review', { direction: 'download' })

  assert.ok(operation)
  assert.equal(runtime.busy.value, true)
  assert.equal(runtime.stage(operation, 'reading-remote'), true)
  runtime.cancel()
  runtime.finish(operation)

  assert.equal(operation.signal.aborted, true)
  assert.equal(runtime.busy.value, false)
  assert.equal(runtime.state.value.stage, 'cancelled')
})

test('a previous operation cannot mutate the next cloud operation', () => {
  const runtime = useCloudSync()
  const first = runtime.begin('inspect')
  runtime.finish(first)
  const second = runtime.begin('apply', { direction: 'upload' })

  assert.ok(first)
  assert.ok(second)
  assert.equal(runtime.stage(first, 'writing-remote'), false)
  assert.equal(runtime.stage(second, 'writing-remote'), true)
  runtime.finish(second)

  assert.equal(runtime.busy.value, false)
  assert.equal(runtime.state.value.kind, 'apply')
  assert.equal(runtime.state.value.stage, 'success')
})

test('initial download barrier blocks automatic upload until download starts', () => {
  const runtime = useCloudSync()

  assert.equal(runtime.canScheduleAutomaticUpload(), true)
  runtime.requireInitialDownload()
  assert.equal(runtime.canScheduleAutomaticUpload(), false)

  runtime.releaseInitialDownloadBarrier()
  assert.equal(runtime.canScheduleAutomaticUpload(), true)
})
