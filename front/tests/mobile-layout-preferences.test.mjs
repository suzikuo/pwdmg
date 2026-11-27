import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  normalizeMobileLayoutMode,
  normalizeMobileListStyle
} from '../src/stores/uiStore.ts'
import {
  clampMobileFabPosition,
  parseStoredMobileFabPosition,
  resolveMobileFabFanOffsets
} from '../src/services/mobileFloatingBall.ts'

test('mobile layout mode and list style normalize safely with defaults', () => {
  assert.equal(normalizeMobileLayoutMode('classic'), 'classic')
  assert.equal(normalizeMobileLayoutMode('bottom-tabs'), 'bottom-tabs')
  assert.equal(normalizeMobileLayoutMode('floating-dock'), 'floating-dock')
  assert.equal(normalizeMobileLayoutMode('three-pane'), 'classic')
  assert.equal(normalizeMobileLayoutMode(null), 'classic')

  assert.equal(normalizeMobileListStyle('rows'), 'rows')
  assert.equal(normalizeMobileListStyle('cards'), 'cards')
  assert.equal(normalizeMobileListStyle('compact'), 'compact')
  assert.equal(normalizeMobileListStyle('table'), 'rows')
  assert.equal(normalizeMobileListStyle(undefined), 'rows')
})

test('mobile-exclusive layouts and list styles are wired across App, VaultWorkspace, EntryList, and SettingsDrawer', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const appSrc = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8')
  const workspaceSrc = fs.readFileSync(path.join(root, 'src/components/workspace/VaultWorkspace.vue'), 'utf8')
  const entryListSrc = fs.readFileSync(path.join(root, 'src/components/EntryList.vue'), 'utf8')
  const settingsSrc = fs.readFileSync(path.join(root, 'src/components/settings/SettingsDrawer.vue'), 'utf8')

  assert.match(appSrc, /UiIcon/)
  assert.match(appSrc, /mobile-bottom-tabs/)
  assert.match(appSrc, /mobile-floating-dock/)
  assert.match(appSrc, /mobile-fab-trigger/)
  assert.match(appSrc, /handleMobileFabAction\('settings'\)/)
  assert.doesNotMatch(appSrc, /name="vault"/)
  assert.match(appSrc, /:mobile-layout-mode="ui\.mobileLayoutMode"/)
  assert.match(appSrc, /:mobile-list-style="ui\.mobileListStyle"/)
  const modalSrc = fs.readFileSync(path.join(root, 'src/components/ui/UiModal.vue'), 'utf8')
  assert.match(modalSrc, /inset:\s*var\(--desktop-titlebar-height,\s*0px\)\s*0\s*0/)
  assert.match(workspaceSrc, /:list-style="isDesktop \? listStyle : mobileListStyle"/)
  assert.match(workspaceSrc, /<slot v-if="!isDesktop" name="mobile-chrome" \/>/)
  assert.match(entryListSrc, /\.entry-list\.is-style-compact/)
  assert.match(entryListSrc, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(settingsSrc, /移动端布局/)
  assert.match(settingsSrc, /移动端列表/)
})

test('mobile floating ball clamps position and adapts fan direction to screen quadrant', () => {
  const clamped = clampMobileFabPosition({ x: -20, y: 9999 }, 390, 844, 36)
  assert.equal(clamped.x, 14)
  assert.equal(clamped.y, 780)
  assert.deepEqual(parseStoredMobileFabPosition('{"x":120,"y":400}'), { x: 120, y: 400 })
  assert.equal(parseStoredMobileFabPosition('invalid'), null)

  const bottomRight = resolveMobileFabFanOffsets({ x: 320, y: 720 }, 390, 844, 0)
  assert.ok(bottomRight.horizontal.x < 0 && bottomRight.vertical.y < 0)

  const topLeft = resolveMobileFabFanOffsets({ x: 20, y: 60 }, 390, 844, 36)
  assert.ok(topLeft.horizontal.x > 0 && topLeft.vertical.y > 0)
})
