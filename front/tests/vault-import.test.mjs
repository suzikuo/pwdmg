import assert from 'node:assert/strict'
import test from 'node:test'

import {
  existingImportFingerprints,
  importRecordFingerprint,
  parseCsv,
  parseVaultImport
} from '../src/services/vaultImport.ts'

test('CSV parsing preserves quoted commas, escaped quotes, and embedded newlines', () => {
  const rows = parseCsv('name,note\r\n"Git, Hub","line 1\nline ""2"""\r\n')
  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Git, Hub', 'line 1\nline "2"']
  ])
})

test('Chrome and Edge CSV imports map login fields and normalized domains', () => {
  const preview = parseVaultImport('name,url,username,password,note\nGitHub,https://www.github.com/login,alice,secret,"work, primary"', 'passwords.csv')
  assert.equal(preview.format, 'Chrome / Edge CSV')
  assert.equal(preview.records.length, 1)
  assert.deepEqual(preview.records[0], {
    importId: 'csv-0',
    kind: 'login',
    title: 'GitHub',
    folderPath: '',
    domains: ['github.com'],
    username: 'alice',
    email: '',
    password: 'secret',
    phone: '',
    note: 'work, primary',
    totpSecret: '',
    customFields: []
  })
})

test('Bitwarden JSON keeps structured login, secure note, card, and identity candidates', () => {
  const preview = parseVaultImport(JSON.stringify({
    items: [
      { type: 1, name: 'Login', login: { username: 'a', password: 'p', uris: [{ uri: 'https://example.com' }] } },
      { type: 2, name: 'Recovery', notes: 'codes' },
      { type: 3, name: 'Visa', card: { number: '4111111111111111', code: '123' } },
      { type: 4, name: 'Me', identity: { firstName: 'Alice', email: 'a@example.com' } }
    ]
  }), 'vault.json')
  assert.deepEqual(preview.records.map((item) => item.kind), ['login', 'secure-note', 'card', 'identity'])
  assert.deepEqual(preview.records[0].domains, ['example.com'])
  assert.equal(preview.records[2].customFields.find((field) => field.label === '卡号')?.protected, true)
  assert.equal(preview.records[3].customFields.find((field) => field.label === '邮箱')?.type, 'email')
})

test('Bitwarden JSON maps folder IDs to names and omits unknown folders', () => {
  const folderId = 'e8688d8c-b4ec-4666-9f84-db69d4f89999'
  const preview = parseVaultImport(JSON.stringify({
    folders: [{ id: folderId, name: 'Work/Accounts' }],
    items: [{ name: 'Mapped', folderId }, { name: 'Unknown', folderId: 'missing-id' }]
  }), 'vault.json')
  assert.deepEqual(preview.records.map((record) => record.folderPath), ['Work/Accounts', ''])
})

test('CSV keeps the first non-empty duplicate column and separates URL lists', () => {
  const preview = parseVaultImport(
    'name,password,password,url\nExample,first,,"https://one.example/path,a;param https://two.example;https://three.example\nhttps://four.example,https://five.example"\nFallback,,second,',
    'vault.csv'
  )
  assert.deepEqual(preview.records.map((record) => record.password), ['first', 'second'])
  assert.deepEqual(preview.records[0].domains, ['one.example', 'two.example', 'three.example', 'four.example', 'five.example'])
})

test('encrypted and malformed exports fail without partial records', () => {
  assert.throws(() => parseVaultImport('{"encrypted":true,"items":[]}', 'vault.json'), /暂不支持加密/)
  assert.throws(() => parseVaultImport('name,note\n"open,value', 'bad.csv'), /未闭合/)
})

test('existing vault fingerprints identify exact imported duplicates recursively', () => {
  const existing = existingImportFingerprints([{
    id: 'folder', kind: 'folder', title: 'Group', domains: [], children: [{
      id: 'login', kind: 'login', title: 'GitHub', domains: ['github.com'], username: 'alice', email: '', password: 'secret', children: []
    }]
  }])
  const fingerprint = importRecordFingerprint({
    kind: 'login', title: ' github ', domains: ['GITHUB.COM'], username: 'ALICE', email: '', password: 'secret',
    phone: '', note: '', totpSecret: '', customFields: []
  })
  assert.equal(existing.has(fingerprint), true)
})

test('exact duplicate fingerprints distinguish structured secret values', () => {
  const base = {
    kind: 'card', title: 'Travel card', domains: [], username: '', email: '', password: '', phone: '', note: '', totpSecret: ''
  }
  const first = importRecordFingerprint({
    ...base,
    customFields: [{ label: '卡号', value: '1111', type: 'secret', protected: true }]
  })
  const second = importRecordFingerprint({
    ...base,
    customFields: [{ label: '卡号', value: '2222', type: 'secret', protected: true }]
  })
  assert.notEqual(first, second)
})
