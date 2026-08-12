import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/DetailContent.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const androidAdapterSource = readFileSync(new URL('../src/services/androidStorageAdapter.ts', import.meta.url), 'utf8')
const androidBridgeSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidPasswordBridge.java', import.meta.url), 'utf8')
const androidActivitySource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/MainActivity.java', import.meta.url), 'utf8')
const androidStoreSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidAttachmentStore.java', import.meta.url), 'utf8')
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

test('Android stores only bounded encrypted objects and exports through the document picker', () => {
  assert.doesNotMatch(androidAdapterSource, /Attachments are not supported on Android/)
  assert.match(androidAdapterSource, /call\('writeAttachmentObject'/)
  assert.match(androidAdapterSource, /JSON\.stringify\(referencedIds\)/)
  assert.match(androidAdapterSource, /startAttachmentExport/)
  assert.match(apiSource, /exportAndroidAttachmentFile\(reference\.name, reference\.mimeType/)
  assert.match(androidBridgeSource, /Intent\.ACTION_CREATE_DOCUMENT/)
  assert.match(androidActivitySource, /passwordBridge\.handleActivityResult/)
  assert.match(androidStoreSource, /Attachment objects are immutable/)
  assert.match(androidStoreSource, /MAX_ATTACHMENT_STORE_BYTES = 256L \* 1024L \* 1024L/)
  assert.match(appSource, /:attachment-actions-supported="true"/)
})

test('cloud object ordering is wired before vault metadata persistence', () => {
  const downloadStart = appSource.indexOf('async function applyCloudDownload')
  const uploadStart = appSource.indexOf('async function applyCloudUpload')
  const downloadBody = appSource.slice(downloadStart, uploadStart)
  const uploadBody = appSource.slice(uploadStart, appSource.indexOf('function failCloudSyncApply'))
  assert.ok(downloadBody.indexOf('ensureLocalAttachmentObjects') < downloadBody.indexOf('saveVaultForCurrentSession'))
  assert.ok(uploadBody.indexOf('ensureRemoteAttachmentObjects') < uploadBody.indexOf('writeManagedCloudVault'))
})

test('settings expose reference-aware attachment storage accounting and cleanup', () => {
  assert.match(settingsSource, /attachmentStorageState\.activeBytes/)
  assert.match(settingsSource, /attachmentStorageState\.retainedBytes/)
  assert.match(settingsSource, /emit\('collect-attachments'\)/)
  assert.match(appSource, /api\.getAttachmentStorageState\(\)/)
  assert.match(appSource, /collectAttachmentReferences\(vault\.value\.entries\)/)
  assert.match(appSource, /await api\.collectAttachmentObjects\(ids\)/)
  assert.match(appSource, /title: '整理附件存储'/)
})
