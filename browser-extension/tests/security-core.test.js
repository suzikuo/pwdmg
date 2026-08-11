'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const Security = require('../security-core.js')
const PasskeyProxyProbe = require('../passkey-proxy-probe.js')
const extensionRoot = path.resolve(__dirname, '..')

function source(name) {
  return fs.readFileSync(path.join(extensionRoot, name), 'utf8')
}

function extensionEvent() {
  const listeners = []
  return {
    addListener(listener) { listeners.push(listener) },
    async emit(value) {
      return Promise.all(listeners.map((listener) => listener(value)))
    },
    get listenerCount() { return listeners.length }
  }
}

function passkeyProxyMock(overrides = {}) {
  const calls = []
  const proxy = {
    onCreateRequest: extensionEvent(),
    onGetRequest: extensionEvent(),
    onIsUvpaaRequest: extensionEvent(),
    onRequestCanceled: extensionEvent(),
    async attach() { calls.push({ method: 'attach' }) },
    async detach() { calls.push({ method: 'detach' }) },
    async completeCreateRequest(details) { calls.push({ method: 'completeCreateRequest', details }) },
    async completeGetRequest(details) { calls.push({ method: 'completeGetRequest', details }) },
    async completeIsUvpaaRequest(details) { calls.push({ method: 'completeIsUvpaaRequest', details }) }
  }
  Object.assign(proxy, overrides)
  return { proxy, calls }
}

function loadBackground(nativeResponder, activeTab = { id: 7, url: 'https://login.example.com/' }, options = {}) {
  let messageListener = null
  const portMessageListeners = []
  const storage = { ...(options.initialStorage || {}) }
  const grantedPermissions = new Set(options.grantedPermissions || (options.webAuthenticationProxy ? ['webAuthenticationProxy'] : []))
  const permissionAdded = extensionEvent()
  let tokenSequence = 0
  const emitNativeResponse = (request, response) => {
    for (const listener of portMessageListeners) listener({ ...response, id: request.id })
  }
  const port = {
    onMessage: { addListener(listener) { portMessageListeners.push(listener) } },
    onDisconnect: { addListener() {} },
    postMessage(request) {
      if (options.postNativeMessage) {
        options.postNativeMessage(request, (response) => emitNativeResponse(request, response))
        return
      }
      Promise.resolve(nativeResponder(request.method, request.params || {})).then((response) => {
        emitNativeResponse(request, response)
      })
    }
  }
  const chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      lastError: null,
      connectNative() { return port },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener } }
    },
    tabs: {
      async query() { return [activeTab] },
      async sendMessage() { return { ok: true } }
    },
    scripting: {
      async executeScript() {},
      async insertCSS() {}
    },
    contextMenus: {
      removeAll(callback) { callback() },
      create() {},
      onClicked: { addListener() {} }
    },
    commands: { onCommand: { addListener() {} } },
    permissions: {
      contains(details, callback) {
        callback((details.permissions || []).every((permission) => grantedPermissions.has(permission)))
      },
      remove(details, callback) {
        let removed = false
        for (const permission of details.permissions || []) {
          removed = grantedPermissions.delete(permission) || removed
        }
        callback(removed)
      },
      onAdded: permissionAdded
    },
    storage: {
      local: {
        get(defaults, callback) { callback({ ...defaults, ...storage }) },
        set(values, callback) {
          Object.assign(storage, values)
          callback?.()
        }
      }
    }
  }
  if (options.webAuthenticationProxy) chrome.webAuthenticationProxy = options.webAuthenticationProxy
  const context = vm.createContext({
    URL,
    chrome,
    clearTimeout: options.clearTimeout || clearTimeout,
    console,
    crypto: options.crypto || {
      randomUUID: () => `test-token-${++tokenSequence}`,
      getRandomValues(values) {
        values.fill(++tokenSequence)
        return values
      }
    },
    globalThis: null,
    setTimeout: options.setTimeout || setTimeout
  })
  context.globalThis = context
  context.MyPwdMgSecurity = Security
  context.MyPwdMgPasskeyProxyProbe = PasskeyProxyProbe
  const backgroundSource = source('background.js')
    .replace("import './security-core.js'", '')
    .replace("import './passkey-proxy-probe.js'", '')
  vm.runInContext(backgroundSource, context, { filename: 'background.js' })

  return {
    async dispatch(message, sender) {
      assert.ok(messageListener, 'background message listener was registered')
      const ownSender = { id: chrome.runtime.id, ...(sender || {}) }
      return new Promise((resolve) => messageListener(message, ownSender, resolve))
    },
    getStorage() { return { ...storage } },
    setStorage(values) { Object.assign(storage, values) },
    hasPermission(permission) { return grantedPermissions.has(permission) },
    grantPermission(permission) { grantedPermissions.add(permission) },
    permissionAdded
  }
}

