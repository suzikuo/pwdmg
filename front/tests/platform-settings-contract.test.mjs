import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/composables/useSettingsPanel.ts', import.meta.url), 'utf8')
const autofillSource = readFileSync(new URL('../src/composables/useAndroidAutofillSettings.ts', import.meta.url), 'utf8')
const pluginSource = readFileSync(new URL('../src/composables/usePluginListenerSettings.ts', import.meta.url), 'utf8')

test('Android Autofill settings own their API state and feedback', () => {
  assert.match(appSource, /useAndroidAutofillSettings\(\)/)
  assert.match(autofillSource, /api\.getAndroidAutofillState\(\)/)
  assert.match(autofillSource, /api\.openAndroidAutofillSettings\(\)/)
  assert.match(autofillSource, /window\.setTimeout\(load, 1000\)/)
  assert.doesNotMatch(appSource, /async function openAndroidAutofillSettings/)
})

test('desktop plugin listener settings are isolated from the root component', () => {
  assert.match(appSource, /usePluginListenerSettings\(isDesktopRuntime\)/)
  assert.match(pluginSource, /api\.getPluginListenerState\(\)/)
  assert.match(pluginSource, /api\.enablePluginListener\(normalizedExtensionId, \['chrome', 'edge'\]\)/)
  assert.match(pluginSource, /api\.disablePluginListener\(\)/)
  assert.doesNotMatch(appSource, /async function enablePluginListener/)
  assert.doesNotMatch(appSource, /async function disablePluginListener/)
})

test('generic settings panel does not own plugin-specific popup state', () => {
  assert.doesNotMatch(panelSource, /pluginDetailOpen/)
  assert.match(pluginSource, /const detailOpen = ref\(false\)/)
  assert.match(pluginSource, /function reset\(\)/)
})
