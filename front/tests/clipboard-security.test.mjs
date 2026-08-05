import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/services/clipboardSecurity.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, setTimeout, clearTimeout, navigator: undefined })
const { clearSensitiveClipboard, copySensitiveText, SENSITIVE_CLIPBOARD_TTL_MS } = module.exports

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
  scheduled()
  await new Promise((resolve) => setImmediate(resolve))
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
  scheduled()
  await new Promise((resolve) => setImmediate(resolve))
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