test('domain authorization accepts only matching saved domains', () => {
  assert.equal(Security.domainMatches('https://login.example.com/path', 'example.com'), true)
  assert.equal(Security.domainMatches('login.example.com', '*.example.com'), true)
  assert.equal(Security.domainMatches('us-east-2.signin.aws.amazon.com', 'signin.aws.amazon.com'), true)
  assert.equal(Security.entryMatchesHostname({ domains: ['signin.aws.amazon.com'] }, 'us-east-2.signin.aws.amazon.com'), true)
  assert.equal(Security.domainMatches('signin.aws.amazon.com.evil.test', 'signin.aws.amazon.com'), false)
  assert.equal(Security.domainMatches('example.com.evil.test', 'example.com'), false)
  assert.equal(Security.domainMatches('evil-example.com', 'example.com'), false)
  assert.equal(Security.entryMatchesHostname({ domains: ['accounts.example.com'] }, 'accounts.example.com'), true)
  assert.equal(Security.entryMatchesHostname({ domains: ['accounts.example.com'] }, 'example.com'), false)
})

test('autofill rule modes enforce host and URL boundaries', () => {
  const pageUrl = 'https://login.example.com/account/profile'
  assert.equal(Security.entryMatchesPage({ domains: ['example.com'], autofillMatchMode: 'base-domain' }, 'login.example.com', pageUrl), true)
  assert.equal(Security.entryMatchesPage({ domains: ['example.com'], autofillMatchMode: 'exact-host' }, 'login.example.com', pageUrl), false)
  assert.equal(Security.entryMatchesPage({ domains: ['example.com'], autofillMatchMode: 'subdomain' }, 'login.example.com', pageUrl), true)
  assert.equal(Security.entryMatchesPage({ domains: ['login.example.com'], autofillMatchMode: 'subdomain' }, 'login.example.com', pageUrl), false)
  assert.equal(Security.entryMatchesPage({ domains: ['https://login.example.com/account'], autofillMatchMode: 'url-prefix' }, 'login.example.com', pageUrl), true)
  assert.equal(Security.entryMatchesPage({ domains: ['https://login.example.com/account'], autofillMatchMode: 'url-prefix' }, 'login.example.com', 'https://login.example.com/accounting'), false)
  assert.equal(Security.entryMatchesPage({ domains: ['example.com'], autofillMatchMode: 'never' }, 'example.com', 'https://example.com/'), false)
  assert.equal(Security.entryMatchesPage({ domains: ['www.example.com'], autofillMatchMode: 'exact-host' }, 'www.example.com', 'https://www.example.com/'), true)
  assert.equal(Security.entryMatchesPage({ domains: ['www.example.com'], autofillMatchMode: 'exact-host' }, 'example.com', 'https://example.com/'), false)
})

