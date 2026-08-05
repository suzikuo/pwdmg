import assert from 'node:assert/strict'
import test from 'node:test'

import { AutoSyncPasswordGate } from '../src/services/autoSyncPasswordGate.ts'

test('password mismatch gate blocks aliases once and suppresses repeated automatic attempts', () => {
  const gate = new AutoSyncPasswordGate()
  const primary = JSON.stringify(['oss-cn-hangzhou', 'personal', 'vault.json'])
  const alias = JSON.stringify(['oss-cn-hangzhou', 'personal', 'vault.v2.json'])

  assert.equal(gate.block(primary, alias), true)
  assert.equal(gate.isBlocked(primary), true)
  assert.equal(gate.isBlocked(alias), true)
  assert.equal(gate.block(primary), false)
})

test('same object name in another bucket remains independent', () => {
  const gate = new AutoSyncPasswordGate()
  const personal = JSON.stringify(['oss-cn-hangzhou', 'personal', 'vault.json'])
  const work = JSON.stringify(['oss-cn-hangzhou', 'work', 'vault.json'])

  gate.block(personal)

  assert.equal(gate.isBlocked(personal), true)
  assert.equal(gate.isBlocked(work), false)
})

test('successful remote writes and lock can reopen automatic checks', () => {
  const gate = new AutoSyncPasswordGate()
  const primary = JSON.stringify(['oss-cn-hangzhou', 'personal', 'vault.json'])
  const alias = JSON.stringify(['oss-cn-hangzhou', 'personal', 'vault.v2.json'])
  gate.block(primary, alias)

  gate.clear(primary, alias)
  assert.equal(gate.isBlocked(primary, alias), false)
  assert.equal(gate.block(primary), true)

  gate.clearAll()
  assert.equal(gate.isBlocked(primary), false)
})
