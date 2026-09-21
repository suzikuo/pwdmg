import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const drawerSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const syncTypesSource = readFileSync(new URL('../src/services/sync/types.ts', import.meta.url), 'utf8')

test('SettingsDrawer renders actionable review log items and emits resolve-sync-log', () => {
  assert.match(drawerSource, /is-actionable': item\.status === 'review'/)
  assert.match(drawerSource, /item\.status === 'review' && emit\('resolve-sync-log', item\)/)
  assert.match(drawerSource, /<van-button[^>]*class="cloud-sync-log-action"/)
  assert.match(drawerSource, /手动处理/)
  assert.match(drawerSource, /'resolve-sync-log': \[item: CloudLog\]/)
})

test('App.vue connects SettingsDrawer to handleResolveSyncLog', () => {
  assert.match(appSource, /@resolve-sync-log="handleResolveSyncLog"/)
  assert.match(appSource, /async function handleResolveSyncLog\(item: CloudSyncLogEntry\)/)
  assert.match(appSource, /hasPendingCloudSyncReview\(\)/)
  assert.match(appSource, /startCloudDownload\({ objectName: item\.objectName }\)/)
})

test('CloudSyncPreview type supports alternatePassword', () => {
  assert.match(syncTypesSource, /alternatePassword\?: string/)
  assert.match(appSource, /alternatePassword: remoteSnapshot\.alternatePassword/)
})

test('isVaultPasswordChangedResult recognizes all password and decrypt mismatches', () => {
  assert.match(appSource, /result\.code === 'BAD_PASSWORD' \|\| \/vault password changed\|wrong password\|decrypt\|corrupt\|tag mismatch\/i\.test\(message\)/)
})

test('applyCloudDownload adopts alternatePassword locally and clears the password gate', () => {
  assert.match(appSource, /if \(preview\.alternatePassword !== undefined\)/)
  assert.match(appSource, /await api\.adoptVaultEncryptionFromEnvelope\(/)
  assert.match(appSource, /preview\.remoteEncryptionEnvelopeText/)
  assert.match(appSource, /autoSyncPasswordGate\.clear\(\.\.\.preview\.passwordGateScopeKeys\)/)
  assert.match(appSource, /本地主密码已与云端同步/)
})

test('completed download review closes the popup and replaces the pending log', () => {
  assert.match(appSource, /const applied = await withCloudSyncTimeout\(/)
  assert.match(appSource, /if \(applied && cloudSyncPreview\.value === preview\) closeCloudSyncReview\(\)/)
  assert.match(appSource, /\(item\.status === 'started' \|\| item\.status === 'review'\)/)
  assert.match(appSource, /normalizeObjectName\(item\.objectName\) === normalizeObjectName\(input\.objectName\)/)
})

test('download publication accepts the OSS scope carried by the applied payload', () => {
  assert.match(appSource, /function syncCloudSyncPreviewAfterDownload\(preview: CloudSyncPreview, appliedVault: VaultPayload\)/)
  assert.match(appSource, /syncCloudSyncPreviewAfterDownload\(preview, appliedVault\)/)
  assert.match(appSource, /preview\.sessionGeneration = vaultSession\.current\(\)/)
  assert.match(appSource, /preview\.cloudScopeId = currentCloudScopeId\(\)/)
})

test('passwordless upload to a password-protected cloud vault is blocked', () => {
  assert.match(appSource, /direction === 'upload' && state\.passwordless && usedAlternateRemotePassword/)
  assert.match(appSource, /云端保险库已设置主密码，当前设备未设置密码；直接上传将清除云端密码保护/)
  assert.match(appSource, /state\.passwordless && preview\.remoteNeedsSessionKeyRewrite/)
})

test('session lock preserves autoSyncPasswordGate while password unlock clears it', () => {
  assert.doesNotMatch(appSource, /function applyLockedUiState\(\) \{[\s\S]*?autoSyncPasswordGate\.clearAll\(\)/)
  assert.match(appSource, /if \(candidate\) autoSyncPasswordGate\.clearAll\(\)/)
})

test('CloudPasswordPrompt teleports to body with z-index above drawers and auto-focuses', () => {
  const promptSource = readFileSync(new URL('../src/components/sync/CloudPasswordPrompt.vue', import.meta.url), 'utf8')
  assert.match(promptSource, /teleport="body"/)
  assert.match(promptSource, /:z-index="3500"/)
  assert.match(promptSource, /:overlay-style="\{ zIndex: 3499 \}"/)
  assert.match(promptSource, /autofocus/)
  assert.match(appSource, /function requestCloudVaultPassword\(\) \{[\s\S]*?drawerOpen\.value = false/)
})

test('isSettingsChanged avoids unnecessary persistSettings calls', () => {
  assert.match(appSource, /function isSettingsChanged\(\)/)
  assert.match(appSource, /if \(!options\.skipPersist && isSettingsChanged\(\)\)/)
})
