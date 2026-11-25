import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const syncStoreSource = readFileSync(new URL('../src/stores/syncStore.ts', import.meta.url), 'utf8')
const syncEngineSource = readFileSync(new URL('../src/services/sync/syncEngine.ts', import.meta.url), 'utf8')
const sessionStoreSource = readFileSync(new URL('../src/stores/sessionStore.ts', import.meta.url), 'utf8')
const drawerSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const syncTypesSource = readFileSync(new URL('../src/services/sync/types.ts', import.meta.url), 'utf8')

test('SettingsDrawer renders actionable review log items and invokes handleResolveSyncLog via sync store', () => {
  assert.match(drawerSource, /'is-actionable': item\.status === 'review'/)
  assert.match(drawerSource, /item\.status === 'review' && sync\.handleResolveSyncLog\(item\)/)
  assert.match(drawerSource, /<UiButton[\s\S]*?class="cloud-sync-log-action"[\s\S]*?@click\.stop="sync\.handleResolveSyncLog\(item\)"/)
  assert.match(drawerSource, /手动处理/)
  assert.match(drawerSource, /useAppStores\(\)/)
})

test('App.vue provides app stores to SettingsDrawer and sync store implements handleResolveSyncLog', () => {
  assert.match(appSource, /provideAppStores\(stores\)/)
  assert.match(syncStoreSource, /async function handleResolveSyncLog\(item: CloudSyncLogEntry\)/)
  assert.match(syncStoreSource, /hasPendingCloudSyncReview\(\)/)
  assert.match(syncStoreSource, /startCloudDownload\(\{ objectName: item\.objectName \}\)/)
})

test('CloudSyncPreview type supports alternatePassword', () => {
  assert.match(syncTypesSource, /alternatePassword\?: string/)
  assert.match(syncEngineSource, /alternatePassword: remoteSnapshot\.alternatePassword/)
})

test('sync preview defers encryption adoption to review confirmation, including password-only changes', () => {
  const previewLoader = syncEngineSource.slice(
    syncEngineSource.indexOf('async function loadVerifiedCloudRemote'),
    syncEngineSource.indexOf('async function checkCloudBackupInfo')
  )
  assert.doesNotMatch(previewLoader, /adoptVerifiedCloudEncryption|adoptVaultEncryptionFromEnvelope/)
  assert.match(syncEngineSource, /if \(preview\.usedAlternatePassword\) \{[\s\S]*?showCloudSyncReview\(\)[\s\S]*?return\s*\}\s*if \(!items\.length\)/)
  assert.match(syncEngineSource, /if \(!options\.closeReview \|\| !isCurrent\(\)/)
  assert.match(syncStoreSource, /function closeCloudSyncReview\(\): void \{[\s\S]*?delete cloudSyncPreview\.value\.alternatePassword/)
})

test('isVaultPasswordChangedResult recognizes all password and decrypt mismatches', () => {
  assert.match(syncEngineSource, /result\.code === 'BAD_PASSWORD' \|\| \/vault password changed\|wrong password\|decrypt\|corrupt\|tag mismatch\/i\.test\(message\)/)
})

test('applyCloudDownload adopts alternatePassword locally and clears the password gate', () => {
  assert.match(syncEngineSource, /if \(preview\.alternatePassword !== undefined\)/)
  assert.match(syncEngineSource, /await api\.adoptVaultEncryptionFromEnvelope\(/)
  assert.match(syncEngineSource, /preview\.remoteEncryptionEnvelopeText/)
  assert.match(syncEngineSource, /autoSyncPasswordGate\.clear\(\.\.\.preview\.passwordGateScopeKeys\)/)
  assert.match(syncEngineSource, /本地主密码已与云端同步/)
})

test('completed download review closes the popup and replaces the pending log', () => {
  assert.match(syncEngineSource, /const applied = await withCloudSyncTimeout\(/)
  assert.match(syncEngineSource, /if \(applied && deps\.getCloudSyncPreview\(\) === preview\) deps\.closeCloudSyncReview\(\)/)
  assert.match(syncStoreSource, /\(item\.status === 'started' \|\| item\.status === 'review'\)/)
  assert.match(syncStoreSource, /normalizeObjectName\(item\.objectName\) === normalizeObjectName\(input\.objectName\)/)
})

test('download publication accepts the OSS scope carried by the applied payload', () => {
  assert.match(syncEngineSource, /function syncCloudSyncPreviewAfterDownload\(preview: CloudSyncPreview, appliedVault: VaultPayload\)/)
  assert.match(syncEngineSource, /syncCloudSyncPreviewAfterDownload\(preview, appliedVault\)/)
  assert.match(syncEngineSource, /preview\.sessionGeneration = deps\.getSessionGeneration\(\)/)
  assert.match(syncEngineSource, /preview\.cloudScopeId = currentCloudScopeId\(\)/)
})

test('passwordless upload to a password-protected cloud vault is blocked', () => {
  assert.match(syncEngineSource, /direction === 'upload' && deps\.isPasswordless\(\) && usedAlternateRemotePassword/)
  assert.match(syncEngineSource, /云端保险库已设置主密码，当前设备未设置密码；直接上传将清除云端密码保护/)
  assert.match(syncEngineSource, /deps\.isPasswordless\(\) && preview\.remoteNeedsSessionKeyRewrite/)
})

test('session lock preserves autoSyncPasswordGate while password unlock clears it', () => {
  assert.doesNotMatch(sessionStoreSource, /function applyLockedUiState\(\): void \{[\s\S]*?clearAllAutoSyncPasswordGates\(\)/)
  assert.doesNotMatch(syncStoreSource, /function resetOnLock\(\): void \{[\s\S]*?autoSyncPasswordGate\.clearAll\(\)/)
  assert.match(sessionStoreSource, /if \(candidate\) syncBridge\?\.clearAllAutoSyncPasswordGates\(\)/)
  assert.match(syncStoreSource, /function clearAllAutoSyncPasswordGates\(\): void \{\s*autoSyncPasswordGate\.clearAll\(\)\s*\}/)
})

test('CloudPasswordPrompt renders in UiModal (teleported to body) with backdrop guard and auto-focuses', () => {
  const promptSource = readFileSync(new URL('../src/components/sync/CloudPasswordPrompt.vue', import.meta.url), 'utf8')
  const modalSource = readFileSync(new URL('../src/components/ui/UiModal.vue', import.meta.url), 'utf8')
  assert.match(promptSource, /<UiModal[\s\S]*?:close-on-backdrop="false"/)
  assert.match(promptSource, /autofocus/)
  assert.match(promptSource, /inputRef\.value\?\.focus\?\.\(\)/)
  assert.match(modalSource, /<Teleport to="body">/)
  assert.match(syncStoreSource, /function requestCloudVaultPassword\(\): Promise<string \| null> \{[\s\S]*?ui\.drawerOpen\.value = false/)
})

test('isSettingsChanged avoids unnecessary persistSettings calls', () => {
  assert.match(syncStoreSource, /function isSettingsChanged\(\)/)
  assert.match(syncEngineSource, /if \(!options\.skipPersist && deps\.isSettingsChanged\(\)\)/)
})
