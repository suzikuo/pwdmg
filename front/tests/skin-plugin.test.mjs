import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVE_SKIN_STORAGE_KEY,
  BUILTIN_SKINS,
  CUSTOM_SKINS_STORAGE_KEY,
  DEFAULT_SKIN_ID,
  DEFAULT_SKIN_LAYOUT,
  DEFAULT_WALLPAPER_SETTINGS,
  LAYOUT_OVERRIDE_STORAGE_KEY,
  WALLPAPER_SETTINGS_STORAGE_KEY,
  applySkinToDocument,
  clearWallpaperImage,
  exportSkinTemplate,
  getSkin,
  installCustomSkin,
  listSkins,
  loadLayoutOverride,
  loadWallpaperImage,
  loadWallpaperSettings,
  resolveEffectiveLayout,
  resolveSkinLayout,
  sanitizeWallpaperSettings,
  saveLayoutOverride,
  saveWallpaperImage,
  saveWallpaperSettings,
  uninstallCustomSkin,
  validateSkinPlugin
} from '../src/services/skins/index.ts'
import { createUiStore } from '../src/stores/uiStore.ts'

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    }
  }
}

function createFakeDocument() {
  const props = new Map()
  return {
    documentElement: {
      dataset: {},
      style: {
        setProperty(key, val) {
          props.set(key, val)
        },
        removeProperty(key) {
          props.delete(key)
        },
        getPropertyValue(key) {
          return props.get(key) || ''
        }
      }
    },
    _props: props
  }
}

test('all 8 built-in skins exist, pass validation, and have valid light/dark tokens and default layouts', () => {
  assert.equal(DEFAULT_SKIN_ID, 'graphite')
  assert.deepEqual(
    BUILTIN_SKINS.map((s) => s.id),
    ['graphite', 'native', 'industrial', 'bento', 'paper', 'nord', 'moss', 'rosewood']
  )

  const expectedLayouts = {
    graphite: { mode: 'three-pane', density: 'comfortable', listStyle: 'rows' },
    native: { mode: 'top-nav-split', density: 'comfortable', listStyle: 'rows' },
    industrial: { mode: 'three-pane', density: 'compact', listStyle: 'table' },
    bento: { mode: 'compact-cards', density: 'airy', listStyle: 'cards' },
    paper: { mode: 'three-pane', density: 'comfortable', listStyle: 'rows' },
    nord: { mode: 'top-nav-split', density: 'comfortable', listStyle: 'rows' },
    moss: { mode: 'three-pane', density: 'comfortable', listStyle: 'rows' },
    rosewood: { mode: 'compact-cards', density: 'airy', listStyle: 'cards' }
  }

  const requiredTokens = [
    '--app-bg',
    '--panel-bg',
    '--surface-sidebar',
    '--text-main',
    '--brand',
    '--on-brand',
    '--border-soft',
    '--radius-sm',
    '--radius-md'
  ]

  for (const skin of BUILTIN_SKINS) {
    assert.equal(skin.builtin, true)
    assert.ok(skin.name.length > 0)
    assert.deepEqual(resolveSkinLayout(skin), expectedLayouts[skin.id])
    assert.ok(skin.preview.light.bg && skin.preview.dark.bg)

    // Every built-in skin passes validateSkinPlugin cleanly
    const validated = validateSkinPlugin(skin)
    assert.equal(validated.ok, true, `built-in skin ${skin.id} failed validation`)

    for (const token of requiredTokens) {
      assert.ok(skin.light[token], `${skin.id}.light missing ${token}`)
      assert.ok(skin.dark[token], `${skin.id}.dark missing ${token}`)
    }
    // Ensure zero neon-cyan AI default remains in any built-in skin
    assert.notEqual(skin.dark['--brand'], '#2dd4bf')
    assert.notEqual(skin.dark['--app-bg'], '#0d1117')
  }
})

