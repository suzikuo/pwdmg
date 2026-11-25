import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createAppStores } from '../src/stores/index.ts'
import { DESKTOP_QUERY } from '../src/stores/uiStore.ts'

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const uiStoreSource = readFileSync(new URL('../src/stores/uiStore.ts', import.meta.url), 'utf8')

function walkFiles(dir) {
  const results = []
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath))
    } else if (/\.(vue|ts|js|css)$/.test(name)) {
      results.push(fullPath)
    }
  }
  return results
}

function makeSampleVault() {
  const now = '2026-11-25T10:00:00.000Z'
  return {
    version: 3,
    revision: 1,
    updatedAt: now,
    settings: {
      oss: {
        bucketName: '',
        region: '',
        accessKeyId: '',
        accessKeySecret: '',
        objectName: 'pwd/mypwdmg-vault.json',
        autoSync: false,
        autoSyncIntervalMinutes: 10
      }
    },
    entries: [
      {
        id: 'folder-work',
        kind: 'folder',
        title: '工作',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        children: [
          {
            id: 'login-github',
            kind: 'login',
            title: 'GitHub',
            username: 'octocat',
            password: 'secret-password',
            domains: ['github.com'],
            status: 'active',
            createdAt: now,
            updatedAt: now
          }
        ]
      },
      {
        id: 'login-personal',
        kind: 'login',
        title: 'Personal Mail',
        username: 'me@example.com',
        password: 'mail-password',
        domains: ['example.com'],
        status: 'active',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'login-archived',
        kind: 'login',
        title: 'Old Bank',
        username: 'olduser',
        password: 'old-password',
        domains: ['oldbank.example'],
        status: 'disabled',
        statusReason: '已停用',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'login-trashed',
        kind: 'login',
        title: 'Deleted Service',
        username: 'deluser',
        password: 'del-password',
        domains: ['deleted.example'],
        status: 'trashed',
        statusReason: '已移入回收站',
        createdAt: now,
        updatedAt: now
      }
    ],
    passkeys: []
  }
}

test('sidebar view filtering supports all, favorites, recent, archived, trash, and folder with read-only preview', () => {
  const stores = createAppStores()
  stores.session.state.locked = false
  const payload = makeSampleVault()
  stores.vault.publishVaultPayload(payload)

  // Default 'all' shows active tree (folder + root active login)
  assert.equal(stores.vault.sidebarView.value, 'all')
  assert.deepEqual(
    stores.vault.filteredEntries.value.map((e) => e.id),
    ['folder-work', 'login-personal']
  )

  // Favorites view
  stores.vault.toggleEntryFavorite('login-personal')
  stores.vault.selectSidebarView('favorites')
  assert.deepEqual(
    stores.vault.filteredEntries.value.map((e) => e.id),
    ['login-personal']
  )

  // Recent view (opening an entry records it in recent list)
  stores.vault.selectSidebarView('all')
  const githubEntry = payload.entries[0].children[0]
  stores.vault.openEntry(githubEntry)
  stores.vault.selectSidebarView('recent')
  const collectIds = (list) => list.flatMap((e) => [e.id, ...collectIds(e.children || [])])
  assert.ok(collectIds(stores.vault.filteredEntries.value).includes('login-github'))

  // Folder view
  stores.vault.selectSidebarFolder('folder-work')
  assert.equal(stores.vault.sidebarView.value, 'folder')
  assert.equal(stores.vault.activeFolderId.value, 'folder-work')
  assert.deepEqual(
    stores.vault.filteredEntries.value.map((e) => e.id),
    ['login-github']
  )

  // Archived view & read-only preview
  stores.vault.selectSidebarView('archived')
  assert.deepEqual(
    stores.vault.filteredEntries.value.map((e) => e.id),
    ['login-archived']
  )
  stores.vault.openView(stores.vault.filteredEntries.value[0])
  assert.equal(stores.vault.selectedEntry.value?.id, 'login-archived')

  // Trash view & read-only preview
  stores.vault.selectSidebarView('trash')
  assert.deepEqual(
    stores.vault.filteredEntries.value.map((e) => e.id),
    ['login-trashed']
  )
  stores.vault.openView(stores.vault.filteredEntries.value[0])
  assert.equal(stores.vault.selectedEntry.value?.id, 'login-trashed')
  stores.session.applyLockedUiState()
})

