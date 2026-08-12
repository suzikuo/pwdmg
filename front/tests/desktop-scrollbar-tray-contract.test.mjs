import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../main.py', import.meta.url), 'utf8')
const shellSource = readFileSync(new URL('../../pwdmg_core/desktop_shell.py', import.meta.url), 'utf8')
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
  assert.match(shellSource, /RESET_POSITION_COMMAND = "reset-position"/)
  assert.match(shellSource, /"重置窗口位置"/)
  assert.match(shellSource, /command_reset_position:\s*RESET_POSITION_COMMAND/)
  const resetStart = mainSource.indexOf('def reset_desktop_window_position')
  const resetBody = mainSource.slice(resetStart, mainSource.indexOf('def lock_desktop_vault'))
  assert.ok(resetStart >= 0)
  assert.match(resetBody, /window\.move\(target_x, target_y\)/)
  assert.match(resetBody, /state\.reset_position\(target_x, target_y\)/)
  assert.match(mainSource, /reset_position=reset_desktop_window_position/)
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
  assert.match(mainSource, /"tray_enabled": tray_enabled/)
  assert.match(mainSource, /"close_behavior": close_behavior/)
  assert.match(mainSource, /state\.should_minimize_on_close\(\)/)
  assert.match(shellSource, /message == tray_control_message/)
})

test('desktop startup is single-instance and reopens the existing window', () => {
  assert.match(shellSource, /class WindowsSingleInstance:/)
  assert.match(shellSource, /CreateMutexW\(None, False, self\.mutex_name\)/)
  assert.match(shellSource, /RegisterWindowMessageW\(SHOW_MAIN_MESSAGE_NAME\)/)
  assert.match(shellSource, /dispatch\(SHOW_MAIN_COMMAND\)/)
  assert.match(mainSource, /if not instance\.acquire\(\):\s*instance\.notify_existing\(\)\s*return/s)
  assert.match(mainSource, /finally:\s*instance\.release\(\)/s)
})
