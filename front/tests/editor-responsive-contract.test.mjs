import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const tokensSource = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const baseSource = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')

test('entry editor supports both inline desktop pane and modal sheet with scrollable body', () => {
  assert.match(editorSource, /inline\?: boolean/)
  assert.match(editorSource, /\.editor-inline-body\)?\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s)
  assert.match(editorSource, /\.editor-form\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*touch-action:\s*pan-y;/s)
})

test('entry editor uses responsive two-column rows and wrapping account source options', () => {
  assert.match(editorSource, /\.editor-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s)
  assert.match(editorSource, /class="account-source-options"/)
  assert.match(editorSource, /\.account-source-options\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s)
})

test('native selects use explicit light and dark theme surfaces', () => {
  assert.match(tokensSource, /:root\s*\{[\s\S]*?color-scheme:\s*light;[\s\S]*?--surface-container-low:/)
  assert.match(tokensSource, /:root\[data-theme='dark'\]\s*\{[\s\S]*?color-scheme:\s*dark;[\s\S]*?--surface-container-low:/)
  assert.match(baseSource, /select\s*\{[^}]*background-color:\s*var\(--panel-bg\);[^}]*color:\s*var\(--text-main\);/s)
  assert.match(baseSource, /:root\[data-theme='dark'\]\s+select,[\s\S]*?color-scheme:\s*dark;/)
})
