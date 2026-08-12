import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getQrDecodeDimensions, validateQrImageMetadata } from '../src/services/desktopQrImage.ts'

const serviceSource = readFileSync(new URL('../src/services/desktopQrImage.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const editorSource = readFileSync(new URL('../src/components/editor/EntryEditor.vue', import.meta.url), 'utf8')

test('desktop QR image validation rejects unsafe files and scales bounded images', () => {
  assert.throws(() => validateQrImageMetadata({ name: 'qr.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }))
  assert.throws(() => validateQrImageMetadata({ name: 'qr.exe', type: 'application/octet-stream', size: 100 }))
  assert.throws(() => getQrDecodeDimensions(8193, 100))
  assert.throws(() => getQrDecodeDimensions(5000, 5000))
  assert.deepEqual(getQrDecodeDimensions(1000, 700), { width: 1000, height: 700 })
  assert.deepEqual(getQrDecodeDimensions(4096, 2048), { width: 2048, height: 1024 })
})

test('desktop QR image service bounds bytes, dimensions, pixels, and decoded payloads', () => {
  assert.match(serviceSource, /MAX_QR_IMAGE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(serviceSource, /MAX_QR_IMAGE_PIXELS = 20_000_000/)
  assert.match(serviceSource, /MAX_QR_IMAGE_DIMENSION = 8192/)
  assert.match(serviceSource, /MAX_QR_DECODE_PIXELS = 4_000_000/)
  assert.match(serviceSource, /MAX_QR_DECODE_DIMENSION = 2048/)
  assert.match(serviceSource, /createImageBitmap/)
  assert.match(serviceSource, /getImageData/)
  assert.match(serviceSource, /jsQR\(/)
  assert.match(serviceSource, /value\.length > MAX_QR_PAYLOAD_CHARS/)
  assert.match(serviceSource, /loaded\.close\(\)/)
})

test('QR image action supports desktop and Android image selection', () => {
  assert.match(appSource, /:show-qr-image-picker="isDesktopRuntime \|\| isAndroidRuntime"/)
  assert.match(appSource, /@import-totp-qr-image="importTotpQrImage"/)
  assert.match(appSource, /if \(\(!isDesktopRuntime && !isAndroidRuntime\) \|\| qrImageBusy\.value\) return/)
  assert.match(appSource, /await applyTotpQrValue\(value, targetEditingId, targetFormId\)/)
  assert.match(appSource, /editingId\.value !== targetEditingId \|\| form\.id !== targetFormId/)
  assert.match(editorSource, /showQrImagePicker: boolean/)
  assert.match(editorSource, /accept="image\/png,image\/jpeg,image\/webp,image\/bmp/)
  assert.match(editorSource, /input\.value = ''/)
  assert.match(editorSource, /@change="handleQrImageSelected"/)
})
