import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { AliyunOSSAPI, APIResponseStatus } from '../src/services/aliyunOss.ts'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

function createClient() {
  return new AliyunOSSAPI('test-bucket', 'access-key', 'access-secret', 'oss-cn-hangzhou')
}

test('uploads without conditional headers that OSS PutObject rejects', async () => {
  let requestHeaders = new Headers()
  globalThis.fetch = async (_url, init) => {
    requestHeaders = new Headers(init?.headers)
    return new Response('', { status: 200 })
  }

  const response = await createClient().uploadFile('vault.json', '{"version":1}')

  assert.equal(response.status, APIResponseStatus.Success)
  assert.equal(requestHeaders.has('If-Match'), false)
  assert.equal(requestHeaders.has('If-None-Match'), false)
  assert.equal(requestHeaders.get('Content-Type'), 'application/json')
})

test('downloads successfully without an exposed ETag and returns a content revision', async () => {
  const content = '{"version":1,"entries":[]}'
  globalThis.fetch = async () => new Response(content, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

  const response = await createClient().downloadFile('vault.json', 'text/plain')

  assert.equal(response.status, APIResponseStatus.Success)
  assert.equal(response.content, content)
  assert.equal(response.etag, '')
  assert.equal(response.revision, createHash('sha256').update(content).digest('hex'))
})

test('immutable uploads use the OSS forbid-overwrite contract and surface collisions', async () => {
  let requestHeaders = new Headers()
  globalThis.fetch = async (_url, init) => {
    requestHeaders = new Headers(init?.headers)
    return new Response('<Error><Code>FileAlreadyExists</Code></Error>', { status: 409 })
  }

  const response = await createClient().uploadFile(
    'vault.sync-v3/generation.json',
    '{}',
    'application/json',
    { forbidOverwrite: true }
  )

  assert.equal(requestHeaders.get('x-oss-forbid-overwrite'), 'true')
  assert.equal(response.status, APIResponseStatus.Conflict)
})

test('binds requests to the active vault-session abort signal', async () => {
  const controller = new AbortController()
  let requestSignal
  globalThis.fetch = async (_url, init) => {
    requestSignal = init?.signal
    return new Response('', { status: 200 })
  }

  const client = new AliyunOSSAPI(
    'test-bucket',
    'access-key',
    'access-secret',
    'oss-cn-hangzhou',
    controller.signal
  )
  await client.uploadFile('vault.json', '{}')

  assert.equal(requestSignal, controller.signal)
  controller.abort()
  assert.equal(requestSignal.aborted, true)
})
