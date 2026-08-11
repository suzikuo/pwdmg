import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeAutofillMatchMode,
  normalizeAutofillRuleValues
} from '../src/services/autofillRules.ts'

test('missing and unknown autofill modes preserve the legacy base-domain behavior', () => {
  assert.equal(normalizeAutofillMatchMode(undefined), 'base-domain')
  assert.equal(normalizeAutofillMatchMode('regex'), 'base-domain')
  assert.equal(normalizeAutofillMatchMode('never'), 'never')
})

test('host rules strip schemes and paths while retaining wildcard compatibility', () => {
  assert.deepEqual(
    normalizeAutofillRuleValues('https://www.Example.com/login\n*.example.net', 'exact-host'),
    ['www.example.com', '*.example.net']
  )
})

test('exact-host and subdomain rules preserve www while base-domain keeps legacy normalization', () => {
  assert.deepEqual(normalizeAutofillRuleValues('www.example.com', 'base-domain'), ['example.com'])
  assert.deepEqual(normalizeAutofillRuleValues('www.example.com', 'exact-host'), ['www.example.com'])
  assert.deepEqual(normalizeAutofillRuleValues('www.example.com', 'subdomain'), ['www.example.com'])
})

test('URL-prefix rules require explicit HTTP(S) URLs and remove fragments', () => {
  assert.deepEqual(
    normalizeAutofillRuleValues('example.com\nhttps://Example.com/account#section', 'url-prefix'),
    ['https://example.com/account']
  )
})
