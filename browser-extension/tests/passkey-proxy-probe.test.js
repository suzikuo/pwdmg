'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  ProbeCode,
  createPasskeyProxyProbeController
} = require('../passkey-proxy-probe.js')

class FakeEvent {
  constructor() {
    this.listeners = []
  }

  addListener(listener) {
    this.listeners.push(listener)
  }

  async emit(details) {
    return Promise.all(this.listeners.map((listener) => listener(details)))
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function manualTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(callback, duration) {
      const id = nextId++
      pending.set(id, { callback, duration })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    fireNext() {
      const item = pending.entries().next()
      assert.equal(item.done, false, 'expected a pending timer')
      const [id, timer] = item.value
      pending.delete(id)
      timer.callback()
    },
    get size() {
      return pending.size
    }
  }
}

function fakeProxy(overrides = {}) {
  const calls = []
  const proxy = {
    onCreateRequest: new FakeEvent(),
    onGetRequest: new FakeEvent(),
    onIsUvpaaRequest: new FakeEvent(),
    onRequestCanceled: new FakeEvent(),
    async attach() {
      calls.push({ method: 'attach' })
    },
    async detach() {
      calls.push({ method: 'detach' })
    },
    async completeCreateRequest(details) {
      calls.push({ method: 'completeCreateRequest', details })
    },
    async completeGetRequest(details) {
      calls.push({ method: 'completeGetRequest', details })
    },
    async completeIsUvpaaRequest(details) {
      calls.push({ method: 'completeIsUvpaaRequest', details })
    }
  }
  Object.assign(proxy, overrides(proxy, calls))
  return { proxy, calls }
}

function controllerFor(proxy, timers = manualTimers(), options = {}) {
  return {
    controller: createPasskeyProxyProbeController({
      webAuthenticationProxy: proxy,
      timers,
      timeoutMs: 50,
      cleanupTimeoutMs: 20,
      authorizeProbe: (sender) => sender?.trusted === true,
      ...options
    }),
    timers
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

test('registers defensive handlers synchronously and detaches after successful attachment', async () => {
  const { proxy, calls } = fakeProxy(() => ({}))
  const { controller, timers } = controllerFor(proxy)

  assert.equal(proxy.onCreateRequest.listeners.length, 1)
  assert.equal(proxy.onGetRequest.listeners.length, 1)
  assert.equal(proxy.onIsUvpaaRequest.listeners.length, 1)
  assert.equal(proxy.onRequestCanceled.listeners.length, 1)

  const result = await controller.runProbe({ trusted: true })

  assert.deepEqual(result, {
    ok: true,
    code: ProbeCode.SUPPORTED,
    message: 'WebAuthentication Proxy attachment and detachment succeeded.'
  })
  assert.deepEqual(calls.map((call) => call.method), ['detach', 'attach', 'detach'])
  assert.equal(timers.size, 0)
})

test('rejects unauthorized callers before attempting attachment', async () => {
  const { proxy, calls } = fakeProxy(() => ({}))
  const { controller } = controllerFor(proxy)

  const result = await controller.runProbe({ trusted: false })

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.UNAUTHORIZED)
  assert.deepEqual(calls, [])
})

test('best-effort detaches when attachment is rejected', async () => {
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    async attach() {
      calls.push({ method: 'attach' })
      throw new Error('attach denied')
    }
  }))
  const { controller } = controllerFor(proxy)

  const result = await controller.runProbe({ trusted: true })

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.ATTACH_REJECTED)
  assert.equal(result.message, 'attach denied')
  assert.deepEqual(calls.map((call) => call.method), ['detach', 'attach', 'detach'])
})

test('times out attachment, detaches immediately, and detaches again after a late attachment', async () => {
  const attachment = deferred()
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    attach() {
      calls.push({ method: 'attach' })
      return attachment.promise
    }
  }))
  const { controller, timers } = controllerFor(proxy)

  const resultPromise = controller.runProbe({ trusted: true })
  await flushMicrotasks()
  timers.fireNext()
  const result = await resultPromise

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.ATTACH_TIMEOUT)
  assert.equal(calls.filter((call) => call.method === 'detach').length, 2)

  attachment.resolve()
  await flushMicrotasks()
  assert.equal(calls.filter((call) => call.method === 'detach').length, 3)
  assert.equal(timers.size, 0)
})

test('reports detach failure after a successful attachment', async () => {
  let detachAttempts = 0
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    async detach() {
      detachAttempts += 1
      calls.push({ method: 'detach' })
      if (detachAttempts === 2) throw new Error('detach denied')
    }
  }))
  const { controller } = controllerFor(proxy)

  const result = await controller.runProbe({ trusted: true })

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.DETACH_FAILED)
  assert.equal(result.message, 'detach denied')
  assert.equal(result.interruptedCode, ProbeCode.SUPPORTED)
  assert.deepEqual(calls.map((call) => call.method), ['detach', 'attach', 'detach'])
})

test('detach failure takes priority over an attachment timeout', async () => {
  const attachment = deferred()
  let detachAttempts = 0
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    attach() {
      calls.push({ method: 'attach' })
      return attachment.promise
    },
    async detach() {
      detachAttempts += 1
      calls.push({ method: 'detach' })
      if (detachAttempts >= 2) throw new Error('detach unavailable')
    }
  }))
  const { controller, timers } = controllerFor(proxy)

  const resultPromise = controller.runProbe({ trusted: true })
  await flushMicrotasks()
  timers.fireNext()
  const result = await resultPromise

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.DETACH_FAILED)
  assert.equal(result.interruptedCode, ProbeCode.ATTACH_TIMEOUT)
  assert.equal(result.message, 'detach unavailable')

  attachment.resolve()
  await flushMicrotasks()
  assert.ok(calls.filter((call) => call.method === 'detach').length >= 3)
})

