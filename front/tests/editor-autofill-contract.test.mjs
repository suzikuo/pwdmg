import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')
const customFieldSource = readFileSync(new URL('../src/components/editor/CustomFieldEditor.vue', import.meta.url), 'utf8')
const editorFields = editorSource.match(/<van-field\b[^>]*>/g) ?? []

test('entry create and edit form suppresses browser-native profile autofill', () => {
  assert.match(editorSource, /<van-form id="entry-editor-form" class="editor-form" autocomplete="off"/)
  assert.equal(editorFields.length, 9)
  assert.equal(editorFields.filter((field) => /autocomplete="off"/.test(field)).length, 8)
  assert.doesNotMatch(editorSource, /autocomplete="(?:username|email|current-password|tel)"/)
})

test('email and phone keep virtual keyboard hints without profile field semantics', () => {
  const emailField = editorFields.find((field) => field.includes('label="邮箱"')) || ''
  const phoneField = editorFields.find((field) => field.includes('label="手机"')) || ''

  assert.match(emailField, /type="text"/)
  assert.match(emailField, /inputmode="email"/)
  assert.match(emailField, /autocomplete="off"/)
  assert.match(phoneField, /inputmode="tel"/)
  assert.match(phoneField, /autocomplete="off"/)
})

test('password and custom fields cannot restore saved credentials', () => {
  const passwordField = editorFields.find((field) => field.includes('label="密码"')) || ''

  assert.match(passwordField, /autocomplete="new-password"/)
  assert.match(customFieldSource, /:value="field\.label"[\s\S]*?autocomplete="off"/)
  assert.match(customFieldSource, /:autocomplete="field\.type === 'secret' \? 'new-password' : 'off'"/)
})
