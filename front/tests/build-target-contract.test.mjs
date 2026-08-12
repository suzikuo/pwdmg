import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const configSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('file-protocol targets emit classic-script-compatible bundles', () => {
  assert.match(configSource, /const fileProtocolTarget = target === 'desktop' \|\| target === 'android'/)
  assert.match(configSource, /format: 'iife'/)
  assert.match(configSource, /name: 'MyPasswordManager'/)
  assert.match(configSource, /fileProtocolTarget\s*\?\s*\{/)
  assert.match(configSource, /'import\.meta\.env\.MODE': JSON\.stringify\(target\)/)
})

test('HTML entry keeps a visible startup failure path', () => {
  assert.match(indexSource, /data-startup-placeholder/)
  assert.match(indexSource, /window\.setTimeout\(/)
  assert.match(indexSource, /location\.protocol === 'file:'/)
  assert.match(indexSource, /<script type="module" src="\/src\/main\.ts"><\/script>/)
})
