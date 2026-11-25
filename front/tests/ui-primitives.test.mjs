import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  activeConfirm,
  cancelActiveConfirm,
  clearAllFeedback,
  dismissToast,
  resolveActiveConfirm,
  showConfirmDialog,
  showFailToast,
  showSuccessToast,
  showToast,
  toasts,
  uiFeedback
} from '../src/services/uiFeedback.ts'

const tokensCss = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const baseCss = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
const uiDirUrl = new URL('../src/components/ui/', import.meta.url)

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('uiFeedback enqueues string and object toasts and auto-dismisses them', async () => {
  clearAllFeedback()

  const firstId = showToast({ message: '已复制密码', type: 'success', duration: 40 })
  assert.ok(firstId > 0)
  assert.equal(toasts.value.length, 1)
  assert.equal(toasts.value[0].message, '已复制密码')
  assert.equal(toasts.value[0].type, 'success')

  const secondId = showToast('普通提示')
  assert.equal(toasts.value.length, 2)
  assert.equal(toasts.value[1].type, 'info')

  await waitMs(70)
  assert.equal(toasts.value.some((t) => t.id === firstId), false)
  assert.equal(toasts.value.some((t) => t.id === secondId), true)

  dismissToast(secondId)
  assert.equal(toasts.value.length, 0)
})

test('uiFeedback helper wrappers and UiFeedback interface populate typed toasts', () => {
  clearAllFeedback()

  uiFeedback.toast('信息')
  uiFeedback.successToast('成功')
  uiFeedback.failToast('失败')
  showSuccessToast('再次成功', 0)
  showFailToast('再次失败', 0)

  // Max 4 visible toasts enforced cleanly
  assert.equal(toasts.value.length, 4)
  assert.deepEqual(
    toasts.value.map((item) => item.type),
    ['success', 'error', 'success', 'error']
  )

  clearAllFeedback()
  assert.equal(toasts.value.length, 0)
})

test('showConfirmDialog resolves on confirm and rejects on cancel', async () => {
  clearAllFeedback()

  const confirmPromise = showConfirmDialog({
    title: '删除条目',
    message: '确定移入回收站吗？',
    confirmButtonText: '删除',
    cancelButtonText: '返回',
    danger: true
  })

  assert.ok(activeConfirm.value)
  assert.equal(activeConfirm.value.title, '删除条目')
  assert.equal(activeConfirm.value.confirmButtonText, '删除')
  assert.equal(activeConfirm.value.cancelButtonText, '返回')
  assert.equal(activeConfirm.value.danger, true)

  resolveActiveConfirm()
  await assert.doesNotReject(confirmPromise)
  assert.equal(activeConfirm.value, null)

  const cancelPromise = uiFeedback.confirm({
    title: '清空回收站',
    message: '此操作不可恢复',
    confirmButtonColor: '#ee0a24'
  })

  assert.ok(activeConfirm.value)
  assert.equal(activeConfirm.value.danger, true)

  cancelActiveConfirm()
  await assert.rejects(cancelPromise)
  assert.equal(activeConfirm.value, null)
})

test('clearAllFeedback clears active toasts and rejects active & queued confirms cleanly', async () => {
  clearAllFeedback()

  showToast({ message: '同步中...', duration: 5000 })
  showToast({ message: '备份中...', duration: 5000 })
  assert.equal(toasts.value.length, 2)

  const firstConfirm = showConfirmDialog({
    title: '确认 1',
    message: '消息 1'
  })
  const secondConfirm = showConfirmDialog({
    title: '确认 2',
    message: '消息 2'
  })

  assert.equal(activeConfirm.value?.title, '确认 1')

  clearAllFeedback()

  assert.equal(toasts.value.length, 0)
  assert.equal(activeConfirm.value, null)
  await assert.rejects(firstConfirm)
  await assert.rejects(secondConfirm)
})

test('tokens.css defines light and dark themes with required high-contrast tokens and zero !important', () => {
  const lightBlockMatch = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)
  const darkBlockMatch = tokensCss.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)

  assert.ok(lightBlockMatch, 'expected :root light theme block')
  assert.ok(darkBlockMatch, "expected :root[data-theme='dark'] dark theme block")

  const lightBlock = lightBlockMatch[1]
  const darkBlock = darkBlockMatch[1]

  for (const token of [
    'color-scheme: light;',
    '--on-brand:',
    '--on-danger:',
    '--panel-border:',
    '--border-soft:',
    '--border-strong:',
    '--app-font-xs:',
    '--app-font-sm:',
    '--app-font-base:',
    '--app-font-md:',
    '--app-font-lg:',
    '--app-font-xl:',
    '--surface-container-low:',
    '--radius-sm:',
    '--radius-md:',
    '--radius-lg:',
    '--radius-xl:',
    '--shadow-sm:',
    '--shadow-md:',
    '--shadow-lg:',
    '--z-base:',
    '--z-dropdown:',
    '--z-modal:',
    '--z-toast:',
    '--z-confirm:'
  ]) {
    assert.ok(lightBlock.includes(token), `light theme missing ${token}`)
  }

  for (const token of [
    'color-scheme: dark;',
    '--on-brand: #09090b;',
    '--on-danger: #2a0606;',
    '--panel-border:',
    '--surface-container-low:'
  ]) {
    assert.ok(darkBlock.includes(token), `dark theme missing ${token}`)
  }

  assert.equal(tokensCss.includes('!important'), false, 'tokens.css must not use !important')
})

test('base.css provides reduced-motion support, 6px scrollbars, dark select parity, and zero !important', () => {
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(baseCss, /\*::\-webkit-scrollbar\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/s)
  assert.match(baseCss, /:focus-visible\s*\{[^}]*var\(--brand\)/s)
  assert.match(baseCss, /user-select:\s*text;/)
  assert.match(baseCss, /:root\[data-theme='dark'\]\s+select/)
  assert.equal(baseCss.includes('!important'), false, 'base.css must not use !important')
})

test('all UI primitives have zero Vant dependencies and zero !important declarations', () => {
  const files = readdirSync(uiDirUrl).filter((name) => name.endsWith('.vue'))
  assert.ok(files.length >= 9, `expected at least 9 UI primitives, found ${files.length}`)

  for (const file of files) {
    const source = readFileSync(new URL(file, uiDirUrl), 'utf8')
    assert.equal(source.includes('!important'), false, `${file} must not use !important`)
    assert.doesNotMatch(source, /from\s+['"]vant['"]/, `${file} must not import vant`)
    assert.doesNotMatch(source, /<van-/, `${file} must not use Vant components`)
  }
})

test('UiIcon supports every required password manager icon name', () => {
  const iconSource = readFileSync(new URL('UiIcon.vue', uiDirUrl), 'utf8')
  const requiredIcons = [
    'lock', 'unlock', 'search', 'plus', 'edit', 'copy', 'check', 'eye', 'eye-off',
    'trash', 'archive', 'restore', 'folder', 'folder-open', 'star', 'star-filled',
    'key', 'shield', 'cloud', 'settings', 'more', 'close', 'chevron-right',
    'chevron-down', 'arrow-left', 'external-link', 'refresh', 'download', 'upload',
    'wand', 'clock', 'paperclip', 'command', 'menu', 'check-square', 'move',
    'duplicate', 'sun', 'moon', 'monitor', 'qr', 'alert'
  ]
  for (const name of requiredIcons) {
    assert.ok(iconSource.includes(`name === '${name}'`), `UiIcon.vue missing icon '${name}'`)
  }
})
