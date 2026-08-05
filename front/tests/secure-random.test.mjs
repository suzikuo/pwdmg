import assert from 'node:assert/strict'
import test from 'node:test'

import { secureRandomId } from '../src/services/secureRandom.ts'

test('secure ID generation uses UUID or cryptographic random bytes and never weak fallback', () => {
  assert.equal(secureRandomId({ randomUUID: () => 'fixed-uuid' }), 'fixed-uuid')
  assert.equal(
    secureRandomId({ getRandomValues: (values) => values.fill(0xab) }),
    'ab'.repeat(16)
  )
  assert.throws(() => secureRandomId({}), /secure random/i)
})