test('validateSkinPlugin accepts valid custom skin and rejects CSS injection, unknown keys, and bad IDs', () => {
  const valid = validateSkinPlugin({
    id: 'nord-paper',
    name: 'Nord Paper',
    description: 'Clean Nordic neutral skin',
    author: 'Tester',
    version: '1.0.0',
    light: {
      '--app-bg': '#eceff4',
      '--brand': '#2e3440',
      '--on-brand': '#ffffff'
    },
    dark: {
      '--app-bg': '#2e3440',
      '--brand': '#eceff4',
      '--on-brand': '#2e3440'
    }
  })
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(valid.skin.id, 'nord-paper')
    assert.equal(valid.skin.builtin, false)
    assert.deepEqual(valid.skin.layout, DEFAULT_SKIN_LAYOUT)
    assert.equal(valid.skin.preview.light.bg, '#eceff4')
    assert.equal(valid.skin.preview.dark.accent, '#eceff4')
  }

  const validWithLayout = validateSkinPlugin({
    id: 'nord-cards',
    name: 'Nord Cards',
    version: '1.0.0',
    layout: { mode: 'compact-cards', density: 'airy', listStyle: 'cards' },
    light: { '--app-bg': '#eceff4', '--brand': '#2e3440' },
    dark: { '--app-bg': '#2e3440', '--brand': '#eceff4' }
  })
  assert.equal(validWithLayout.ok, true)
  if (validWithLayout.ok) {
    assert.deepEqual(validWithLayout.skin.layout, {
      mode: 'compact-cards',
      density: 'airy',
      listStyle: 'cards'
    })
  }

  const badCases = [
    {
      label: 'bad id uppercase',
      input: { id: 'Bad_ID', name: 'X', version: '1.0', light: { '--brand': '#000' }, dark: {} }
    },
    {
      label: 'unknown token key',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--evil-token': 'red' }, dark: {} }
    },
    {
      label: 'url() injection',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--app-bg': 'url(https://evil.test/x)' }, dark: {} }
    },
    {
      label: 'semicolon breakout',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--brand': '#000; background: red' }, dark: {} }
    },
    {
      label: 'brace breakout',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--brand': '#000 } body { display: none' }, dark: {} }
    },
    {
      label: 'expression() injection',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: {}, dark: { '--brand': 'expression(alert(1))' } }
    },
    {
      label: '@import injection',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--font-sans': '@import "evil.css"' }, dark: {} }
    },
    {
      label: 'javascript: scheme',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--brand': 'javascript:alert(1)' }, dark: {} }
    },
    {
      label: 'HTML tag injection',
      input: { id: 'my-skin', name: 'X', version: '1.0', light: { '--brand': '<script>alert(1)</script>' }, dark: {} }
    },
    {
      label: 'invalid layout mode',
      input: { id: 'my-skin', name: 'X', version: '1.0', layout: { mode: 'floating' }, light: { '--brand': '#000' }, dark: {} }
    },
    {
      label: 'invalid layout density',
      input: { id: 'my-skin', name: 'X', version: '1.0', layout: { density: 'giant' }, light: { '--brand': '#000' }, dark: {} }
    },
    {
      label: 'invalid layout listStyle',
      input: { id: 'my-skin', name: 'X', version: '1.0', layout: { listStyle: 'masonry' }, light: { '--brand': '#000' }, dark: {} }
    },
    {
      label: 'non-object layout',
      input: { id: 'my-skin', name: 'X', version: '1.0', layout: 'three-pane', light: { '--brand': '#000' }, dark: {} }
    }
  ]

  for (const { label, input } of badCases) {
    const res = validateSkinPlugin(input)
    assert.equal(res.ok, false, `expected validation failure for: ${label}`)
  }
})