test('background rejects foreign senders and keeps vault controls extension-page-only', async () => {
  const calls = []
  const background = loadBackground((method, params) => {
    calls.push({ method, params })
    return { ok: true, data: {} }
  })
  const contentSender = {
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-control',
    url: 'https://login.example.com/'
  }
  const foreignSender = {
    ...contentSender,
    id: 'foreignextensionforeignextensio'
  }
  const popupSender = {
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const foreign = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, foreignSender)
  assert.equal(foreign.code, 'EXTENSION_SENDER_UNAUTHORIZED')

  for (const message of [
    { type: 'MYPWDMG_UNLOCK', password: 'must-not-cross' },
    { type: 'MYPWDMG_LOCK' },
    { type: 'MYPWDMG_LIST_SAVE_TARGETS' },
    { type: 'MYPWDMG_STATE' },
    { type: 'MYPWDMG_SET_AUTO_SETTINGS', settings: { autoFillEnabled: false } }
  ]) {
    const response = await background.dispatch(message, contentSender)
    assert.equal(response.code, 'EXTENSION_PAGE_REQUIRED')
  }
  assert.equal(calls.length, 0)

  const settings = await background.dispatch({ type: 'MYPWDMG_GET_AUTO_SETTINGS' }, contentSender)
  assert.equal(settings.ok, true)
  const state = await background.dispatch({ type: 'MYPWDMG_STATE' }, popupSender)
  assert.equal(state.ok, true)
  assert.deepEqual(calls.map((call) => call.method), ['getState'])
})

test('background cleans up a synchronous native send failure and does not expose its exception', async () => {
  let attempts = 0
  const background = loadBackground(
    () => ({ ok: true, data: {} }),
    { id: 7, url: 'https://login.example.com/' },
    {
      postNativeMessage(request, respond) {
        attempts += 1
        if (attempts === 1) throw new Error('sensitive implementation detail')
        queueMicrotask(() => respond({ ok: true, data: { locked: true } }))
      }
    }
  )
  const popupSender = {
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const failed = await background.dispatch({ type: 'MYPWDMG_STATE' }, popupSender)
  assert.equal(failed.code, 'NATIVE_HOST_ERROR')
  assert.equal(failed.message, 'Native host request failed.')
  assert.doesNotMatch(failed.message, /sensitive/)

  const retried = await background.dispatch({ type: 'MYPWDMG_STATE' }, popupSender)
  assert.equal(retried.ok, true)
  assert.equal(attempts, 2)
})

test('background falls back to a parent hostname and filters returned entries for the original site', async () => {
  const calls = []
  const savedParent = {
    id: 'aws-parent',
    title: 'AWS',
    username: 'alice',
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['signin.aws.amazon.com']
  }
  const lookalike = {
    ...savedParent,
    id: 'lookalike',
    domains: ['signin.aws.amazon.com.evil.test']
  }
  const background = loadBackground((method, params) => {
    if (method !== 'queryMatches') return { ok: true, data: {} }
    calls.push(params.hostname)
    if (params.hostname === 'signin.aws.amazon.com') {
      return { ok: true, data: [lookalike, savedParent] }
    }
    return { ok: true, data: [] }
  }, { id: 7, url: 'https://us-east-2.signin.aws.amazon.com/console/' })
  const popupSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const response = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, popupSender)
  const cachedResponse = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, popupSender)

  assert.equal(response.ok, true)
  assert.deepEqual(response.data.map((entry) => entry.id), ['aws-parent'])
  assert.deepEqual(cachedResponse.data.map((entry) => entry.id), ['aws-parent'])
  assert.deepEqual(calls, ['us-east-2.signin.aws.amazon.com', 'signin.aws.amazon.com'])
})

test('background returns a parent-query failure instead of reporting an empty match list', async () => {
  const calls = []
  const background = loadBackground((method, params) => {
    if (method !== 'queryMatches') return { ok: true, data: {} }
    calls.push(params.hostname)
    if (params.hostname === 'signin.aws.amazon.com') {
      return { ok: false, code: 'LOCKED', message: 'Vault is locked.' }
    }
    return { ok: true, data: [] }
  }, { id: 7, url: 'https://us-east-2.signin.aws.amazon.com/console/' })
  const popupSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const response = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, popupSender)

  assert.equal(response.ok, false)
  assert.equal(response.code, 'LOCKED')
  assert.deepEqual(calls, ['us-east-2.signin.aws.amazon.com', 'signin.aws.amazon.com'])
})

