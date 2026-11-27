import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const baseStyles = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
const desktopMainSource = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8')
const desktopBridgeSource = readFileSync(new URL('../../src-tauri/src/bridge.rs', import.meta.url), 'utf8')
const desktopTrayComposableSource = readFileSync(new URL('../src/composables/useDesktopTraySettings.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const sessionStoreSource = readFileSync(new URL('../src/stores/sessionStore.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const traySettingsSource = readFileSync(new URL('../src/composables/useDesktopTraySettings.ts', import.meta.url), 'utf8')

test('desktop scrollbars use a usable 6px shared style and respect prefers-reduced-motion', () => {
  assert.match(baseStyles, /@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*scrollbar-width:\s*thin;[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\);/)
  assert.match(baseStyles, /\*::\-webkit-scrollbar\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/s)
  assert.match(baseStyles, /\*::\-webkit-scrollbar-track[\s\S]*background:\s*var\(--scrollbar-track\);/)
  assert.match(baseStyles, /\*::\-webkit-scrollbar-button\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s)
  assert.match(baseStyles, /\*::\-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/s)
  assert.match(baseStyles, /\*::\-webkit-scrollbar-thumb:active\s*\{[^}]*background:\s*var\(--scrollbar-thumb-active\);/s)
  assert.match(baseStyles, /\.search-filter-segments::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/s)
  assert.match(baseStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('tray reset command moves to the default coordinates and persists them', () => {
  assert.match(desktopMainSource, /"reset_position"/)
  assert.match(desktopMainSource, /"重置窗口位置"/)
  assert.match(desktopMainSource, /window\.set_size/)
  assert.match(desktopMainSource, /window\.center\(\)/)
})

test('desktop settings expose an immediate tray switch and close behavior', () => {
  assert.match(settingsSource, /v-if="showDesktopTraySettings"/)
  assert.match(settingsSource, /@update:model-value="toggleDesktopTray\(\$event\)"/)
  assert.match(settingsSource, /:loading="desktopTrayBusy \|\| !desktopTraySettings"/)
  assert.match(settingsSource, /v-if="desktopTraySettings\?\.trayEnabled === true"/)
  assert.match(settingsSource, /setDesktopCloseBehavior\('minimize-to-tray'\)/)
  assert.match(settingsSource, /setDesktopCloseBehavior\('exit'\)/)
  assert.match(appSource, /useDesktopTraySettings\(isDesktopRuntime\)/)
  assert.match(appSource, /desktopTraySettingsComposable\.load\(\)/)
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

test('desktop settings show and save GPU acceleration through the Windows host', () => {
  assert.match(settingsSource, /v-if="typeof desktopTraySettings\?\.gpuAccelerationEnabled === 'boolean'"/)
  assert.match(settingsSource, /:model-value="desktopTraySettings\.gpuAccelerationEnabled"/)
  assert.match(settingsSource, /@update:model-value="platform\?\.desktopTray\.setGpuAcceleration\(\$event\)"/)
  assert.match(desktopTrayComposableSource, /api\.setDesktopGpuAcceleration\(enabled\)/)
  assert.match(apiSource, /setDesktopGpuAcceleration: async \(enabled\) => useDesktopStorage\(\)/)
  assert.match(desktopBridgeSource, /"setDesktopGpuAcceleration" if cfg!\(windows\)/)
  assert.match(desktopMainSource, /#\[cfg\(windows\)\]\s+if let Some\(args\) = desktop_config::windows_webview_browser_args\(&config\)/)
})

test('desktop close exits the process unless tray minimization was explicitly selected', () => {
  assert.match(desktopBridgeSource, /DEFAULT_CLOSE_BEHAVIOR: &str = "exit"/)
  assert.match(desktopBridgeSource, /"close_behavior_user_set"/)
  assert.match(desktopBridgeSource, /configured_close_behavior/)
  assert.match(desktopMainSource, /let behavior = configured_close_behavior\(&cfg\)/)
  assert.match(desktopMainSource, /window_clone\.app_handle\(\)\.exit\(0\)/)
  assert.match(desktopTrayComposableSource, /DEFAULT_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'exit'/)
  assert.match(settingsSource, /desktopTraySettings\.value\?\.closeBehavior \|\| 'exit'/)
})

test('desktop startup is single-instance and reopens the existing window', () => {
  assert.match(desktopMainSource, /tauri_plugin_single_instance/)
  assert.match(desktopMainSource, /window\.show\(\)/)
  assert.match(desktopMainSource, /window\.set_focus\(\)/)
})

test('desktop tray lock emits vault-locked and frontend immediately locks UI', () => {
  assert.match(desktopMainSource, /app\.emit\(\s*"vault-locked"/)
  assert.match(apiSource, /subscribeNativeLock:/)
  assert.match(appSource, /session\.mountNativeLockSubscription\(\)/)
  assert.match(appSource, /session\.unmountNativeLockSubscription\(\)/)
  assert.match(sessionStoreSource, /api\.subscribeNativeLock\(/)
  assert.match(sessionStoreSource, /unsubscribeNativeLock\?\.\(\)/)
})
