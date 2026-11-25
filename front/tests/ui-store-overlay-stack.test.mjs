import assert from 'node:assert/strict'
import test from 'node:test'

import { createUiStore } from '../src/stores/uiStore.ts'

test('overlay stack closes generator over editor in LIFO order on closeTopLayer', () => {
  const ui = createUiStore()

  ui.editorOpen.value = true
  ui.generatorOpen.value = true
  assert.deepEqual(ui.overlayStack.value, ['editor', 'generator'])
  assert.equal(ui.topOverlay.value, 'generator')

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.generatorOpen.value, false)
  assert.equal(ui.editorOpen.value, true)
  assert.deepEqual(ui.overlayStack.value, ['editor'])

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.editorOpen.value, false)
  assert.deepEqual(ui.overlayStack.value, [])
  assert.equal(ui.closeTopLayer(), false)
})

test('overlay stack covers import, cloudPasswordPrompt, and portablePassword modals', () => {
  const ui = createUiStore()

  ui.drawerOpen.value = true
  ui.importOpen.value = true
  ui.cloudPasswordPromptOpen.value = true
  ui.portableBackupPasswordOpen.value = true
  assert.deepEqual(ui.overlayStack.value, ['settings', 'import', 'cloudPasswordPrompt', 'portablePassword'])

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.portableBackupPasswordOpen.value, false)

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.cloudPasswordPromptOpen.value, false)

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.importOpen.value, false)

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.drawerOpen.value, false)
  assert.deepEqual(ui.overlayStack.value, [])
})

test('re-opening an overlay promotes it to top without duplicates and respects canClose guards', () => {
  const ui = createUiStore()
  let blocked = true

  ui.registerOverlayHandler('editor', {
    canClose: () => !blocked
  })

  ui.openOverlay('editor')
  ui.openOverlay('generator')
  ui.openOverlay('editor')
  assert.deepEqual(ui.overlayStack.value, ['generator', 'editor'])

  // Blocked while busy: consumes Esc/Back without popping
  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.editorOpen.value, true)

  blocked = false
  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.editorOpen.value, false)
  assert.equal(ui.topOverlay.value, 'generator')
})

test('narrow settings drawer closes detail subview before popping settings overlay', () => {
  const ui = createUiStore()
  ui.isDrawerWide.value = false
  ui.drawerOpen.value = true
  ui.drawerDetailOpen.value = true

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.drawerDetailOpen.value, false)
  assert.equal(ui.drawerOpen.value, true)

  assert.equal(ui.closeTopLayer(), true)
  assert.equal(ui.drawerOpen.value, false)
})

test('clearAllOverlays empties every open overlay and invokes onClear callbacks on lock', () => {
  const ui = createUiStore()
  let clearedPlugin = false

  ui.registerOverlayHandler('pluginDetail', {
    onClear: () => {
      clearedPlugin = true
    }
  })

  ui.drawerOpen.value = true
  ui.drawerDetailOpen.value = true
  ui.editorOpen.value = true
  ui.generatorOpen.value = true
  ui.importOpen.value = true
  ui.passkeyManagerOpen.value = true
  ui.cloudPasswordPromptOpen.value = true
  ui.portableBackupPasswordOpen.value = true
  ui.pluginDetailOpen.value = true
  ui.searchOpen.value = true
  ui.moreMenuOpen.value = true

  ui.clearAllOverlays()

  assert.deepEqual(ui.overlayStack.value, [])
  assert.equal(ui.drawerOpen.value, false)
  assert.equal(ui.drawerDetailOpen.value, false)
  assert.equal(ui.editorOpen.value, false)
  assert.equal(ui.generatorOpen.value, false)
  assert.equal(ui.importOpen.value, false)
  assert.equal(ui.passkeyManagerOpen.value, false)
  assert.equal(ui.cloudPasswordPromptOpen.value, false)
  assert.equal(ui.portableBackupPasswordOpen.value, false)
  assert.equal(ui.pluginDetailOpen.value, false)
  assert.equal(ui.searchOpen.value, false)
  assert.equal(ui.moreMenuOpen.value, false)
  assert.equal(clearedPlugin, true)
})

test('closeTopLayer falls back to menus, search, drag mode, and batch selection when overlay stack is empty', () => {
  const ui = createUiStore()
  let searchActive = true
  let dragActive = true
  let batchActive = true

  ui.moreMenuOpen.value = true
  ui.searchOpen.value = true

  const fallbacks = {
    hasActiveSearch: () => searchActive,
    clearSearch: () => { searchActive = false },
    isDragMode: () => dragActive,
    exitDragMode: () => { dragActive = false },
    isBatchSelectionMode: () => batchActive,
    exitBatchSelection: () => { batchActive = false }
  }

  assert.equal(ui.closeTopLayer(fallbacks), true)
  assert.equal(ui.moreMenuOpen.value, false)

  assert.equal(ui.closeTopLayer(fallbacks), true)
  assert.equal(ui.searchOpen.value, false)
  assert.equal(searchActive, false)

  assert.equal(ui.closeTopLayer(fallbacks), true)
  assert.equal(dragActive, false)

  assert.equal(ui.closeTopLayer(fallbacks), true)
  assert.equal(batchActive, false)

  assert.equal(ui.closeTopLayer(fallbacks), false)
})