test('parent-domain fallback remains authorized through the fill request', async () => {
  const calls = []
  const summary = {
    id: 'aws-parent',
    title: 'AWS',
    username: 'alice',
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['signin.aws.amazon.com']
  }
  const payload = { ...summary, password: 'secret', totp: '' }
  const background = loadBackground((method, params) => {
    calls.push({ method, hostname: params.hostname || '' })
    if (method === 'queryMatches') {
      return params.hostname === 'signin.aws.amazon.com'
        ? { ok: true, data: [summary] }
        : { ok: true, data: [] }
    }
    if (method === 'getFillPayload') return { ok: true, data: payload }
    return { ok: true, data: {} }
  }, { id: 7, url: 'https://us-east-2.signin.aws.amazon.com/console/' })
  const sender = {
    tab: { id: 7, url: 'https://us-east-2.signin.aws.amazon.com/console/' },
    frameId: 0,
    documentId: 'doc-aws',
    url: 'https://us-east-2.signin.aws.amazon.com/console/'
  }

  const authorization = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: summary.id }, sender)
  const filled = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: summary.id,
    authorizationToken: authorization.data.token
  }, sender)

  assert.equal(authorization.ok, true)
  assert.equal(filled.ok, true)
  assert.equal(filled.data.password, 'secret')
  assert.equal(
    calls.find((call) => call.method === 'getFillPayload')?.hostname,
    'us-east-2.signin.aws.amazon.com'
  )
  assert.deepEqual(
    calls.filter((call) => call.method === 'queryMatches').map((call) => call.hostname),
    [
      'us-east-2.signin.aws.amazon.com',
      'signin.aws.amazon.com',
      'us-east-2.signin.aws.amazon.com',
      'signin.aws.amazon.com'
    ]
  )
})

test('fill retries the legacy Native Host signature after parameter rejection', async () => {
  const calls = []
  const summary = {
    id: 'entry-legacy-host',
    title: 'Example',
    username: 'alice',
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['example.com']
  }
  const payload = { ...summary, password: 'secret', totp: '' }
  const background = loadBackground((method, params) => {
    calls.push({ method, params })
    if (method === 'queryMatches') return { ok: true, data: [summary] }
    if (method === 'getFillPayload') {
      if (Object.prototype.hasOwnProperty.call(params, 'hostname')) {
        return { ok: false, code: 'INVALID_INPUT', message: 'Invalid native host request parameters.' }
      }
      return { ok: true, data: payload }
    }
    return { ok: true, data: {} }
  })
  const sender = {
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-legacy-host',
    url: 'https://login.example.com/form'
  }

  const authorization = await background.dispatch({
    type: 'MYPWDMG_AUTHORIZE_FILL',
    entryId: summary.id
  }, sender)
  const filled = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: summary.id,
    authorizationToken: authorization.data.token
  }, sender)

  assert.equal(authorization.ok, true)
  assert.equal(filled.ok, true)
  assert.equal(filled.data.password, 'secret')
  assert.deepEqual(
    calls.filter((call) => call.method === 'getFillPayload').map((call) => (
      `${call.params.entryId}|${call.params.hostname || ''}`
    )),
    [
      `${summary.id}|login.example.com`,
      `${summary.id}|login.example.com`,
      `${summary.id}|`
    ]
  )
})

test('fill contexts bind tab, frame, document, and origin', () => {
  const base = Security.webContext({
    tabId: 7,
    frameId: 2,
    documentId: 'doc-a',
    url: 'https://login.example.com/form'
  })
  const same = Security.webContext({
    tabId: 7,
    frameId: 2,
    documentId: 'doc-a',
    url: 'https://login.example.com/next'
  })
  const redirected = Security.webContext({
    tabId: 7,
    frameId: 2,
    documentId: 'doc-b',
    url: 'https://login.example.com/complete'
  })
  const otherFrame = Security.webContext({
    tabId: 7,
    frameId: 3,
    documentId: 'doc-a',
    url: 'https://login.example.com/form'
  })
  const otherOrigin = Security.webContext({
    tabId: 7,
    frameId: 2,
    documentId: 'doc-b',
    url: 'https://evil.test/complete'
  })

  assert.equal(Security.sameDocumentContext(base, same), true)
  assert.equal(Security.sameDocumentContext(base, redirected), false)
  assert.equal(Security.sameDocumentContext(base, otherFrame), false)
  assert.equal(Security.sameOriginFrame(base, redirected), true)
  assert.equal(Security.sameOriginFrame(base, otherOrigin), false)
})

