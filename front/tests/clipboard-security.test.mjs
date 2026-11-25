import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearSensitiveClipboard,
  copySensitiveText,
  SENSITIVE_CLIPBOARD_TTL_MS
} from '../src/services/clipboardSecurity.ts'

test('clears copied sensitive text after the configured expiry when unchanged', async () => {
  let value = ''
  let scheduledDelay = 0
  let scheduled
  const clipboard = {
    async writeText(next) { value = next },
    async readText() { return value }
  }
  await copySensitiveText('secret', clipboard, (callback, delay) => {
    scheduled = callback
    scheduledDelay = delay
    return 1
  }, () => {})
  assert.equal(value, 'secret')
  assert.equal(scheduledDelay, SENSITIVE_CLIPBOARD_TTL_MS)
  await scheduled()
  assert.equal(value, '')
})

test('does not erase clipboard content copied by another application later', async () => {
  let value = ''
  let scheduled
  const clipboard = {
    async writeText(next) { value = next },
    async readText() { return value }
  }
  await copySensitiveText('secret', clipboard, (callback) => {
    scheduled = callback
    return 2
  }, () => {})
  value = 'newer-value'
  await scheduled()
  assert.equal(value, 'newer-value')
})

test('lock cleanup clears only the still-current sensitive clipboard value', async () => {
  let value = ''
  let canceled = 0
  const clipboard = {
    async writeText(next) { value = next },
    async readText() { return value }
  }
  await copySensitiveText('secret', clipboard, () => 3, () => { canceled += 1 })
  await clearSensitiveClipboard()
  assert.equal(value, '')
  assert.equal(canceled, 1)

  await copySensitiveText('another-secret', clipboard, () => 4, () => { canceled += 1 })
  value = 'newer-value'
  await clearSensitiveClipboard()
  assert.equal(value, 'newer-value')
  assert.equal(canceled, 2)
})

test('delegates sensitive copy and lock clear to native desktop clipboard when available', async () => {
  const calls = []
  let browserWrites = 0
  const browserClipboard = {
    async writeText() { browserWrites += 1 },
    async readText() { return '' }
  }
  const nativeBridge = {
    async copySensitiveText(text, clearAfterSeconds) {
      calls.push({ method: 'copySensitiveText', text, clearAfterSeconds })
      return { ok: true }
    },
    async clearSensitiveClipboard() {
      calls.push({ method: 'clearSensitiveClipboard' })
      return { ok: true }
    }
  }

  await copySensitiveText('native-secret', browserClipboard, () => 99, () => {}, nativeBridge)
  assert.equal(browserWrites, 0)
  assert.deepEqual(calls, [{
    method: 'copySensitiveText',
    text: 'native-secret',
    clearAfterSeconds: Math.ceil(SENSITIVE_CLIPBOARD_TTL_MS / 1000)
  }])

  await clearSensitiveClipboard()
  assert.deepEqual(calls, [
    {
      method: 'copySensitiveText',
      text: 'native-secret',
      clearAfterSeconds: Math.ceil(SENSITIVE_CLIPBOARD_TTL_MS / 1000)
    },
    { method: 'clearSensitiveClipboard' }
  ])

  // Falls back to browser clipboard if native clipboard returns ok: false
  const failingBridge = {
    async copySensitiveText() { return { ok: false } },
    async clearSensitiveClipboard() { return { ok: false } }
  }
  await copySensitiveText('fallback-secret', browserClipboard, () => 100, () => {}, failingBridge)
  assert.equal(browserWrites, 1)
  await clearSensitiveClipboard(null)
})