test('installCustomSkin, exportSkinTemplate, and uninstallCustomSkin roundtrip cleanly and protect built-in skins', () => {
  const prevStorage = globalThis.localStorage
  globalThis.localStorage = createMemoryStorage()
  try {
    // Export built-in template and install it as a custom skin
    const exportedJson = exportSkinTemplate('industrial')
    const installed = installCustomSkin(exportedJson)
    assert.equal(installed.ok, true)
    if (installed.ok) {
      assert.equal(installed.skin.id, 'industrial-custom')
      assert.equal(installed.skin.builtin, false)
    }

    assert.ok(listSkins().some((s) => s.id === 'industrial-custom'))
    assert.equal(getSkin('industrial-custom').id, 'industrial-custom')

    // Built-in IDs cannot be overwritten or deleted
    const overwriteBuiltin = installCustomSkin(JSON.stringify({
      id: 'graphite',
      name: 'Fake Graphite',
      version: '1.0.0',
      light: { '--brand': '#000' },
      dark: { '--brand': '#fff' }
    }))
    assert.equal(overwriteBuiltin.ok, false)
    for (const id of ['graphite', 'native', 'industrial', 'bento', 'paper', 'nord', 'moss', 'rosewood']) {
      assert.equal(uninstallCustomSkin(id), false)
    }

    // Custom skin can be uninstalled cleanly
    assert.equal(uninstallCustomSkin('industrial-custom'), true)
    assert.equal(listSkins().some((s) => s.id === 'industrial-custom'), false)
    assert.equal(uninstallCustomSkin('industrial-custom'), false)
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevStorage
  }
})

test('uiStore switches skins, updates activeSkinId, and applies CSS custom properties to document', () => {
  const prevStorage = globalThis.localStorage
  const prevDoc = globalThis.document
  globalThis.localStorage = createMemoryStorage()
  const fakeDoc = createFakeDocument()
  globalThis.document = fakeDoc

  try {
    const ui = createUiStore()
    assert.equal(ui.activeSkinId.value, 'graphite')
    assert.equal(ui.availableSkins.value.length, 8)
    assert.deepEqual(ui.activeLayout.value, { mode: 'three-pane', density: 'comfortable', listStyle: 'rows' })

    ui.setTheme('dark')
    assert.equal(fakeDoc.documentElement.dataset.theme, 'dark')
    assert.equal(fakeDoc.documentElement.dataset.skin, 'graphite')
    assert.equal(fakeDoc.documentElement.dataset.layout, 'three-pane')
    assert.equal(fakeDoc.documentElement.dataset.density, 'comfortable')
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'rows')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#fafafa')

    ui.setSkin('industrial')
    assert.equal(ui.activeSkinId.value, 'industrial')
    assert.equal(globalThis.localStorage.getItem(ACTIVE_SKIN_STORAGE_KEY), 'industrial')
    assert.equal(fakeDoc.documentElement.dataset.skin, 'industrial')
    assert.equal(fakeDoc.documentElement.dataset.layout, 'three-pane')
    assert.equal(fakeDoc.documentElement.dataset.density, 'compact')
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'table')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#f97316')

    ui.setSkin('bento')
    assert.deepEqual(ui.activeLayout.value, { mode: 'compact-cards', density: 'airy', listStyle: 'cards' })
    assert.equal(fakeDoc.documentElement.dataset.layout, 'compact-cards')
    assert.equal(fakeDoc.documentElement.dataset.density, 'airy')
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'cards')

    ui.setTheme('light')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#18181b')

    const customResult = ui.installSkinFromJson(JSON.stringify({
      id: 'studio-mono',
      name: 'Studio Mono',
      version: '1.0.0',
      light: { '--brand': '#18181b', '--app-bg': '#fafafa' },
      dark: { '--brand': '#f4f4f5', '--app-bg': '#09090b' }
    }))
    assert.equal(customResult.ok, true)
    assert.equal(ui.activeSkinId.value, 'studio-mono')
    assert.equal(ui.availableSkins.value.length, 9)
    assert.ok(globalThis.localStorage.getItem(CUSTOM_SKINS_STORAGE_KEY)?.includes('studio-mono'))

    // Removing active custom skin falls back cleanly to graphite
    assert.equal(ui.removeCustomSkin('studio-mono'), true)
    assert.equal(ui.activeSkinId.value, 'graphite')
    assert.equal(ui.availableSkins.value.length, 8)

    // Direct applySkinToDocument clears previous skin variables before applying
    applySkinToDocument(getSkin('native'), 'light')
    assert.equal(fakeDoc.documentElement.dataset.skin, 'native')
    assert.equal(fakeDoc.documentElement.dataset.layout, 'top-nav-split')
    assert.equal(fakeDoc.documentElement.dataset.density, 'comfortable')
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'rows')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#0066ff')
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevStorage
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
  }
})

