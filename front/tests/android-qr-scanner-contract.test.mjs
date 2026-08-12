import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')
const adapterSource = readFileSync(new URL('../src/services/androidStorageAdapter.ts', import.meta.url), 'utf8')

test('entry editor uses bounded QR image selection on Android and desktop', () => {
  assert.match(appSource, /:show-qr-image-picker="isDesktopRuntime \|\| isAndroidRuntime"/)
  assert.doesNotMatch(appSource, /show-qr-scanner/)
  assert.match(editorSource, /v-if="showQrImagePicker" #button/)
  assert.match(editorSource, /aria-label="从图片识别 TOTP 二维码"/)
  assert.match(editorSource, /accept="image\/png,image\/jpeg,image\/webp,image\/bmp/)
})

test('scan results are bound to the originating editor before mutation', () => {
  assert.match(editorSource, /qrImageOrigin = \{ editingId: props\.editingId, formId: props\.form\.id \}/)
  assert.match(editorSource, /emit\('import-totp-qr-image', file, origin\.editingId, origin\.formId\)/)
  assert.match(appSource, /async function importTotpQrImage\(file: File, targetEditingId: string, targetFormId: string\)/)
  assert.match(appSource, /editingId\.value !== targetEditingId \|\| form\.id !== targetFormId/)
  assert.match(appSource, /payload\.kind === 'passkey-hybrid'/)
})

test('Android adapter no longer exposes a camera QR task', () => {
  assert.doesNotMatch(adapterSource, /startQrScan/)
  assert.doesNotMatch(adapterSource, /getQrScanTaskState/)
  assert.doesNotMatch(adapterSource, /CAMERA_PERMISSION_DENIED/)
})