test('password matching does not treat pass substrings or passcodes as passwords', () => {
  assert.equal(Security.passwordEvidence({ type: 'password', text: 'password' }), 'strong')
  assert.equal(Security.passwordEvidence({ type: 'text', text: 'Pass' }), 'strong')
  assert.equal(Security.passwordEvidence({ type: 'text', text: 'compass setting' }), 'none')
  assert.equal(Security.passwordEvidence({ type: 'text', text: 'passport number' }), 'none')
  assert.equal(Security.passwordEvidence({ type: 'password', text: 'verification passcode' }), 'none')
  assert.equal(Security.passwordEvidence({ type: 'password', autocomplete: 'one-time-code' }), 'none')
})

test('OTP matching requires explicit evidence or a digit-constrained short code', () => {
  assert.equal(Security.otpEvidence({ text: 'TOTP code' }), 'strong')
  assert.equal(Security.otpEvidence({ autocomplete: 'one-time-code' }), 'strong')
  assert.equal(Security.otpEvidence({ text: 'code', maxLength: 6 }), 'none')
  assert.equal(Security.otpEvidence({ text: 'code', maxLength: 6, inputMode: 'numeric' }), 'weak')
  assert.equal(Security.otpEvidence({ text: 'auth token', maxLength: 6, inputMode: 'numeric' }), 'none')
  assert.equal(Security.otpEvidence({ text: 'security code' }), 'none')
  assert.equal(Security.otpEvidence({ text: 'card security code', maxLength: 3, inputMode: 'numeric' }), 'none')
})

test('content UI and fill message retain the trusted-gesture boundary', () => {
  const content = source('content.js')
  const popup = source('popup.js')
  const background = source('background.js')
  assert.match(content, /attachShadow\(\{ mode: 'closed' \}\)/)
  assert.match(content, /if \(!event\.isTrusted\) return/)
  assert.doesNotMatch(content, /data-entry-id/)
  assert.match(content, /MYPWDMG_AUTHORIZE_FILL/)
  assert.match(content, /authorizationToken: authorization\.data\.token/)
  assert.doesNotMatch(content, /lastOtpAutoFillKey/)
  assert.match(popup, /matchListEl\.addEventListener[\s\S]*if \(!event\.isTrusted\) return/)
  assert.match(background, /crypto\.getRandomValues/)
  assert.doesNotMatch(background, /Math\.random/)
})

