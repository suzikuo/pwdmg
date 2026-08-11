import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../main.py', import.meta.url), 'utf8')
const shellSource = readFileSync(new URL('../../pwdmg_core/desktop_shell.py', import.meta.url), 'utf8')

test('desktop scrollbars use a compact shared style without exposing utility scrollers', () => {
  assert.match(styles, /\*::\-webkit-scrollbar\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/s)
  assert.match(styles, /\*::\-webkit-scrollbar-track[\s\S]*background:\s*transparent;/)
  assert.match(styles, /\*::\-webkit-scrollbar-thumb:hover/)
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
