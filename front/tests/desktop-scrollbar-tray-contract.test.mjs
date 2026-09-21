import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const desktopMainSource = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8')
const desktopBridgeSource = readFileSync(new URL('../../src-tauri/src/bridge.rs', import.meta.url), 'utf8')
const desktopTrayComposableSource = readFileSync(new URL('../src/composables/useDesktopTraySettings.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const traySettingsSource = readFileSync(new URL('../src/composables/useDesktopTraySettings.ts', import.meta.url), 'utf8')

test('desktop scrollbars use a compact shared style without exposing utility scrollers', () => {
  assert.match(styles, /@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*scrollbar-width:\s*thin;[\s\S]*scrollbar-color:\s*color-mix\(in srgb, var\(--brand\), transparent 52%\) var\(--panel-bg\);/)
  assert.match(styles, /\*::\-webkit-scrollbar\s*\{[^}]*width:\s*2px;[^}]*height:\s*2px;/s)
  assert.match(styles, /\*::\-webkit-scrollbar-track[\s\S]*background:\s*var\(--panel-bg\);/)
  assert.match(styles, /\*::\-webkit-scrollbar-button\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s)
  assert.match(styles, /\*::\-webkit-scrollbar-thumb\s*\{[^}]*var\(--brand\)/s)
  assert.match(styles, /\*::\-webkit-scrollbar-thumb:active\s*\{[^}]*background:\s*var\(--brand\);/s)
  assert.doesNotMatch(styles, /\.editor-form::\-webkit-scrollbar/)
  assert.doesNotMatch(styles, /\.editor-form\s*\{[^}]*scrollbar-width:/s)
  assert.match(styles, /\.search-filter-segments::\-webkit-scrollbar\s*\{\s*display:\s*none;/s)
  assert.match(styles, /\.batch-mode-actions::\-webkit-scrollbar\s*\{\s*display:\s*none;/s)
})

test('tray reset command moves to the default coordinates and persists them', () => {
  assert.match(desktopMainSource, /"reset_position"/)
  assert.match(desktopMainSource, /"重置窗口位置"/)
  assert.match(desktopMainSource, /window\.set_size/)
  assert.match(desktopMainSource, /window\.center\(\)/)
})

test('desktop settings expose an immediate tray switch and close behavior', () => {
  assert.match(settingsSource, /v-if="showDesktopTraySettings"/)
  assert.match(settingsSource, /emit\('toggle-desktop-tray', Boolean\(\$event\)\)/)
  assert.match(settingsSource, /:loading="desktopTrayBusy \|\| !desktopTraySettings"/)
  assert.match(settingsSource, /v-if="desktopTraySettings\?\.trayEnabled === true"/)
  assert.match(settingsSource, /update-desktop-close-behavior', 'minimize-to-tray'/)
  assert.match(settingsSource, /update-desktop-close-behavior', 'exit'/)
  assert.match(appSource, /useDesktopTraySettings\(isDesktopRuntime\)/)
  assert.match(appSource, /loadDesktopTraySettings\(\)/)
})

test('desktop tray settings use the native device config instead of vault settings', () => {
  assert.match(apiSource, /callDesktopApi<DesktopTraySettings>\('getDesktopTraySettings'\)/)
  assert.match(apiSource, /callDesktopApi<DesktopTraySettings>\('setDesktopTraySettings', trayEnabled, closeBehavior\)/)
  assert.match(traySettingsSource, /api\.setDesktopTraySettings\(trayEnabled, closeBehavior\)/)
  assert.match(desktopBridgeSource, /"tray_enabled"/)
  assert.match(desktopBridgeSource, /"close_behavior"/)
  assert.match(desktopMainSource, /configured_close_behavior/)
  assert.match(desktopMainSource, /"minimize-to-tray"/)
})

test('desktop close exits the process unless tray minimization was explicitly selected', () => {
  assert.match(desktopBridgeSource, /DEFAULT_CLOSE_BEHAVIOR: &str = "exit"/)
  assert.match(desktopBridgeSource, /"close_behavior_user_set"/)
  assert.match(desktopBridgeSource, /configured_close_behavior/)
  assert.match(desktopMainSource, /let behavior = configured_close_behavior\(&cfg\)/)
  assert.match(desktopMainSource, /window_clone\.app_handle\(\)\.exit\(0\)/)
  assert.match(desktopTrayComposableSource, /DEFAULT_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'exit'/)
  assert.match(settingsSource, /props\.desktopTraySettings\?\.closeBehavior \|\| 'exit'/)
})

test('desktop startup is single-instance and reopens the existing window', () => {
  assert.match(desktopMainSource, /tauri_plugin_single_instance/)
  assert.match(desktopMainSource, /window\.show\(\)/)
  assert.match(desktopMainSource, /window\.set_focus\(\)/)
})