test('background revalidates fills and retains failed save tokens', () => {
  const background = source('background.js')
  const getFillBranch = background.slice(
    background.indexOf("if (message?.type === 'MYPWDMG_GET_FILL')"),
    background.indexOf("if (message?.type === 'MYPWDMG_PREPARE_CAPTURE')")
  )
  assert.match(getFillBranch, /getAuthorizedFill/)
  assert.doesNotMatch(getFillBranch, /nativeCall\('getFillPayload'/)

  const authorizedFill = background.slice(
    background.indexOf('async function getAuthorizedFill'),
    background.indexOf('function forgetPromptToken')
  )
  assert.match(authorizedFill, /sameDocumentContext/)
  assert.match(authorizedFill, /queryMatchesWithParentFallback\(context\.hostname, context\.url\)/)
  assert.match(authorizedFill, /matchingEntry/)
  assert.match(authorizedFill, /payloadMatchesEntry/)
  assert.match(authorizedFill, /hostname: context\.hostname/)

  const saveCapture = background.slice(
    background.indexOf('async function savePreparedCapture'),
    background.indexOf('function takePreparedPrompt')
  )
  assert.ok(saveCapture.indexOf('if (response?.ok)') < saveCapture.indexOf('pendingCaptures.delete(token)'))
  assert.match(saveCapture, /item\.saving = false/)
  assert.match(background, /pendingPromptsByContext/)
  assert.match(background, /sameOriginFrame/)
})

test('background fill grants are site-bound, document-bound, and single-use', async () => {
  const calls = []
  const summary = {
    id: 'entry-1',
    title: 'Example',
    username: 'alice',
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['example.com']
  }
  const payload = { ...summary, password: 'secret', totp: '' }
  const background = loadBackground((method, params) => {
    calls.push({ method, params })
    if (method === 'queryMatches') return { ok: true, data: [summary] }
    if (method === 'getFillPayload') return { ok: true, data: payload }
    return { ok: true, data: {} }
  })
  const sender = {
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-a',
    url: 'https://login.example.com/form'
  }

  const authorization = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: 'entry-1' }, sender)
  assert.equal(authorization.ok, true)
  const filled = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: 'entry-1',
    authorizationToken: authorization.data.token
  }, sender)
  assert.equal(filled.ok, true)
  assert.equal(filled.data.password, 'secret')
  assert.equal(
    calls.find((call) => call.method === 'getFillPayload')?.params?.hostname,
    'login.example.com'
  )

  const replay = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: 'entry-1',
    authorizationToken: authorization.data.token
  }, sender)
  assert.equal(replay.code, 'FILL_AUTH_REQUIRED')
  assert.ok(calls.filter((call) => call.method === 'queryMatches').length >= 2)

  const nextAuthorization = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: 'entry-1' }, sender)
  const otherDocument = { ...sender, documentId: 'doc-b' }
  const wrongDocument = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: 'entry-1',
    authorizationToken: nextAuthorization.data.token
  }, otherDocument)
  assert.equal(wrongDocument.code, 'FILL_AUTH_CONTEXT_MISMATCH')
})

test('risky HTTP and third-party-frame fills require an exact second-click acknowledgement', async () => {
  const summary = {
    id: 'entry-risk',
    title: 'Risk',
    username: 'alice',
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['example.com']
  }
  const background = loadBackground((method) => (
    method === 'queryMatches' ? { ok: true, data: [summary] } : { ok: true, data: { ...summary, password: 'secret', totp: '' } }
  ))
  const httpSender = {
    tab: { id: 7, url: 'http://login.example.com/' },
    frameId: 0,
    documentId: 'doc-http',
    url: 'http://login.example.com/form'
  }

  const warning = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: summary.id }, httpSender)
  assert.equal(warning.code, 'FILL_RISK_CONFIRMATION_REQUIRED')
  assert.deepEqual(Array.from(warning.data.risks), ['insecure-http'])
  const authorized = await background.dispatch({
    type: 'MYPWDMG_AUTHORIZE_FILL',
    entryId: summary.id,
    acknowledgedRisks: ['insecure-http']
  }, httpSender)
  assert.equal(authorized.ok, true)

  const frameSender = {
    tab: { id: 7, url: 'https://app.other.test/' },
    frameId: 2,
    documentId: 'doc-frame',
    url: 'https://login.example.com/form'
  }
  const frameWarning = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: summary.id }, frameSender)
  assert.deepEqual(Array.from(frameWarning.data.risks), ['third-party-frame'])
})

test('successful authorized retrieval ranks that entry first for the same origin', async () => {
  const entries = ['first', 'second'].map((id) => ({
    id,
    title: id,
    username: id,
    email: '',
    phone: '',
    loginAccountSource: 'username',
    domains: ['example.com']
  }))
  const background = loadBackground((method, params) => {
    if (method === 'queryMatches') return { ok: true, data: entries }
    const entry = entries.find((item) => item.id === params.entryId)
    return { ok: true, data: { ...entry, password: 'secret', totp: '' } }
  })
  const sender = {
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-recent',
    url: 'https://login.example.com/form'
  }

  const initial = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, sender)
  assert.deepEqual(initial.data.map((entry) => entry.id), ['first', 'second'])
  const authorization = await background.dispatch({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId: 'second' }, sender)
  const fill = await background.dispatch({
    type: 'MYPWDMG_GET_FILL',
    entryId: 'second',
    authorizationToken: authorization.data.token
  }, sender)
  assert.equal(fill.ok, true)

  const ranked = await background.dispatch({ type: 'MYPWDMG_QUERY_MATCHES' }, sender)
  assert.deepEqual(ranked.data.map((entry) => entry.id), ['second', 'first'])
  assert.deepEqual(Array.from(background.getStorage()['recentFillEntryIdsByOrigin.v1']['https://login.example.com']), ['second'])
})

