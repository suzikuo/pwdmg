import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')
const customFieldSource = readFileSync(new URL('../src/components/editor/CustomFieldEditor.vue', import.meta.url), 'utf8')

function extractControlTag(source, id) {
  const match = source.match(new RegExp(`<(?:UiInput|input)\\b[^>]*id="${id}"[^>]*>`, 's'))
  return match ? match[0] : ''
}

test('entry create and edit form suppresses browser-native profile autofill', () => {
  assert.match(editorSource, /<form[\s\S]*?id="entry-editor-form"[\s\S]*?class="editor-form"[\s\S]*?autocomplete="off"/)
  assert.doesNotMatch(editorSource, /autocomplete="(?:username|email|current-password|tel)"/)
  assert.doesNotMatch(editorSource, /<van-field\b/)
  assert.match(extractControlTag(editorSource, 'editor-field-title'), /autocomplete="off"/)
  assert.match(extractControlTag(editorSource, 'editor-field-username'), /autocomplete="off"/)
  assert.match(extractControlTag(editorSource, 'editor-field-domain'), /autocomplete="off"/)
  assert.match(extractControlTag(editorSource, 'editor-field-totp'), /autocomplete="off"/)
})

test('email and phone keep virtual keyboard hints without profile field semantics', () => {
  const emailField = extractControlTag(editorSource, 'editor-field-email')
  const phoneField = extractControlTag(editorSource, 'editor-field-phone')

  assert.match(emailField, /type="text"/)
  assert.match(emailField, /inputmode="email"/)
  assert.match(emailField, /autocomplete="off"/)
  assert.match(phoneField, /type="text"/)
  assert.match(phoneField, /inputmode="tel"/)
  assert.match(phoneField, /autocomplete="off"/)
})

test('password and custom fields cannot restore saved credentials', () => {
  const passwordField = extractControlTag(editorSource, 'editor-field-password')

  assert.match(passwordField, /autocomplete="new-password"/)
  assert.match(customFieldSource, /:value="field\.label"[\s\S]*?autocomplete="off"/)
  assert.match(customFieldSource, /:autocomplete="field\.type === 'secret' \? 'new-password' : 'off'"/)
})
