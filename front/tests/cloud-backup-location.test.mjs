import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DEFAULT_OSS_OBJECT_NAME, normalizeObjectName } from '../src/services/aliyunOss.ts'
import { defaultVaultPayload } from '../src/services/vaultDefaults.ts'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/settings/SettingsDrawer.vue', import.meta.url), 'utf8')
const androidVaultStoreSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidVaultStore.java', import.meta.url), 'utf8')

test('default cloud sync object is placed in pwd/ directory', () => {
  assert.equal(DEFAULT_OSS_OBJECT_NAME, 'pwd/mypwdmg-vault.json')
  assert.equal(defaultVaultPayload().settings.oss.objectName, 'pwd/mypwdmg-vault.json')
  assert.match(settingsSource, /placeholder="pwd\/mypwdmg-vault\.json"/)
  assert.match(androidVaultStoreSource, /pwd\/mypwdmg-vault\.json/)
})

test('resolves backup directory under pwd/backup/ and formats dated backup names', () => {
  assert.match(appSource, /function resolveBackupDirectory\(objectName: string\): string/)
  assert.match(appSource, /return `\$\{dir\}\/backup\/`/)
  assert.match(appSource, /return 'pwd\/backup\/'/)
  assert.match(appSource, /function makeDatedBackupName\(fileName: string\)/)
  assert.match(appSource, /return `\$\{backupDir\}\$\{baseName\}\.\$\{datePart\}-\$\{timePart\}-\$\{millisecondPart\}`/)
})

test('normalizeSettings migrates empty or legacy default objectName to pwd/mypwdmg-vault.json', () => {
  assert.match(appSource, /rawObjectName === 'mypwdmg-vault\.json'/)
  assert.match(appSource, /\? DEFAULT_OSS_OBJECT_NAME/)
})

test('cloud backup listing scans backupDir and supports legacy root backups', () => {
  assert.match(appSource, /async function loadCloudBackupItems/)
  assert.match(appSource, /client\.listObjects\(backupDir, 50\)/)
  assert.match(appSource, /fixedName\.startsWith\('pwd\/'\)/)
  assert.match(appSource, /item\.name\.startsWith\(backupDir\)/)
})