test('failed capture saves remain retryable and prompts never cross origins', async () => {
  let saveAttempts = 0
  let capturedHostname = ''
  const background = loadBackground((method, params) => {
    if (method === 'previewCapturedLogin') {
      capturedHostname = params.capture.hostname
      return {
        ok: true,
        data: {
          shouldPrompt: true,
          hostname: params.capture.hostname,
          title: 'Example',
          accountLabel: 'alice',
          accountKind: 'username',
          folders: []
        }
      }
    }
    if (method === 'saveCapturedLogin') {
      saveAttempts += 1
      return saveAttempts === 1
        ? { ok: false, code: 'TEMPORARY_FAILURE', message: 'retry' }
        : { ok: true, data: { action: 'created' } }
    }
    return { ok: true, data: [] }
  })
  const sender = {
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-a',
    url: 'https://login.example.com/form'
  }
  const prepared = await background.dispatch({
    type: 'MYPWDMG_PREPARE_CAPTURE',
    capture: { hostname: 'attacker.test', username: 'alice', password: 'secret' }
  }, sender)
  assert.equal(prepared.ok, true)
  assert.equal(capturedHostname, 'login.example.com')

  const evilSender = {
    ...sender,
    documentId: 'doc-evil',
    url: 'https://evil.test/landing',
    tab: { id: 7, url: 'https://evil.test/landing' }
  }
  const leaked = await background.dispatch({ type: 'MYPWDMG_TAKE_SAVE_PROMPT' }, evilSender)
  assert.equal(leaked.data, null)

  const redirectedSender = {
    ...sender,
    documentId: 'doc-b',
    url: 'https://login.example.com/complete'
  }
  const restored = await background.dispatch({ type: 'MYPWDMG_TAKE_SAVE_PROMPT' }, redirectedSender)
  assert.equal(restored.data.token, prepared.data.token)

  const failed = await background.dispatch({
    type: 'MYPWDMG_SAVE_CAPTURE',
    token: prepared.data.token
  }, redirectedSender)
  assert.equal(failed.ok, false)
  const retried = await background.dispatch({
    type: 'MYPWDMG_SAVE_CAPTURE',
    token: prepared.data.token
  }, redirectedSender)
  assert.equal(retried.ok, true)
  assert.equal(saveAttempts, 2)
})

test('background passkey proxy probe is extension-page-only and explicitly detaches', async () => {
  const { proxy, calls } = passkeyProxyMock()
  const background = loadBackground(
    () => ({ ok: true, data: {} }),
    { id: 7, url: 'https://login.example.com/' },
    { webAuthenticationProxy: proxy }
  )
  const contentSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    tab: { id: 7, url: 'https://login.example.com/' },
    frameId: 0,
    documentId: 'doc-passkey',
    url: 'https://login.example.com/'
  }
  const popupSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const unauthorized = await background.dispatch({ type: 'MYPWDMG_PROBE_PASSKEY_PROXY' }, contentSender)
  assert.equal(unauthorized.ok, false)
  assert.equal(unauthorized.code, 'PASSKEY_PROXY_UNAUTHORIZED')
  assert.deepEqual(calls.map((call) => call.method), ['detach'])

  const probed = await background.dispatch({ type: 'MYPWDMG_PROBE_PASSKEY_PROXY' }, popupSender)
  assert.equal(probed.ok, true)
  assert.equal(probed.data.supported, true)
  assert.equal(probed.data.attached, true)
  assert.equal(probed.data.detached, true)
  assert.equal(probed.data.permissionRemoved, true)
  assert.deepEqual(calls.map((call) => call.method), ['detach', 'detach', 'attach', 'detach', 'detach'])
  assert.equal(background.hasPermission('webAuthenticationProxy'), false)
  assert.equal(background.getStorage().passkeyProxyProbePending, false)
})

