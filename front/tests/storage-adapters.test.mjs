import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const services = new URL('../src/services/', import.meta.url).href
const indexedDbModule = new URL('indexedDbStore.ts', services).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(services) && /^\.\.?\/[^.]+$/.test(specifier)) {
      const path = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(path)) return nextResolve(path.href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === indexedDbModule) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export const idbGet = (key) => globalThis.testStorage.get(key)
          export const idbRunReadwrite = (fn) => globalThis.testStorage.runReadwrite(fn)
        `
      }
    }
    if (url.startsWith(services) && url.endsWith('.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(
          readFileSync(new URL(url), 'utf8').replaceAll('import.meta.env', 'globalThis.testStorageEnv'),
          { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
        ).outputText
      }
    }
    return nextLoad(url, context)
  }
})

globalThis.testStorageEnv = { MODE: 'android' }
const { api } = await import('../src/services/api.ts')
const { webStorageAdapter } = await import('../src/services/webStorageAdapter.ts')
const { defaultVaultPayload } = await import('../src/services/vaultDefaults.ts')
hooks.deregister()

const success = (data) => JSON.stringify({ ok: true, data })
const failure = (code, message) => JSON.stringify({ ok: false, code, message })

test('Android attachments use the active native vault for creation, reading, ciphertext sync, and export', async (t) => {
  const objects = new Map()
  let activeVault = defaultVaultPayload()
  const getVault = t.mock.fn(() => activeVault ? success(activeVault) : failure('LOCKED', 'Vault is locked'))
  const lock = t.mock.fn(() => {
    activeVault = null
    return success({ locked: true })
  })
  const exportFile = t.mock.fn(() => success({ id: 'export-1', status: 'done', result: { saved: true, path: 'content://export' } }))
  globalThis.window = {
    androidPasswordApi: {
      getVault,
      lock,
      saveVault: (text) => success(activeVault = JSON.parse(text)),
      readAttachmentObject: (id) => success(objects.get(id)),
      writeAttachmentObject: (id, text) => success(objects.set(id, text) && { attachmentId: id }),
      startAttachmentExport: exportFile,
      getAttachmentExportTaskState: () => assert.fail('completed export should not poll')
    }
  }
  t.after(() => { delete globalThis.window })

  const bytes = new TextEncoder().encode('attachment bytes')
  const created = await api.createAttachmentObject('example.txt', 'text/plain', bytes)
  assert.equal(created.ok, true, created.message)
  const { reference, vault } = created.data
  assert.ok(vault.attachmentKey)
  await api.saveVault(vault)

  assert.deepEqual((await api.readAttachmentBytes(reference)).data, bytes)
  const ciphertext = await api.readAttachmentCiphertext(reference)
  assert.equal(ciphertext.data, objects.get(reference.id))
  assert.equal((await api.writeAttachmentCiphertext(reference, ciphertext.data)).ok, true)
  assert.deepEqual((await api.saveAttachmentToFile(reference)).data, { saved: true, path: 'content://export' })
  assert.deepEqual(exportFile.mock.calls[0].arguments, ['example.txt', 'text/plain', Buffer.from(bytes).toString('base64')])
  assert.equal(getVault.mock.callCount(), 5)
  assert.equal(lock.mock.callCount(), 0)

  assert.equal((await api.lock()).ok, true)
  assert.equal((await api.readAttachmentBytes(reference)).code, 'LOCKED')
  assert.equal(lock.mock.callCount(), 1)
})

test('maps a generic backend revision mismatch to CONFLICT', async (t) => {
  const mismatch = () => failure('ERROR', 'Vault revision mismatch')
  globalThis.window = { androidPasswordApi: { getVault: mismatch, saveVault: mismatch } }
  t.after(() => { delete globalThis.window })
  assert.equal((await api.saveVault(defaultVaultPayload())).code, 'CONFLICT')
  window.androidPasswordApi.getVault = () => success(defaultVaultPayload())
  window.androidPasswordApi.writeAttachmentObject = mismatch
  assert.equal((await api.createAttachmentObject('example.txt', 'text/plain', new Uint8Array([1]))).code, 'CONFLICT')
})

test('Web vault writes validate revision and downgrade and back up the replaced vault in one transaction', async (t) => {
  const stored = new Map([['vault', { version: 2, revision: 7 }]])
  const operations = []
  globalThis.testStorage = {
    get: () => assert.fail('vault writes must keep reads in the write transaction'),
    async runReadwrite(fn) {
      const writes = new Map()
      const result = await fn({
        async get(key) {
          operations.push(`get ${key}`)
          return stored.get(key) ?? null
        },
        set(key, value) {
          operations.push(`set ${key}`)
          writes.set(key, value)
        }
      })
      for (const [key, value] of writes) stored.set(key, value)
      return result
    }
  }
  t.after(() => { delete globalThis.testStorage })

  const backup = JSON.stringify({ version: 2, revision: 4 })
  const conflict = await webStorageAdapter.writeVaultEnvelope(backup, true, 6)
  assert.equal(conflict.code, 'CONFLICT')
  assert.deepEqual(operations.splice(0), ['get vault'])
  assert.equal(stored.has('importBackups'), false)
  const invalidAdvance = await webStorageAdapter.writeVaultEnvelope(backup, false, 7)
  assert.equal(invalidAdvance.code, 'CONFLICT')
  assert.deepEqual(operations.splice(0), ['get vault'])
  const downgrade = await webStorageAdapter.writeVaultEnvelope('{"version":1,"revision":8}', true, 7)
  assert.equal(downgrade.ok, false)
  assert.deepEqual(operations.splice(0), ['get vault'])

  const imported = await webStorageAdapter.writeVaultEnvelope(backup, true, 7)
  assert.equal(imported.ok, true, imported.message)
  assert.deepEqual(operations, ['get vault', 'get importBackups', 'set importBackups', 'set vault'])
  assert.deepEqual(stored.get('vault'), { version: 2, revision: 4 })
  assert.deepEqual(JSON.parse(stored.get('importBackups')[0].content), { version: 2, revision: 7 })
})

test('Desktop mode routes vault operations, quickUnlock, and attachments through Rust native desktop_api without JS vaultKey', async (t) => {
  const prevEnv = globalThis.testStorageEnv
  globalThis.testStorageEnv = { MODE: 'desktop' }
  const objects = new Map()
  const calls = []
  let activeVault = null

  const invoke = t.mock.fn(async (cmd, payload) => {
    assert.equal(cmd, 'desktop_api')
    const { method, args } = payload
    calls.push({ method, args })

    switch (method) {
      case 'getState':
        return {
          ok: true,
          data: {
            hasVault: true,
            locked: !activeVault,
            expiresAt: activeVault ? 9999999999 : 0,
            legacyAvailable: false,
            vaultPath: 'C:\\vault.json',
            passwordless: false
          }
        }
      case 'quickUnlock':
        activeVault = defaultVaultPayload()
        activeVault.entries = [{ id: 'e1', kind: 'login', title: 'Quick', domains: ['example.com'] }]
        return {
          ok: true,
          data: {
            state: { hasVault: true, locked: false, expiresAt: 9999999999, legacyAvailable: false, vaultPath: 'C:\\vault.json', passwordless: false },
            payload: activeVault
          }
        }
      case 'getVault':
        return activeVault
          ? { ok: true, data: activeVault }
          : { ok: false, code: 'LOCKED', message: 'Vault is locked' }
      case 'saveVault': {
        const [nextPayload, expectedRevision] = args
        if (!activeVault) return { ok: false, code: 'LOCKED', message: 'Vault is locked' }
        if (expectedRevision !== activeVault.revision) {
          return { ok: false, code: 'CONFLICT', message: `Conflict: current revision is ${activeVault.revision}, expected ${expectedRevision}` }
        }
        activeVault = { ...nextPayload, revision: activeVault.revision + 1 }
        return { ok: true, data: { saved: true, revision: activeVault.revision, payload: activeVault } }
      }
      case 'changePassword':
      case 'changePasswordVerified':
        return {
          ok: true,
          data: {
            state: { hasVault: true, locked: false, expiresAt: 9999999999, legacyAvailable: false, vaultPath: 'C:\\vault.json', passwordless: false },
            payload: activeVault
          }
        }
      case 'adoptEncryptionFromEnvelope':
        return {
          ok: true,
          data: {
            state: { hasVault: true, locked: false, expiresAt: 9999999999, legacyAvailable: false, vaultPath: 'C:\\vault.json', passwordless: false },
            payload: activeVault
          }
        }
      case 'exportBackup':
      case 'exportBackupForPayload':
        return { ok: true, data: { content: '{"v":2}', vaultPath: 'C:\\vault.json', updatedAt: 123 } }
      case 'previewBackup':
      case 'previewBackupWithPassword':
        return { ok: true, data: { payload: defaultVaultPayload() } }
      case 'importBackup':
        activeVault = null
        return {
          ok: true,
          data: {
            state: { hasVault: true, locked: true, expiresAt: 0, legacyAvailable: false, vaultPath: 'C:\\vault.json', passwordless: false },
            backupPath: 'C:\\vault.bak',
            vaultPath: 'C:\\vault.json'
          }
        }
      case 'lock':
        activeVault = null
        return {
          ok: true,
          data: { hasVault: true, locked: true, expiresAt: 0, legacyAvailable: false, vaultPath: 'C:\\vault.json', passwordless: false }
        }
      case 'writeAttachmentObject':
        objects.set(args[0], args[1])
        return { ok: true, data: { attachmentId: args[0], objectBytes: String(args[1]).length } }
      case 'readAttachmentObject':
        return { ok: true, data: objects.get(args[0]) }
      case 'saveAttachmentFile':
        return { ok: true, data: { saved: true, path: 'C:\\Downloads\\doc.txt' } }
      default:
        assert.fail(`Unexpected desktop_api method: ${method}`)
    }
  })

  globalThis.window = {
    __TAURI_INTERNALS__: { invoke }
  }
  t.after(() => {
    delete globalThis.window
    globalThis.testStorageEnv = prevEnv
  })

  // Quick unlock goes straight to native quickUnlock (never readDeviceUnlockKey or readVaultEnvelope)
  const quick = await api.quickUnlock()
  assert.equal(quick.ok, true, quick.message)
  assert.equal(quick.data.entries[0].title, 'Quick')
  assert.equal(calls.some((c) => c.method === 'readDeviceUnlockKey' || c.method === 'readVaultEnvelope'), false)

  // Attachments work without any JS vaultKey (using native getVault for attachmentKey)
  const bytes = new TextEncoder().encode('desktop native attachment')
  const created = await api.createAttachmentObject('doc.txt', 'text/plain', bytes)
  assert.equal(created.ok, true, created.message)
  const { reference, vault } = created.data
  assert.ok(vault.attachmentKey)

  const saved = await api.saveVault(vault)
  assert.equal(saved.ok, true, saved.message)
  assert.equal(saved.data.revision, 2)
  assert.deepEqual((await api.readAttachmentBytes(reference)).data, bytes)
  const ciphertext = await api.readAttachmentCiphertext(reference)
  assert.equal(ciphertext.ok, true)
  assert.equal(ciphertext.data, objects.get(reference.id))
  assert.equal((await api.writeAttachmentCiphertext(reference, ciphertext.data)).ok, true)
  assert.deepEqual((await api.saveAttachmentToFile(reference)).data, { saved: true, path: 'C:\\Downloads\\doc.txt' })

  // Stale revision surfaces CONFLICT
  const stale = await api.saveVault({ ...vault, revision: 1 })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'CONFLICT')

  // Password change (single-arg and verified two-arg) and backup/preview/adopt calls route to native Rust
  assert.equal((await api.changePassword('next-pw')).ok, true)
  assert.equal((await api.changePassword('next-pw-2', 'next-pw')).ok, true)
  assert.equal(calls.some((c) => c.method === 'changePasswordVerified' && c.args[0] === 'next-pw' && c.args[1] === 'next-pw-2'), true)
  assert.equal((await api.adoptVaultEncryptionFromEnvelope('{}', 'pw')).ok, true)
  assert.equal((await api.exportVaultBackup()).data.content, '{"v":2}')
  assert.equal((await api.exportVaultBackupForPayload(saved.data)).data.content, '{"v":2}')
  assert.equal((await api.previewVaultBackup('{}')).ok, true)
  assert.equal((await api.previewVaultBackupWithPassword('{}', 'pw')).ok, true)
  assert.equal((await api.importVaultBackup('{}')).ok, true)

  // Locked state propagates to attachment reads
  assert.equal((await api.readAttachmentBytes(reference)).code, 'LOCKED')
})

test('subscribeNativeLock wires Tauri vault-locked events and cleans up safely', async (t) => {
  const prevEnv = globalThis.testStorageEnv
  globalThis.testStorageEnv = { MODE: 'desktop' }
  let registeredHandler = null
  const unlisten = t.mock.fn()
  const listen = t.mock.fn(async (eventName, handler) => {
    assert.equal(eventName, 'vault-locked')
    registeredHandler = handler
    return unlisten
  })
  globalThis.window = {
    __TAURI__: { event: { listen } }
  }
  t.after(() => {
    delete globalThis.window
    globalThis.testStorageEnv = prevEnv
  })

  const reasons = []
  const unsubscribe = api.subscribeNativeLock((reason) => reasons.push(reason))
  assert.equal(listen.mock.callCount(), 1)
  await Promise.resolve()

  registeredHandler({ payload: { reason: 'tray', state: { locked: true } } })
  assert.deepEqual(reasons, ['tray'])

  unsubscribe()
  assert.equal(unlisten.mock.callCount(), 1)
  registeredHandler({ payload: { reason: 'tray' } })
  assert.deepEqual(reasons, ['tray'])

  // Non-desktop modes return a safe no-op
  globalThis.testStorageEnv = { MODE: 'web' }
  const noop = api.subscribeNativeLock(() => assert.fail('should not register on web'))
  assert.equal(typeof noop, 'function')
  noop()
  assert.equal(listen.mock.callCount(), 1)
})
