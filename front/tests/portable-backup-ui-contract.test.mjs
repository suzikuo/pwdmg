import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8')
const androidAdapterSource = readFileSync(new URL('../src/services/androidStorageAdapter.ts', import.meta.url), 'utf8')
const androidBridgeSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidPasswordBridge.java', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../../src-tauri/src/bridge.rs', import.meta.url), 'utf8')
const portableSource = readFileSync(new URL('../../src-tauri/crates/core/src/portable.rs', import.meta.url), 'utf8')

test('desktop backup settings expose compact complete-package actions', () => {
  assert.match(settingsSource, /class="portable-backup-panel"/)
  assert.match(settingsSource, /export-portable-backup/)
  assert.match(settingsSource, /import-portable-backup/)
  assert.match(appSource, /portable-backup-supported="isDesktopRuntime"/)
  assert.match(appSource, /title="恢复完整备份"/)
})

test('native import keeps selected paths behind an opaque retryable token', () => {
  const selectStart = bridgeSource.indexOf('"selectPortableBackupPackage"')
  const importStart = bridgeSource.indexOf('"importPortableBackupPackage"')
  const selectBody = bridgeSource.slice(selectStart, importStart)
  const importBody = bridgeSource.slice(importStart, bridgeSource.indexOf('"discardPortableBackupSelection"'))
  assert.match(selectBody, /selectionToken/)
  assert.match(selectBody, /state\.portable_backup_selection/)
  assert.doesNotMatch(selectBody.slice(selectBody.indexOf('Ok(json!({')), /"path"/)
  assert.ok(importBody.indexOf('import_portable_backup') < importBody.indexOf('*selection_guard = None'))
})

test('Android backup settings export the encrypted vault through a bounded document task', () => {
  assert.match(settingsSource, /androidVaultBackupSupported/)
  assert.match(settingsSource, /仅包含加密保险库，不含附件/)
  assert.match(settingsSource, /export-android-vault/)
  assert.match(appSource, /:android-vault-backup-supported="isAndroidRuntime"/)
  assert.match(appSource, /api\.exportAndroidVaultFile/)
  assert.match(apiSource, /exportAndroidVaultFile: \(displayName, contentText\)/)
  assert.match(androidAdapterSource, /startVaultExport/)
  assert.match(androidAdapterSource, /getVaultExportTaskState/)
  assert.match(androidBridgeSource, /VAULT_EXPORT_REQUEST_CODE = 7432/)
  assert.match(androidBridgeSource, /MAX_VAULT_EXPORT_BYTES = 24 \* 1024 \* 1024/)
  assert.match(androidBridgeSource, /documentExportTasks\.remove\(entry\.getKey\(\), task\)/)
  assert.ok(androidBridgeSource.indexOf('content = Base64.getDecoder().decode(value)') < androidBridgeSource.indexOf('if (content.length > maxBytes)'))
  assert.match(androidBridgeSource, /DOCUMENT_EXPORT_TIMEOUT_MINUTES = 5/)
  assert.match(androidBridgeSource, /task\.setTimeoutFuture\(documentExportTimeoutExecutor\.schedule/)
  assert.match(androidBridgeSource, /DOCUMENT_EXPORT_TIMEOUT/)
  assert.match(androidBridgeSource, /status = "running";\s*cancelTimeout\(\);/)
  assert.match(androidBridgeSource, /cancelTimeout\(\);[\s\S]*Arrays\.fill\(content, \(byte\) 0\)/)
})

test('restore verifies objects before replacing metadata and clears the frontend session only on success', () => {
  const serviceStart = portableSource.indexOf('pub fn import_portable_backup')
  const serviceBody = portableSource.slice(serviceStart)
  assert.ok(serviceBody.indexOf('decrypt_payload(password, &envelope)') < serviceBody.indexOf('fs::write(target, content)'))
  assert.ok(serviceBody.indexOf('fs::write(target, content)') < serviceBody.indexOf('fs::write(&target_vault, envelope_text)'))

  const apiStart = apiSource.indexOf('async function importPortableBackupPackage')
  const apiBody = apiSource.slice(apiStart, apiSource.indexOf('async function discardPortableBackupSelection'))
  assert.match(apiBody, /if \(result\.ok\) await lock\(\)/)
  assert.match(appSource, /api\.discardPortableBackupSelection\(token\)/)
})
