import assert from 'node:assert/strict'
import test from 'node:test'

import { AliyunOSSAPI, APIResponseStatus } from '../src/services/aliyunOss.ts'
import { AliyunOssVaultStore } from '../src/services/cloud/aliyunOssVaultStore.ts'
import { RemoteVaultStatus } from '../src/services/cloud/remoteVaultStore.ts'

function createClient(overrides = {}) {
  return {
    downloadFile: async () => ({
      status: APIResponseStatus.Success,
      content: '{"version":1}',
      revision: 'remote-revision'
    }),
    uploadFile: async () => ({
      status: APIResponseStatus.Success,
      content: '上传成功',
      etag: 'uploaded-etag'
    }),
    getFileInfo: async (name) => ({
      status: APIResponseStatus.Success,
      content: {
        name,
        exists: true,
        size: 128,
        lastModified: '2026-07-31T12:00:00.000Z',
        etag: 'head-etag'
      }
    }),
    listFiles: async () => ({
      status: APIResponseStatus.Success,
      content: [{
        name: 'vault.json.backup',
        exists: true,
        size: 96,
        lastModified: '2026-07-31T11:00:00.000Z'
      }]
    }),
    ...overrides
  }
}

test('delegates remote vault operations and preserves revision metadata', async () => {
  const calls = []
  const client = createClient({
    downloadFile: async (...args) => {
      calls.push(['read', ...args])
      return {
        status: APIResponseStatus.Success,
        content: '{"version":1}',
        revision: 'remote-revision'
      }
    },
    uploadFile: async (...args) => {
      calls.push(['write', ...args])
      return {
        status: APIResponseStatus.Success,
        content: '上传成功',
        etag: 'uploaded-etag'
      }
    }
  })
  const store = new AliyunOssVaultStore(client)

  const read = await store.readObject('vault.json', 1024)
  const write = await store.writeObject('vault.json', '{"version":2}', 'application/json')

  assert.deepEqual(calls, [
    ['read', 'vault.json', 'text/plain', 1024],
    ['write', 'vault.json', '{"version":2}', 'application/json']
  ])
  assert.equal(read.status, RemoteVaultStatus.Success)
  assert.equal(read.revision, 'remote-revision')
  assert.equal(write.status, RemoteVaultStatus.Success)
  assert.equal(write.etag, 'uploaded-etag')
})

test('signs and sends a DELETE for the exact OSS object path', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const client = new AliyunOSSAPI('bucket', 'id', 'secret', 'oss-cn-test')
  const path = 'pwd/my vault.sync-v4/snapshots/abc.vault'
  globalThis.fetch = async (url, request) => {
    assert.equal(url, 'https://bucket.oss-cn-test.aliyuncs.com/pwd/my%20vault.sync-v4/snapshots/abc.vault')
    assert.equal(request.method, 'DELETE')
    const date = request.headers['x-oss-date']
    const expected = await client.generateSignature('DELETE', '', '', date, `x-oss-date:${date}`, `/bucket/${path}`)
    assert.equal(request.headers.Authorization, `OSS id:${expected}`)
    return new Response(null, { status: 204 })
  }
  assert.equal((await new AliyunOssVaultStore(client).deleteObject(path)).status, RemoteVaultStatus.Success)
})

test('maps Aliyun result statuses to provider-neutral statuses', async () => {
  const cases = [
    [APIResponseStatus.Fail, RemoteVaultStatus.Error],
    [APIResponseStatus.AuthFail, RemoteVaultStatus.AuthError],
    [APIResponseStatus.FileNotExist, RemoteVaultStatus.NotFound],
    [APIResponseStatus.QuotaExceeded, RemoteVaultStatus.QuotaExceeded]
  ]

  for (const [aliyunStatus, expectedStatus] of cases) {
    const store = new AliyunOssVaultStore(createClient({
      downloadFile: async () => ({ status: aliyunStatus, content: 'failure' })
    }))
    const response = await store.readObject('vault.json')
    assert.equal(response.status, expectedStatus)
    assert.equal(response.content, 'failure')
  }
})

test('rejects non-text reads at the provider boundary', async () => {
  const store = new AliyunOssVaultStore(createClient({
    downloadFile: async () => ({
      status: APIResponseStatus.Success,
      content: new Blob(['binary response'])
    })
  }))

  const response = await store.readObject('vault.json')

  assert.equal(response.status, RemoteVaultStatus.Error)
  assert.equal(response.content, '远端存储返回了非文本响应')
})

test('normalizes object info and list results across the provider boundary', async () => {
  const store = new AliyunOssVaultStore(createClient())

  const info = await store.getObjectInfo('vault.json')
  const listed = await store.listObjects('vault.json', 50)

  assert.equal(info.status, RemoteVaultStatus.Success)
  assert.deepEqual(info.content, {
    name: 'vault.json',
    exists: true,
    size: 128,
    lastModified: '2026-07-31T12:00:00.000Z',
    etag: 'head-etag',
    versionId: undefined
  })
  assert.equal(listed.status, RemoteVaultStatus.Success)
  assert.deepEqual(listed.content, [{
    name: 'vault.json.backup',
    exists: true,
    size: 96,
    lastModified: '2026-07-31T11:00:00.000Z',
    etag: undefined,
    versionId: undefined
  }])
})

test('preserves not-found object info for existing UI behavior', async () => {
  const store = new AliyunOssVaultStore(createClient({
    getFileInfo: async (name) => ({
      status: APIResponseStatus.FileNotExist,
      content: { name, exists: false, size: 0, lastModified: '' }
    })
  }))

  const response = await store.getObjectInfo('missing.json')

  assert.equal(response.status, RemoteVaultStatus.NotFound)
  assert.deepEqual(response.content, {
    name: 'missing.json',
    exists: false,
    size: 0,
    lastModified: '',
    etag: undefined,
    versionId: undefined
  })
})