test('detach failure takes priority over an unexpected ceremony', async () => {
  const attachment = deferred()
  let detachAttempts = 0
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    attach() {
      calls.push({ method: 'attach' })
      return attachment.promise
    },
    async detach() {
      detachAttempts += 1
      calls.push({ method: 'detach' })
      if (detachAttempts >= 2) throw new Error('detach unavailable')
    }
  }))
  const { controller } = controllerFor(proxy)
  const resultPromise = controller.runProbe({ trusted: true })
  await flushMicrotasks()

  await proxy.onCreateRequest.emit({ requestId: 91, requestDetailsJson: '{}' })
  const result = await resultPromise

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.DETACH_FAILED)
  assert.equal(result.interruptedCode, ProbeCode.UNEXPECTED_CREATE)
  assert.equal(result.message, 'detach unavailable')

  attachment.resolve()
  await flushMicrotasks()
})

test('exposes an explicit bounded detach retry for service-worker cleanup', async () => {
  let detachAttempts = 0
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    async detach() {
      detachAttempts += 1
      calls.push({ method: 'detach' })
      if (detachAttempts === 1) throw new Error('first detach failed')
    }
  }))
  const { controller, timers } = controllerFor(proxy)

  const failed = await controller.ensureDetached()
  const retried = await controller.ensureDetached()

  assert.equal(failed.ok, false)
  assert.equal(failed.code, ProbeCode.DETACH_FAILED)
  assert.deepEqual(retried, {
    ok: true,
    code: ProbeCode.DETACHED,
    message: 'WebAuthentication Proxy detachment succeeded.'
  })
  assert.equal(calls.filter((call) => call.method === 'detach').length, 2)
  assert.equal(timers.size, 0)
})

test('reports an unavailable API instead of treating a missing detach method as success', async () => {
  const controller = createPasskeyProxyProbeController({
    webAuthenticationProxy: null,
    authorizeProbe: () => true
  })

  const result = await controller.ensureDetached()

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.API_UNAVAILABLE)
})

test('supports a timer implementation that fires synchronously', async () => {
  const syncTimers = {
    setTimeout(callback) {
      callback()
      return 1
    },
    clearTimeout() {}
  }
  const { proxy } = fakeProxy(() => ({
    detach() {
      return new Promise(() => {})
    }
  }))
  const { controller } = controllerFor(proxy, syncTimers)

  const result = await controller.ensureDetached()

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.DETACH_FAILED)
  assert.equal(result.message, 'WebAuthentication Proxy detachment timed out.')
})

test('completes unexpected ceremonies without credentials and detaches', async (t) => {
  const cases = [
    {
      name: 'create',
      eventName: 'onCreateRequest',
      completeMethod: 'completeCreateRequest',
      code: ProbeCode.UNEXPECTED_CREATE
    },
    {
      name: 'get',
      eventName: 'onGetRequest',
      completeMethod: 'completeGetRequest',
      code: ProbeCode.UNEXPECTED_GET
    },
    {
      name: 'isUvpaa',
      eventName: 'onIsUvpaaRequest',
      completeMethod: 'completeIsUvpaaRequest',
      code: ProbeCode.UNEXPECTED_IS_UVPAA
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const attachment = deferred()
      const { proxy, calls } = fakeProxy((_proxy, calls) => ({
        attach() {
          calls.push({ method: 'attach' })
          return attachment.promise
        }
      }))
      const { controller } = controllerFor(proxy)
      const resultPromise = controller.runProbe({ trusted: true })
      await flushMicrotasks()

      await proxy[item.eventName].emit({ requestId: 17, requestDetailsJson: '{"ignored":true}' })
      const result = await resultPromise

      assert.equal(result.ok, false)
      assert.equal(result.code, item.code)
      const completion = calls.find((call) => call.method === item.completeMethod)
      assert.ok(completion)
      assert.equal(completion.details.requestId, 17)
      if (item.name === 'isUvpaa') {
        assert.equal(completion.details.isUvpaa, false)
      } else {
        assert.deepEqual(completion.details.error, {
          name: 'NotAllowedError',
          message: 'My Password capability probe does not handle WebAuthn credentials.'
        })
        assert.equal('responseJson' in completion.details, false)
      }
      assert.ok(calls.some((call) => call.method === 'detach'))

      attachment.resolve()
      await flushMicrotasks()
      assert.ok(calls.filter((call) => call.method === 'detach').length >= 2)
    })
  }
})

test('an unexpected cancellation interrupts the probe and detaches without completing a credential', async () => {
  const attachment = deferred()
  const { proxy, calls } = fakeProxy((_proxy, calls) => ({
    attach() {
      calls.push({ method: 'attach' })
      return attachment.promise
    }
  }))
  const { controller } = controllerFor(proxy)
  const resultPromise = controller.runProbe({ trusted: true })
  await flushMicrotasks()

  await proxy.onRequestCanceled.emit(29)
  const result = await resultPromise

  assert.equal(result.ok, false)
  assert.equal(result.code, ProbeCode.UNEXPECTED_CANCEL)
  assert.deepEqual(
    calls.filter((call) => call.method.startsWith('complete')),
    []
  )
  assert.ok(calls.some((call) => call.method === 'detach'))

  attachment.resolve()
  await flushMicrotasks()
})

test('defensive handlers detach even when a stale event arrives outside an active probe', async () => {
  const { proxy, calls } = fakeProxy(() => ({}))
  controllerFor(proxy)

  await proxy.onGetRequest.emit({ requestId: 41, requestDetailsJson: '{}' })

  assert.deepEqual(calls.map((call) => call.method), ['completeGetRequest', 'detach'])
})