test('background reports an unavailable passkey proxy without attaching', async () => {
  const background = loadBackground(() => ({ ok: true, data: {} }))
  const popupSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const response = await background.dispatch({ type: 'MYPWDMG_PROBE_PASSKEY_PROXY' }, popupSender)

  assert.equal(response.ok, false)
  assert.equal(response.code, 'PASSKEY_PROXY_API_UNAVAILABLE')
  assert.equal(response.data.supported, false)
  assert.equal(response.data.detached, false)
  assert.equal(response.data.permissionRemoved, false)
})

test('background startup proactively detaches a stale proxy attachment', async () => {
  let attached = true
  const { proxy, calls } = passkeyProxyMock({
    async detach() {
      calls.push({ method: 'detach' })
      attached = false
    }
  })
  const background = loadBackground(
    () => ({ ok: true, data: {} }),
    { id: 7, url: 'https://login.example.com/' },
    { webAuthenticationProxy: proxy }
  )

  for (let index = 0; index < 6; index += 1) await Promise.resolve()

  assert.equal(attached, false)
  assert.deepEqual(calls.map((call) => call.method), ['detach'])
  assert.equal(background.hasPermission('webAuthenticationProxy'), true)
})

test('background recovers a granted permission when the popup disappears', async () => {
  const { proxy, calls } = passkeyProxyMock()
  const recoveryTimerId = 9001
  const background = loadBackground(
    () => ({ ok: true, data: {} }),
    { id: 7, url: 'https://login.example.com/' },
    {
      webAuthenticationProxy: proxy,
      grantedPermissions: [],
      setTimeout(callback, duration) {
        if (duration === 10000) {
          queueMicrotask(callback)
          return recoveryTimerId
        }
        return setTimeout(callback, duration)
      },
      clearTimeout(id) {
        if (id !== recoveryTimerId) clearTimeout(id)
      }
    }
  )
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
  background.setStorage({ passkeyProxyProbePending: true })
  background.grantPermission('webAuthenticationProxy')

  await background.permissionAdded.emit({ permissions: ['webAuthenticationProxy'] })
  for (let index = 0; index < 12; index += 1) await Promise.resolve()

  assert.equal(background.hasPermission('webAuthenticationProxy'), false)
  assert.equal(background.getStorage().passkeyProxyProbePending, false)
  assert.ok(calls.filter((call) => call.method === 'detach').length >= 2)
})

test('background does not mask repeated detach failure with another probe error', async () => {
  let detachAttempts = 0
  const { proxy } = passkeyProxyMock({
    async detach() {
      detachAttempts += 1
      if (detachAttempts >= 3) throw new Error('detach blocked')
    }
  })
  const background = loadBackground(
    () => ({ ok: true, data: {} }),
    { id: 7, url: 'https://login.example.com/' },
    { webAuthenticationProxy: proxy }
  )
  const popupSender = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
  }

  const response = await background.dispatch({ type: 'MYPWDMG_PROBE_PASSKEY_PROXY' }, popupSender)

  assert.equal(response.ok, false)
  assert.equal(response.code, 'PASSKEY_PROXY_DETACH_FAILED')
  assert.equal(response.data.detached, false)
  assert.equal(response.data.permissionRemoved, true)
  assert.match(response.message, /重新加载扩展/)
})

test('manifest loads shared policy and keeps postponed passkey UI disabled', () => {
  const manifest = JSON.parse(source('manifest.json'))
  assert.deepEqual(manifest.content_scripts[0].js, ['security-core.js', 'content.js'])
  assert.equal(manifest.content_scripts[0].css, undefined)
  assert.ok(manifest.web_accessible_resources[0].resources.includes('content.css'))
  assert.equal(manifest.optional_permissions, undefined)

  const background = source('background.js')
  assert.ok(background.indexOf("import './passkey-proxy-probe.js'") < background.indexOf('getPasskeyProxyBinding()'))

  const popup = source('popup.js')
  assert.doesNotMatch(popup, /passkeyProbe|webAuthenticationProxy|MYPWDMG_PROBE_PASSKEY_PROXY/)
  assert.doesNotMatch(source('popup.html'), /通行密钥|passkeyProbe/)
})
