import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { AliyunOSSAPI, APIResponseStatus } from '../src/services/aliyunOss.ts'

const originalFetch = globalThis.fetch
const originalDOMParser = globalThis.DOMParser

test.afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalDOMParser) globalThis.DOMParser = originalDOMParser
  else delete globalThis.DOMParser
})

function createClient(signal) {
  return new AliyunOSSAPI('test-bucket', 'access-key', 'access-secret', 'oss-cn-hangzhou', signal)
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

test('parses namespaced OSS list responses so immutable sync heads are discoverable', async () => {
  const element = (name, text = '', children = []) => ({
    textContent: text,
    getElementsByTagNameNS: (_namespace, localName) => [
      ...(name === localName ? [element(name, text, children)] : []),
      ...children.flatMap((child) => child.getElementsByTagNameNS(_namespace, localName))
    ],
    getElementsByTagName: (localName) => [
      ...(name === localName ? [element(name, text, children)] : []),
      ...children.flatMap((child) => child.getElementsByTagName(localName))
    ]
  })
  const contents = element('Contents', '', [
    element('Key', 'vault.json.sync-v3/commits/0000000000001-client.json'),
    element('Size', '42'),
    element('LastModified', '2026-09-20T10:00:00.000Z')
  ])
  const document = element('ListBucketResult', '', [
    contents,
    element('IsTruncated', 'false')
  ])
  globalThis.DOMParser = class {
    parseFromString() {
      return document
    }
  }
  const listedPrefixes = []
  globalThis.fetch = async (url) => {
    listedPrefixes.push(new URL(url).searchParams.get('prefix'))
    return new Response('<ListBucketResult xmlns="http://doc.oss-cn-hangzhou.aliyuncs.com" />', { status: 200 })
  }

  const response = await createClient().listFiles('vault.json.sync-v3/commits/', 100)
  await createClient().listFiles()

  assert.deepEqual(listedPrefixes, ['vault.json.sync-v3/commits/', ''])

  assert.equal(response.status, APIResponseStatus.Success)
  assert.equal(response.content[0].name, 'vault.json.sync-v3/commits/0000000000001-client.json')
})

test('forwards active vault-session cancellation to an in-flight fetch', async () => {
  const controller = new AbortController()
  const started = mockPendingFetch()
  const uploading = createClient(controller.signal).uploadFile('vault.json', '{}')
  const requestSignal = await started

  assert.equal(requestSignal.aborted, false)
  controller.abort()
  assert.equal(requestSignal.aborted, true)
  assert.equal((await uploading).status, APIResponseStatus.Fail)
})

test('aborts fetch at 30 seconds even with an active vault-session signal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controller = new AbortController()
  const started = mockPendingFetch()
  const uploading = createClient(controller.signal).uploadFile('vault.json', '{}')
  const requestSignal = await started

  t.mock.timers.tick(29_999)
  assert.equal(requestSignal.aborted, false)
  t.mock.timers.tick(1)
  assert.equal(requestSignal.aborted, true)
  assert.equal(controller.signal.aborted, false)
  const result = await uploading
  assert.equal(result.status, APIResponseStatus.Fail)
  assert.match(result.content, /请求超时/)
})

function mockPendingFetch() {
  return new Promise((started) => {
    globalThis.fetch = (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      started(signal)
    })
  })
}
