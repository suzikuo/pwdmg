import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styleSource = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')

const compactBlock = styleSource.slice(styleSource.indexOf('@media (max-width: 620px)'), styleSource.indexOf('.passkey-manager-popup.van-popup'))

test('entry editor keeps natural-height rows in an independently scrollable form', () => {
  assert.match(styleSource, /\.editor-form \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow-y: auto;[^}]*touch-action: pan-y;/s)
  assert.match(styleSource, /\.editor-form > \* \{\s*flex: 0 0 auto;/)
  assert.match(styleSource, /\.editor-field\.van-cell,[\s\S]*?\.editor-field\.van-field \{[^}]*padding: 7px 12px;[^}]*overflow: hidden;/)
  assert.match(styleSource, /\.editor-field-single \.van-field__control \{[^}]*height: auto;[^}]*white-space: nowrap;/)
})

test('phone-sized entry editor keeps standard fields in the compact two-column layout', () => {
  const singleFieldBlock = compactBlock.match(
    /\.editor-field-single \.van-field__control \{(?<body>[^}]*)\}/,
  )?.groups?.body ?? ''

  assert.match(styleSource, /\.editor-field\.van-cell,\s*\n\.editor-field\.van-field \{[^}]*display: flex;[^}]*padding: 7px 12px;/s)
  assert.match(styleSource, /\.editor-field \.van-field__label \{[^}]*width: var\(--editor-label-width\);[^}]*min-width: var\(--editor-label-width\);/s)
  assert.match(styleSource, /\.editor-field \.van-field__value,\s*\n\.editor-field \.van-field__body \{[^}]*min-height: 32px;[^}]*overflow: hidden;/s)
  assert.doesNotMatch(compactBlock, /\.editor-field\.van-cell,\s*\n\s*\.editor-field\.van-field \{[^}]*display: block;/s)
  assert.equal(singleFieldBlock, '')
  assert.match(compactBlock, /\.editor-field-area \.van-field__control \{[\s\S]*?min-height: 58px;[\s\S]*?max-height: 144px;[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(compactBlock, /\.autofill-rule-field select \{[\s\S]*?width: 100%;[\s\S]*?min-height: 34px;[\s\S]*?box-sizing: border-box;/)
  assert.match(styleSource, /\.editor-field\.van-field:focus-within \{\s*box-shadow: none;/)
})

test('phone-sized account source options keep the earlier wrapping horizontal row', () => {
  assert.match(editorSource, /class="account-source-options"/)
  assert.match(styleSource, /\.account-source-options \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(compactBlock, /\.account-source-options \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/)
  assert.match(compactBlock, /\.account-source-options \.van-radio \{[\s\S]*?min-width: 0;[\s\S]*?min-height: 28px;/)
})

test('native editor selects use explicit light and dark theme surfaces', () => {
  assert.match(styleSource, /:root \{[\s\S]*?--surface-container-low: #f9f7fe;[\s\S]*?color-scheme: light;/)
  assert.match(styleSource, /:root\[data-theme='dark'\] \{[\s\S]*?--surface-container-low: #18171d;[\s\S]*?color-scheme: dark;/)
  assert.match(styleSource, /select,\s*\nselect option \{[^}]*color: var\(--text-main\);[^}]*background-color: var\(--surface-container-low\);/s)
  assert.match(styleSource, /select option:checked \{[^}]*color: var\(--on-brand-container\);[^}]*background-color: var\(--brand-container\);/s)
  assert.match(styleSource, /\.autofill-rule-field select \{[^}]*background: var\(--surface-container-low\);/s)
})