test('independent layout overrides mix with any skin, persist, update DOM, and bake into exported plugin JSON', () => {
  const prevStorage = globalThis.localStorage
  const prevDoc = globalThis.document
  globalThis.localStorage = createMemoryStorage()
  const fakeDoc = createFakeDocument()
  globalThis.document = fakeDoc

  try {
    // Low-level helpers sanity check
    assert.deepEqual(loadLayoutOverride(), {})
    saveLayoutOverride({ mode: 'top-nav-split', density: 'compact', listStyle: 'table' })
    assert.deepEqual(loadLayoutOverride(), { mode: 'top-nav-split', density: 'compact', listStyle: 'table' })
    assert.deepEqual(
      resolveEffectiveLayout(getSkin('paper'), { mode: 'compact-cards' }),
      { mode: 'compact-cards', density: 'comfortable', listStyle: 'rows' }
    )
    saveLayoutOverride({})

    const ui = createUiStore()
    ui.setSkin('paper')
    ui.setTheme('light')
    assert.equal(ui.hasLayoutOverride.value, false)
    assert.deepEqual(ui.activeLayout.value, { mode: 'three-pane', density: 'comfortable', listStyle: 'rows' })
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#9a4a1a')

    // Override mode, listStyle, density independently
    ui.setLayoutMode('compact-cards')
    assert.equal(ui.hasLayoutOverride.value, true)
    assert.equal(ui.sidebarCollapsed.value, true)
    assert.equal(fakeDoc.documentElement.dataset.layout, 'compact-cards')

    ui.setListStyle('table')
    ui.setDensity('compact')
    assert.deepEqual(ui.activeLayout.value, {
      mode: 'compact-cards',
      density: 'compact',
      listStyle: 'table'
    })
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'table')
    assert.equal(fakeDoc.documentElement.dataset.density, 'compact')

    // Switching color skin preserves user's layout overrides
    ui.setSkin('rosewood')
    assert.equal(ui.activeSkinId.value, 'rosewood')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--brand'), '#8f344c')
    assert.deepEqual(ui.activeLayout.value, {
      mode: 'compact-cards',
      density: 'compact',
      listStyle: 'table'
    })

    // Persists across store re-creation
    assert.ok(globalThis.localStorage.getItem(LAYOUT_OVERRIDE_STORAGE_KEY)?.includes('compact-cards'))
    const reloaded = createUiStore()
    assert.equal(reloaded.activeSkinId.value, 'rosewood')
    assert.equal(reloaded.hasLayoutOverride.value, true)
    assert.deepEqual(reloaded.activeLayout.value, {
      mode: 'compact-cards',
      density: 'compact',
      listStyle: 'table'
    })

    // Exported plugin JSON bakes in the effective mixed layout
    const exported = JSON.parse(ui.exportCurrentSkinJson())
    assert.equal(exported.id, 'rosewood-custom')
    assert.deepEqual(exported.layout, {
      mode: 'compact-cards',
      density: 'compact',
      listStyle: 'table'
    })
    assert.equal(validateSkinPlugin(exported).ok, true)

    // Switching layout mode to three-pane expands sidebar
    ui.setLayoutMode('three-pane')
    assert.equal(ui.sidebarCollapsed.value, false)
    assert.equal(fakeDoc.documentElement.dataset.layout, 'three-pane')

    // Reset restores active skin's default layout (rosewood -> compact-cards / airy / cards)
    ui.resetLayoutOverride()
    assert.equal(ui.hasLayoutOverride.value, false)
    assert.deepEqual(ui.activeLayout.value, {
      mode: 'compact-cards',
      density: 'airy',
      listStyle: 'cards'
    })
    assert.equal(ui.sidebarCollapsed.value, true)
    assert.equal(fakeDoc.documentElement.dataset.layout, 'compact-cards')
    assert.equal(fakeDoc.documentElement.dataset.density, 'airy')
    assert.equal(fakeDoc.documentElement.dataset.listStyle, 'cards')
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevStorage
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
  }
})

