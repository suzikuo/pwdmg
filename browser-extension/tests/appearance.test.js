const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const extension = path.resolve(__dirname, '..')
const builtinSource = readFileSync(path.join(extension, 'builtin-skins.js'), 'utf8')
const controllerSource = readFileSync(path.join(extension, 'appearance.js'), 'utf8')

function setup(initial = {}) {
  const storageListeners = new Set()
  const schemeListeners = new Set()
  let stored = initial
  let reads = 0
  const system = {
    matches: false,
    addEventListener(event, handler) { schemeListeners.add(handler) },
    removeEventListener(event, handler) { schemeListeners.delete(handler) }
  }
  const chrome = { storage: {
    onChanged: {
      addListener: (fn) => storageListeners.add(fn),
      removeListener: (fn) => storageListeners.delete(fn)
    },
    local: {
      async get(key) { reads += 1; return structuredClone({ [key]: stored[key] }) },
      async set(value) {
        stored = structuredClone(value)
        for (const listener of storageListeners) listener({ extensionAppearance: { newValue: stored.extensionAppearance } }, 'local')
      }
    }
  } }
  const context = vm.createContext({ matchMedia: () => system, chrome })
  vm.runInContext(builtinSource, context)
  vm.runInContext(controllerSource, context)
  const appearance = context.MyPwdMgAppearance
  function createSurface() {
    const styles = new Map()
    const root = {
      dataset: {},
      style: {
        removeProperty: (name) => styles.delete(name),
        setProperty: (name, value) => styles.set(name, value)
      }
    }
    const controller = appearance.createController(() => root)
    return { controller, root, styles }
  }
  return {
    appearance, createSurface, getStored: () => stored, getReads: () => reads,
    changeSystem(value) { system.matches = value; for (const listener of schemeListeners) listener() }
  }
}

const custom = {
  id: 'custom-teal', name: '自定义配色', version: '1.0',
  layout: { mode: 'top-nav-split', density: 'airy', listStyle: 'cards' },
  light: { '--brand': '#1265ab', '--radius-lg': '17px' }, dark: { '--brand': '#e4f5ff' }
}

test('appearance settings persist locally and update both extension surfaces without invoking the host', async () => {
  const { appearance, createSurface, getStored, getReads, changeSystem } = setup()
  const popup = createSurface()
  const panel = createSurface()
  await Promise.all([popup.controller.refresh(), popup.controller.refresh(), panel.controller.refresh()])
  assert.equal(getReads(), 2)
  assert.equal(panel.styles.get('--brand'), '#111113')
  await appearance.saveState({ skinId: custom.id, theme: 'system', customSkins: [custom], layout: { density: 'compact', listStyle: 'table' } })
  for (const { root, styles } of [popup, panel]) {
    assert.deepEqual(root.dataset, { theme: 'light', layout: 'top-nav-split', density: 'compact', listStyle: 'table' })
    assert.equal(styles.get('--brand'), '#1265ab')
  }
  changeSystem(true)
  assert.equal(popup.styles.get('--brand'), '#e4f5ff')
  assert.equal(popup.styles.has('--radius-lg'), false)
  panel.controller.dispose()
  await appearance.saveState({ ...getStored().extensionAppearance, theme: 'light', layout: {} })
  assert.equal(popup.root.dataset.theme, 'light')
  assert.equal(popup.root.dataset.density, 'airy')
  assert.equal(popup.root.dataset.listStyle, 'cards')
  assert.equal(panel.root.dataset.theme, 'dark')
  const reopened = createSurface()
  await reopened.controller.refresh()
  assert.equal(reopened.styles.get('--radius-lg'), '17px')
})

test('validates the desktop skin format and recovers from missing or unsafe local skins', async () => {
  const { appearance, createSurface } = setup({ extensionAppearance: {
    skinId: custom.id, theme: 'invalid', layout: { mode: 'invalid' },
    customSkins: [{ ...custom, light: { '--brand': 'url(https://example.test)' } }]
  } })
  assert.throws(() => appearance.validateSkin({ ...custom, id: 'graphite' }), /内置皮肤/)
  assert.throws(() => appearance.validateSkin({ ...custom, dark: { '--unknown': '#fff' } }), /变量/)
  assert.throws(() => appearance.validateSkin({ ...custom, dark: { '--app-bg': 'red; display: none' } }), /变量/)
  assert.throws(() => appearance.validateSkin({ ...custom, layout: { mode: 'invalid' } }), /布局/)
  const validated = appearance.validateSkin(custom)
  assert.equal(validated.preview.light.accent, '#1265ab')
  const { root, styles, controller } = createSurface()
  const state = await controller.refresh()
  assert.equal(state.skinId, 'graphite')
  assert.equal(state.customSkins.length, 0)
  assert.equal(root.dataset.layout, 'three-pane')
  assert.equal(styles.get('--brand'), '#111113')
})

test('the toolbar declares its width on the root without depending on the initial viewport', () => {
  const css = readFileSync(path.join(extension, 'popup.css'), 'utf8')
  assert.match(css, /\bhtml\s*\{[^}]*\bwidth:\s*\d+px\s*;/)
  assert.match(css, /html\[data-layout="top-nav-split"\]\s*\{[^}]*\bwidth:\s*\d+px\s*;/)
  for (const rule of css.matchAll(/\b(?:html|body)(?:\[[^\]]+\])?\s*\{([^}]+)\}/g)) {
    assert.doesNotMatch(rule[1], /\b(?:min-|max-)?width:\s*[^;}]*(?:\dvw|%)/)
  }
})

test('the bundled presets and shared fallback match the desktop skin catalog', () => {
  const { BUILTIN_SKINS } = require('../../front/src/services/skins/builtinSkins.ts')
  const { appearance } = setup()
  assert.deepEqual(JSON.parse(JSON.stringify(appearance.BUILTIN_SKINS)), BUILTIN_SKINS)
  const graphite = BUILTIN_SKINS[0]
  const css = readFileSync(path.join(extension, 'appearance.css'), 'utf8')
  const [light, dark] = css.split('[data-theme="dark"]', 2)
  for (const [tokens, block] of [[graphite.light, light], [graphite.dark, dark]]) {
    for (const [name, value] of Object.entries(tokens)) {
      assert.ok(block.split('\n').some((line) => line.trim() === `${name}: ${value};`), `${name} differs from desktop`)
    }
  }
})
