import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generatePassphrase,
  generatePassword,
  generateUsername,
  randomInteger
} from '../src/services/credentialGenerator.ts'

function deterministicSource(seed = 1) {
  let state = seed >>> 0
  return {
    getRandomValues(values) {
      for (let index = 0; index < values.length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        values[index] = state
      }
      return values
    }
  }
}

test('password generation covers enabled sets and excludes ambiguous characters', () => {
  const value = generatePassword({ length: 32 }, deterministicSource())
  assert.equal(value.length, 32)
  assert.match(value, /[A-Z]/)
  assert.match(value, /[a-z]/)
  assert.match(value, /[0-9]/)
  assert.match(value, /[^A-Za-z0-9]/)
  assert.doesNotMatch(value, /[Il1O0o|`'"]/)
})

test('password generation fails closed when every character set is disabled', () => {
  assert.throws(() => generatePassword({ uppercase: false, lowercase: false, digits: false, symbols: false }, deterministicSource()))
})

test('passphrases use the selected shape and remain readable', () => {
  const value = generatePassphrase({ words: 4, separator: '.', capitalize: false, includeNumber: true }, deterministicSource(9))
  const parts = value.split('.')
  assert.equal(parts.length, 5)
  assert.ok(parts.slice(0, 4).every((part) => /^[a-z]+$/.test(part)))
  assert.match(parts[4], /^\d{2}$/)
})

test('username generation supports random and plus-addressed forms', () => {
  assert.match(generateUsername({ digits: 5 }, deterministicSource(3)), /^[a-z]+\d{5}$/)
  assert.match(
    generateUsername({ mode: 'plus-address', email: 'Alice+old@Example.com', digits: 3 }, deterministicSource(4)),
    /^alice\+[a-z]+\d{3}@example\.com$/
  )
  assert.throws(() => generateUsername({ mode: 'plus-address', email: 'invalid' }, deterministicSource()))
})

test('bounded random integers stay inside the requested range', () => {
  const source = deterministicSource(12)
  for (let index = 0; index < 100; index += 1) {
    const value = randomInteger(7, source)
    assert.ok(value >= 0 && value < 7)
  }
})
