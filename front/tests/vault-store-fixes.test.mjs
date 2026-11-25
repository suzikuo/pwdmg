import assert from 'node:assert/strict'
import test from 'node:test'

import { createUiStore } from '../src/stores/uiStore.ts'
import { createVaultStore, emptyEntry } from '../src/stores/vaultStore.ts'
import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'

function createHarness(options = {}) {
  const ui = createUiStore()
  let busy = false
  let busyOpId = 0
  const toasts = { info: [], success: [], fail: [] }
  let saveCalls = 0
  let saveImpl = options.saveImpl || (async (next) => ({
    ok: true,
    data: { ...JSON.parse(JSON.stringify(next)), revision: (next.revision || 1) + 1 }
  }))

  const feedback = {
    toast: (msg) => toasts.info.push(msg),
    successToast: (msg) => toasts.success.push(msg),
    failToast: (msg) => toasts.fail.push(msg),
    confirm: async () => {}
  }

  const store = createVaultStore({
    ui,
    feedback,
    isLocked: () => false,
    isUnlocked: () => Boolean(store.vault.value),
    isBusy: () => busy,
    beginBusyOperation: () => {
      busyOpId += 1
      busy = true
      return busyOpId
    },
    finishBusyOperation: (id) => {
      if (id === busyOpId) busy = false
    },
    saveVaultForCurrentSession: async (next) => {
      saveCalls += 1
      return saveImpl(next)
    }
  })

  const payload = defaultVaultPayload()
  const login = {
    ...emptyEntry('login'),
    id: 'login-1',
    title: 'GitHub',
    username: 'alice',
    password: 'Secret!Password123',
    domains: ['github.com'],
    history: [
      {
        id: 'hist-1',
        action: 'updated',
        at: 1700000000,
        title: 'GitHub Old',
        username: 'alice',
        email: '',
        phone: '',
        domains: ['github.com'],
        note: 'old',
        changes: [],
        snapshot: {
          title: 'GitHub Old',
          username: 'alice',
          email: '',
          password: 'OldPassword123',
          phone: '',
          domains: ['github.com'],
          note: '',
          totpSecret: '',
          customFields: []
        }
      }
    ]
  }
  const folder = {
    ...emptyEntry('folder'),
    id: 'folder-1',
    title: 'Work',
    children: []
  }
  payload.entries = [login, folder]
  store.publishVaultPayload(payload)

  return {
    ui,
    store,
    toasts,
    getSaveCalls: () => saveCalls,
    setBusy: (value) => { busy = value },
    isBusy: () => busy,
    setSaveImpl: (fn) => { saveImpl = fn }
  }
}

test('switchEditorKind clears login-only fields when switching a new entry to secure-note or folder', () => {
  const { store } = createHarness()

  store.openCreate('login')
  store.form.title = 'My Note'
  store.form.note = 'Keep this note'
  store.form.username = 'secret-user'
  store.form.password = 'super-secret-pass'
  store.form.email = 'alice@example.com'
  store.form.phone = '13800000000'
  store.form.totpSecret = 'JBSWY3DPEHPK3PXP'
  store.domainText.value = 'example.com'

  store.switchEditorKind('secure-note')
  assert.equal(store.form.kind, 'secure-note')
  assert.equal(store.form.title, 'My Note')
  assert.equal(store.form.note, 'Keep this note')
  assert.equal(store.form.username, '')
  assert.equal(store.form.password, '')
  assert.equal(store.form.email, '')
  assert.equal(store.form.phone, '')
  assert.equal(store.form.totpSecret, '')
  assert.equal(store.domainText.value, '')

  // Also test switching from login to folder
  store.openCreate('login')
  store.form.title = 'Personal'
  store.form.username = 'bob'
  store.form.password = 'pw'
  store.form.email = 'bob@example.com'
  store.form.phone = '13900000000'
  store.form.totpSecret = 'JBSWY3DPEHPK3PXP'

  store.switchEditorKind('folder')
  assert.equal(store.form.kind, 'folder')
  assert.equal(store.form.title, 'Personal')
  assert.equal(store.form.username, '')
  assert.equal(store.form.password, '')
  assert.equal(store.form.email, '')
  assert.equal(store.form.phone, '')
  assert.equal(store.form.totpSecret, '')
})