test('desktop breakpoint is unified at 768px in uiStore', () => {
  assert.equal(DESKTOP_QUERY, '(min-width: 768px)')
  assert.match(uiStoreSource, /export const DESKTOP_QUERY = '\(min-width: 768px\)'/)
})

test('entire front/src tree has zero Vant tags/imports, zero app.css references, and zero !important overrides', () => {
  const files = walkFiles(srcRoot)
  assert.ok(files.length > 20, 'expected source files under front/src')

  const violations = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    if (/<van-/.test(content)) violations.push(`${file}: contains <van- tag`)
    if (/from\s+['"]vant(?:\/|['"])/.test(content)) violations.push(`${file}: imports from vant`)
    if (/styles\/app\.css/.test(content)) violations.push(`${file}: references legacy app.css`)
    if (/!important/.test(content)) violations.push(`${file}: contains !important`)
  }
  assert.deepEqual(violations, [])
})

test('App.vue wires global keyboard shortcuts (Ctrl+K, Ctrl+F, Ctrl+N, Ctrl+S, Ctrl+L) and removes global selectstart lock', () => {
  assert.match(appSource, /key === 'k'[\s\S]*?toggleQuickAccessPalette\(\)/)
  assert.match(appSource, /event\.code === 'Space'[\s\S]*?toggleQuickAccessPalette\(\)/)
  assert.match(appSource, /key === 'f'[\s\S]*?headerRef\.value\?\.focusSearch\(\)/)
  assert.match(appSource, /key === 'n'[\s\S]*?vaultStore\.openCreate\('login'\)/)
  assert.match(appSource, /key === 's'[\s\S]*?vaultStore\.saveEntry\(\)/)
  assert.match(appSource, /key === 'l'[\s\S]*?handleQuickLock\(\)/)
  assert.match(appSource, /clearAllFeedback\(\)[\s\S]*?session\.lockVault\(\)/)
  assert.doesNotMatch(appSource, /selectstart/)
  assert.doesNotMatch(appSource, /suppressNonEditableSelection/)
})

test('desktop and android IIFE builds emit a single linked stylesheet and index.html does not force !important background', () => {
  const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(viteConfig, /cssCodeSplit:\s*!fileProtocolTarget/)
  assert.doesNotMatch(indexHtml, /background-color:\s*#111827\s*!important/)
})

test('session.unlocked reactively transitions false -> true -> false after bindVaultBridge', () => {
  const stores = createAppStores()
  assert.equal(stores.session.unlocked.value, false)

  const generation = stores.session.vaultSession.capture()
  const activated = stores.session.activateVaultSession(makeSampleVault(), generation)
  assert.equal(activated, true)
  assert.equal(stores.session.unlocked.value, true)

  stores.session.applyLockedUiState()
  assert.equal(stores.session.unlocked.value, false)
})

test('global PC contextmenu suppression and functional UiContextMenu are wired in App.vue', () => {
  const contextMenuSource = readFileSync(new URL('../src/components/ui/UiContextMenu.vue', import.meta.url), 'utf8')
  assert.match(appSource, /document\.addEventListener\('contextmenu',\s*handleGlobalContextMenu\)/)
  assert.match(appSource, /document\.removeEventListener\('contextmenu',\s*handleGlobalContextMenu\)/)
  assert.match(appSource, /<UiContextMenu[\s\S]*?:open="ui\.entryContextMenuOpen"/)
  assert.match(appSource, /新建登录条目/)
  assert.match(appSource, /锁定保险库/)
  assert.match(contextMenuSource, /<Teleport to="body">/)
  assert.match(contextMenuSource, /role="menu"/)
})

test('multi-layout modes and list styles are wired in VaultWorkspace.vue and EntryList.vue', () => {
  const workspaceSource = readFileSync(new URL('../src/components/workspace/VaultWorkspace.vue', import.meta.url), 'utf8')
  const entryListSource = readFileSync(new URL('../src/components/EntryList.vue', import.meta.url), 'utf8')
  assert.match(workspaceSource, /layoutMode === 'top-nav-split'/)
  assert.match(workspaceSource, /layoutMode === 'compact-cards'/)
  assert.match(workspaceSource, /<slot name="topnav" \/>/)
  assert.match(entryListSource, /listStyle === 'cards'/)
  assert.match(entryListSource, /listStyle === 'table'/)
  assert.match(entryListSource, /is-style-\$\{listStyle\}/)
})
