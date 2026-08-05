(function initPasskeyProxyProbe(globalObject, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  globalObject.MyPwdMgPasskeyProxyProbe = api
})(globalThis, function createPasskeyProxyProbeModule() {
  'use strict'

  const DEFAULT_TIMEOUT_MS = 3000
  const DEFAULT_CLEANUP_TIMEOUT_MS = 1000
  const UNEXPECTED_REQUEST_ERROR = Object.freeze({
    name: 'NotAllowedError',
    message: 'My Password capability probe does not handle WebAuthn credentials.'
  })

  const ProbeCode = Object.freeze({
    SUPPORTED: 'SUPPORTED',
    DETACHED: 'DETACHED',
    UNAUTHORIZED: 'UNAUTHORIZED',
    AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
    PROBE_IN_PROGRESS: 'PROBE_IN_PROGRESS',
    API_UNAVAILABLE: 'API_UNAVAILABLE',
    ATTACH_REJECTED: 'ATTACH_REJECTED',
    ATTACH_TIMEOUT: 'ATTACH_TIMEOUT',
    DETACH_FAILED: 'DETACH_FAILED',
    UNEXPECTED_CREATE: 'UNEXPECTED_CREATE',
    UNEXPECTED_GET: 'UNEXPECTED_GET',
    UNEXPECTED_IS_UVPAA: 'UNEXPECTED_IS_UVPAA',
    UNEXPECTED_CANCEL: 'UNEXPECTED_CANCEL'
  })

  function createPasskeyProxyProbeController(options = {}) {
    const proxy = options.webAuthenticationProxy || null
    const timers = normalizeTimers(options.timers)
    const timeoutMs = normalizeDuration(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    const cleanupTimeoutMs = normalizeDuration(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS)
    const authorizeProbe = typeof options.authorizeProbe === 'function'
      ? options.authorizeProbe
      : () => false
    let activeRun = null

    const eventHandlers = {
      create: (details) => handleUnexpectedRequest('create', details),
      get: (details) => handleUnexpectedRequest('get', details),
      isUvpaa: (details) => handleUnexpectedRequest('isUvpaa', details),
      cancel: (details) => handleUnexpectedRequest('cancel', details)
    }

    // Registration happens during construction so a service worker cannot attach
    // before the fail-open handlers exist.
    addEventListener(proxy?.onCreateRequest, eventHandlers.create)
    addEventListener(proxy?.onGetRequest, eventHandlers.get)
    addEventListener(proxy?.onIsUvpaaRequest, eventHandlers.isUvpaa)
    addEventListener(proxy?.onRequestCanceled, eventHandlers.cancel)

    async function runProbe(context = {}) {
      let authorized = false
      try {
        authorized = await authorizeProbe(context) === true
      } catch (error) {
        return failure(ProbeCode.AUTHORIZATION_FAILED, errorMessage(error, 'Probe authorization failed.'))
      }
      if (!authorized) {
        return failure(ProbeCode.UNAUTHORIZED, 'The capability probe requires an authorized caller.')
      }
      if (activeRun) {
        return failure(ProbeCode.PROBE_IN_PROGRESS, 'A capability probe is already running.')
      }
      if (!hasCompleteProxyApi(proxy)) {
        return failure(ProbeCode.API_UNAVAILABLE, 'The WebAuthentication Proxy API is unavailable or incomplete.')
      }

      const run = {
        abort: createDeferred(),
        attachOperation: null,
        cleanupStarted: false,
        finished: false,
        unexpected: null,
        unexpectedCleanup: null
      }
      activeRun = run

      const preflightDetach = await bestEffortDetach()
      if (!preflightDetach.ok) {
        run.finished = true
        if (activeRun === run) activeRun = null
        return failure(
          ProbeCode.DETACH_FAILED,
          errorMessage(preflightDetach.error, 'WebAuthentication Proxy preflight detachment failed.')
        )
      }
      if (run.unexpected) {
        const cleanup = await run.unexpectedCleanup
        run.finished = true
        if (activeRun === run) activeRun = null
        return applyCleanupOutcome(run.unexpected, cleanup)
      }

      const attachOperation = startOperation(() => proxy.attach())
      run.attachOperation = attachOperation
      attachOperation.then((result) => {
        if (result.ok && run.cleanupStarted) {
          void bestEffortDetach()
        }
      })

      const attachTimeout = createTimerSignal(timers, timeoutMs, {
        kind: 'timeout'
      })
      let outcome
      try {
        const attachOutcome = attachOperation.then((result) => (
          result.ok
            ? { kind: 'attached' }
            : { kind: 'rejected', error: result.error }
        ))
        outcome = await Promise.race([
          attachOutcome,
          attachTimeout.promise,
          run.abort.promise
        ])
      } finally {
        attachTimeout.cancel()
      }

      if (outcome.kind === 'attached') {
        outcome = success()
      } else if (outcome.kind === 'rejected') {
        outcome = failure(ProbeCode.ATTACH_REJECTED, errorMessage(outcome.error, 'WebAuthentication Proxy attachment was rejected.'))
      } else if (outcome.kind === 'timeout') {
        outcome = failure(ProbeCode.ATTACH_TIMEOUT, 'WebAuthentication Proxy attachment timed out.')
      }

      run.cleanupStarted = true
      const cleanup = run.unexpectedCleanup
        ? await run.unexpectedCleanup
        : { completionError: null, detach: await bestEffortDetach() }

      run.finished = true
      if (activeRun === run) activeRun = null
      if (run.unexpected) outcome = run.unexpected

      return applyCleanupOutcome(outcome, cleanup)
    }

    async function ensureDetached() {
      if (!proxy || typeof proxy.detach !== 'function') {
        return failure(ProbeCode.API_UNAVAILABLE, 'The WebAuthentication Proxy API is unavailable.')
      }
      const result = await bestEffortDetach()
      if (!result.ok) {
        return failure(ProbeCode.DETACH_FAILED, errorMessage(result.error, 'WebAuthentication Proxy detachment failed.'))
      }
      return {
        ok: true,
        code: ProbeCode.DETACHED,
        message: 'WebAuthentication Proxy detachment succeeded.'
      }
    }

    function handleUnexpectedRequest(kind, details) {
      const unexpected = unexpectedResult(kind)
      const cleanup = completeUnexpectedRequest(kind, details).then(async (completion) => ({
        completionError: completion.ok ? null : completion.error,
        detach: await bestEffortDetach()
      }))

      const run = activeRun
      if (run && !run.unexpected) {
        run.unexpected = unexpected
        run.unexpectedCleanup = cleanup
        run.abort.resolve(unexpected)
      }
      return cleanup
    }

    function completeUnexpectedRequest(kind, details) {
      if (kind === 'cancel') return Promise.resolve({ ok: true, value: undefined })
      const requestId = requestIdFrom(details)
      if (requestId === undefined) {
        return Promise.resolve({ ok: false, error: new Error('Unexpected WebAuthn request did not include a requestId.') })
      }
      if (kind === 'create') {
        return boundedOperation(
          () => proxy?.completeCreateRequest({
            requestId,
            error: { ...UNEXPECTED_REQUEST_ERROR }
          }),
          cleanupTimeoutMs,
          'Completing the unexpected create request timed out.'
        )
      }
      if (kind === 'get') {
        return boundedOperation(
          () => proxy?.completeGetRequest({
            requestId,
            error: { ...UNEXPECTED_REQUEST_ERROR }
          }),
          cleanupTimeoutMs,
          'Completing the unexpected get request timed out.'
        )
      }
      return boundedOperation(
        () => proxy?.completeIsUvpaaRequest({ requestId, isUvpaa: false }),
        cleanupTimeoutMs,
        'Completing the unexpected UVPAA request timed out.'
      )
    }

    function bestEffortDetach() {
      return boundedOperation(
        () => proxy?.detach(),
        cleanupTimeoutMs,
        'WebAuthentication Proxy detachment timed out.'
      )
    }

    function boundedOperation(call, durationMs, timeoutMessage) {
      const operation = startOperation(call)
      const timeout = createTimerSignal(timers, durationMs, {
        ok: false,
        error: new Error(timeoutMessage),
        timedOut: true
      })
      return Promise.race([operation, timeout.promise]).finally(timeout.cancel)
    }

    return Object.freeze({ ensureDetached, runProbe })
  }

  function hasCompleteProxyApi(proxy) {
    return Boolean(
      proxy
      && typeof proxy.attach === 'function'
      && typeof proxy.detach === 'function'
      && typeof proxy.completeCreateRequest === 'function'
      && typeof proxy.completeGetRequest === 'function'
      && typeof proxy.completeIsUvpaaRequest === 'function'
      && hasEvent(proxy.onCreateRequest)
      && hasEvent(proxy.onGetRequest)
      && hasEvent(proxy.onIsUvpaaRequest)
      && hasEvent(proxy.onRequestCanceled)
    )
  }

  function hasEvent(event) {
    return Boolean(event && typeof event.addListener === 'function')
  }

  function addEventListener(event, listener) {
    if (hasEvent(event)) event.addListener(listener)
  }

  function startOperation(call) {
    try {
      return Promise.resolve(call()).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error })
      )
    } catch (error) {
      return Promise.resolve({ ok: false, error })
    }
  }

  function createDeferred() {
    let resolve
    const promise = new Promise((settle) => {
      resolve = settle
    })
    return { promise, resolve }
  }

  function createTimerSignal(timers, durationMs, value) {
    let resolve
    const promise = new Promise((settle) => {
      resolve = settle
    })
    let timerId = timers.setTimeout(() => resolve(value), durationMs)
    return {
      promise,
      cancel() {
        if (timerId === null) return
        timers.clearTimeout(timerId)
        timerId = null
      }
    }
  }

  function normalizeTimers(timers) {
    const source = timers || globalThis
    if (typeof source.setTimeout !== 'function' || typeof source.clearTimeout !== 'function') {
      throw new TypeError('Passkey proxy probe requires setTimeout and clearTimeout timers.')
    }
    return {
      setTimeout: source.setTimeout.bind(source),
      clearTimeout: source.clearTimeout.bind(source)
    }
  }

  function normalizeDuration(value, fallback) {
    const duration = Number(value)
    return Number.isFinite(duration) && duration > 0 ? duration : fallback
  }

  function requestIdFrom(details) {
    if (typeof details === 'number' || typeof details === 'string') return details
    if (!details || typeof details !== 'object') return undefined
    return details.requestId
  }

  function unexpectedResult(kind) {
    if (kind === 'create') {
      return failure(ProbeCode.UNEXPECTED_CREATE, 'An unexpected WebAuthn create request interrupted the probe.')
    }
    if (kind === 'get') {
      return failure(ProbeCode.UNEXPECTED_GET, 'An unexpected WebAuthn get request interrupted the probe.')
    }
    if (kind === 'isUvpaa') {
      return failure(ProbeCode.UNEXPECTED_IS_UVPAA, 'An unexpected UVPAA request interrupted the probe.')
    }
    return failure(ProbeCode.UNEXPECTED_CANCEL, 'An unexpected WebAuthn cancellation interrupted the probe.')
  }

  function applyCleanupOutcome(outcome, cleanup) {
    const completionError = cleanup?.completionError || null
    const detachError = cleanup?.detach?.ok === false ? cleanup.detach.error : null
    if (detachError) {
      return {
        ...failure(ProbeCode.DETACH_FAILED, errorMessage(detachError, 'WebAuthentication Proxy detachment failed.')),
        interruptedCode: outcome?.code || '',
        ...(completionError
          ? { cleanupError: errorMessage(completionError, 'Probe request completion failed.') }
          : {})
      }
    }
    if (!completionError && !detachError) return outcome
    return {
      ...outcome,
      cleanupError: [completionError, detachError]
        .filter(Boolean)
        .map((error) => errorMessage(error, 'Probe cleanup failed.'))
        .join(' ')
    }
  }

  function success() {
    return {
      ok: true,
      code: ProbeCode.SUPPORTED,
      message: 'WebAuthentication Proxy attachment and detachment succeeded.'
    }
  }

  function failure(code, message) {
    return { ok: false, code, message }
  }

  function errorMessage(error, fallback) {
    const message = String(error?.message || error || '').trim()
    return message || fallback
  }

  return Object.freeze({
    ProbeCode,
    createPasskeyProxyProbeController
  })
})