test('wallpaperStore clamps settings, persists to localStorage, and roundtrips image in memory fallback', async () => {
  const prevStorage = globalThis.localStorage
  globalThis.localStorage = createMemoryStorage()
  try {
    assert.deepEqual(loadWallpaperSettings(), DEFAULT_WALLPAPER_SETTINGS)

    // Out-of-range values are clamped cleanly
    const clamped = sanitizeWallpaperSettings({
      hasImage: true,
      surfaceOpacity: 10,
      wallpaperBlur: 99,
      wallpaperDim: -5
    })
    assert.deepEqual(clamped, {
      hasImage: true,
      surfaceOpacity: 45,
      wallpaperBlur: 24,
      wallpaperDim: 0
    })

    saveWallpaperSettings({
      hasImage: true,
      surfaceOpacity: 76,
      wallpaperBlur: 12,
      wallpaperDim: 40
    })
    assert.ok(globalThis.localStorage.getItem(WALLPAPER_SETTINGS_STORAGE_KEY)?.includes('"surfaceOpacity":76'))
    assert.deepEqual(loadWallpaperSettings(), {
      hasImage: true,
      surfaceOpacity: 76,
      wallpaperBlur: 12,
      wallpaperDim: 40
    })

    // Image persistence fallback in non-IDB environment
    const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgo='
    await saveWallpaperImage(sampleDataUrl)
    assert.equal(await loadWallpaperImage(), sampleDataUrl)
    await clearWallpaperImage()
    assert.equal(await loadWallpaperImage(), '')
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevStorage
  }
})

test('applySkinToDocument generates translucent tokens when wallpaper is active and restores opaque tokens when off', () => {
  const prevDoc = globalThis.document
  const fakeDoc = createFakeDocument()
  globalThis.document = fakeDoc

  try {
    const skin = getSkin('graphite')

    // Active wallpaper: data-wallpaper="on" + translucent color-mix tokens
    applySkinToDocument(skin, 'dark', null, {
      active: true,
      surfaceOpacity: 80,
      wallpaperBlur: 10,
      wallpaperDim: 30
    })
    assert.equal(fakeDoc.documentElement.dataset.wallpaper, 'on')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--app-bg'), 'transparent')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--wallpaper-blur'), '10px')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--wallpaper-dim'), '0.3')
    assert.equal(
      fakeDoc.documentElement.style.getPropertyValue('--surface-sidebar'),
      `color-mix(in srgb, ${skin.dark['--surface-sidebar']} 80%, transparent)`
    )
    assert.equal(
      fakeDoc.documentElement.style.getPropertyValue('--panel-bg'),
      `color-mix(in srgb, ${skin.dark['--panel-bg']} 80%, transparent)`
    )
    assert.equal(
      fakeDoc.documentElement.style.getPropertyValue('--surface-container-low'),
      `color-mix(in srgb, ${skin.dark['--surface-container-low']} 84%, transparent)`
    )
    assert.equal(
      fakeDoc.documentElement.style.getPropertyValue('--surface-elevated'),
      `color-mix(in srgb, ${skin.dark['--surface-elevated']} 90%, transparent)`
    )

    // Inactive wallpaper: data-wallpaper="off" + exact opaque skin tokens
    applySkinToDocument(skin, 'dark', null, {
      active: false,
      surfaceOpacity: 80,
      wallpaperBlur: 10,
      wallpaperDim: 30
    })
    assert.equal(fakeDoc.documentElement.dataset.wallpaper, 'off')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--app-bg'), skin.dark['--app-bg'])
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--panel-bg'), skin.dark['--panel-bg'])
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--surface-sidebar'), skin.dark['--surface-sidebar'])
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--wallpaper-blur'), '')
    assert.equal(fakeDoc.documentElement.style.getPropertyValue('--wallpaper-dim'), '')
  } finally {
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
  }
})