test('saveEntry does not open mobile detail sheet when saving a folder', async () => {
  const { ui, store } = createHarness()
  ui.isWide.value = false

  store.openCreate('folder')
  store.form.title = 'Finance'
  await store.saveEntry()

  assert.equal(ui.editorOpen.value, false)
  assert.equal(ui.detailOpen.value, false)

  store.openCreate('login')
  store.form.title = 'Bank'
  await store.saveEntry()

  assert.equal(ui.editorOpen.value, false)
  assert.equal(ui.detailOpen.value, true)
})

test('handleUndoTrash checks restoreEntry return status before showing undo success toast', async () => {
  const { store, toasts, setSaveImpl } = createHarness()

  await store.trashEntry('login-1')
  assert.ok(store.trashUndoState.value)

  // Simulate restore failure
  setSaveImpl(async () => ({ ok: false, code: 'IO_ERROR', message: 'disk error' }))
  await store.handleUndoTrash()
  assert.equal(toasts.success.includes('已撤销删除'), false)
  assert.equal(toasts.fail.includes('disk error'), true)

  // Restore succeeds on retry
  setSaveImpl(async (next) => ({ ok: true, data: { ...next, revision: next.revision + 1 } }))
  store.trashUndoState.value = { id: 'login-1', title: 'GitHub', timer: 0 }
  await store.handleUndoTrash()
  assert.deepEqual(toasts.success, ['已撤销删除'])
})

test('archiveEntry does not silently mutate drawerSection or systemGroupKey when drawer is closed', async () => {
  const { ui, store } = createHarness()
  ui.drawerOpen.value = false
  ui.drawerSection.value = 'settings'
  ui.systemGroupKey.value = 'trashed'

  await store.archiveEntry('login-1')

  assert.equal(ui.drawerSection.value, 'settings')
  assert.equal(ui.systemGroupKey.value, 'trashed')
})

test('busy guard prevents overlapping vault mutations in archive, trash, restore, purge, restoreHistory, and move', async () => {
  const { store, setBusy, getSaveCalls } = createHarness()

  setBusy(true)
  await store.archiveEntry('login-1')
  await store.trashEntry('login-1')
  const restored = await store.restoreEntry('login-1')
  await store.purgeEntry('login-1')
  await store.restoreEntryHistory('login-1', 'hist-1')
  await store.moveEntry({ entryId: 'login-1', targetParentId: 'folder-1', targetIndex: 0 })

  assert.equal(restored, false)
  assert.equal(getSaveCalls(), 0)

  // Verify moveEntry acquires and releases busy lock cleanly when not busy
  setBusy(false)
  let sawBusyDuringSave = false
  const h2 = createHarness({
    saveImpl: async (next) => {
      sawBusyDuringSave = h2.isBusy()
      return { ok: true, data: { ...next, revision: next.revision + 1 } }
    }
  })
  await h2.store.moveEntry({ entryId: 'login-1', targetParentId: 'folder-1', targetIndex: 0 })
  assert.equal(sawBusyDuringSave, true)
  assert.equal(h2.isBusy(), false)
})

test('moreActions exposes QuickAccess, CredentialGenerator, and ImportWizard and opens their overlays', () => {
  const { ui, store } = createHarness()
  const keys = store.moreActions.value.map((action) => action.key)

  assert.ok(keys.includes('quick-access'))
  assert.ok(keys.includes('generator'))
  assert.ok(keys.includes('import'))

  store.handleMoreAction({ key: 'quick-access' })
  assert.equal(ui.quickAccessOpen.value, true)

  store.handleMoreAction({ key: 'generator' })
  assert.equal(ui.generatorOpen.value, true)
  assert.equal(store.generatorApplyToPassword.value, false)

  store.handleMoreAction({ key: 'import' })
  assert.equal(ui.importOpen.value, true)
})
