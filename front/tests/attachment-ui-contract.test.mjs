import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/DetailContent.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../main.py', import.meta.url), 'utf8')

test('detail view exposes compact bounded attachment controls', () => {
  assert.match(detailSource, /class="detail-attachments"/)
  assert.match(detailSource, /type="file"/)
  assert.match(detailSource, /save-attachment/)
  assert.match(detailSource, /remove-attachment/)
  assert.match(appSource, /file\.size > MAX_ATTACHMENT_BYTES/)
  assert.match(appSource, /await api\.retainAttachmentObject\(created\.id\)/)
  assert.match(appSource, /createResult\.data\.vault/)
  assert.match(apiSource, /generateAttachmentKey\(\)/)
})

test('desktop export uses Save As without auto-opening plaintext temporary files', () => {
  assert.match(apiSource, /saveAttachmentFile/)
  assert.match(apiSource, /bytes\.fill\(0\)/)
  assert.match(mainSource, /webview\.SAVE_DIALOG/)
  assert.match(mainSource, /os\.replace\(str\(temp_path\), str\(target\)\)/)
  assert.doesNotMatch(mainSource.slice(mainSource.indexOf('def saveAttachmentFile'), mainSource.indexOf('def cleanupLegacyStorage')), /startfile|Popen|open_external/i)
})

test('cloud object ordering is wired before vault metadata persistence', () => {
  const downloadStart = appSource.indexOf('async function applyCloudDownload')
  const uploadStart = appSource.indexOf('async function applyCloudUpload')
  const downloadBody = appSource.slice(downloadStart, uploadStart)
  const uploadBody = appSource.slice(uploadStart, appSource.indexOf('function failCloudSyncApply'))
  assert.ok(downloadBody.indexOf('ensureLocalAttachmentObjects') < downloadBody.indexOf('saveVaultForCurrentSession'))
  assert.ok(uploadBody.indexOf('ensureRemoteAttachmentObjects') < uploadBody.indexOf('writeManagedCloudVault'))
})
