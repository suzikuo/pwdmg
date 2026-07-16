'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const Security = require('../security-core.js')
const extensionRoot = path.resolve(__dirname, '..')

function source(name) {
  return fs.readFileSync(path.join(extensionRoot, name), 'utf8')
}

function loadBackground(nativeResponder, activeTab = { id: 7, url: 'https://login.example.com/' }) {
  let messageListener = null
  const portMessageListeners = []
  const storage = {}
  let tokenSequence = 0
  const port = {
    onMessage: { addListener(listener) { portMessageListeners.push(listener) } },
    onDisconnect: { addListener() {} },
    postMessage(request) {
      Promise.resolve(nativeResponder(request.method, request.params || {})).then((response) => {
        for (const listener of portMessageListeners) listener({ ...response, id: request.id })
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
  const context = vm.createContext({
    URL,
    chrome,
    clearTimeout,
    console,
    crypto: { randomUUID: () => `test-token-${++tokenSequence}` },
    globalThis: null,
    setTimeout
  })
  context.globalThis = context
  context.MyPwdMgSecurity = Security
  const backgroundSource = source('background.js').replace("import './security-core.js'", '')
  vm.runInContext(backgroundSource, context, { filename: 'background.js' })

  return {
    async dispatch(message, sender) {
      assert.ok(messageListener, 'background message listener was registered')
      return new Promise((resolve) => messageListener(message, sender, resolve))
    }
  }
}

test('domain authorization accepts only matching saved domains', () => {
  assert.equal(Security.domainMatches('https://login.example.com/path', 'example.com'), true)
  assert.equal(Security.domainMatches('login.example.com', '*.example.com'), true)
  assert.equal(Security.domainMatches('example.com.evil.test', 'example.com'), false)
  assert.equal(Security.domainMatches('evil-example.com', 'example.com'), false)
  assert.equal(Security.entryMatchesHostname({ domains: ['accounts.example.com'] }, 'accounts.example.com'), true)
  assert.equal(Security.entryMatchesHostname({ domains: ['accounts.example.com'] }, 'example.com'), false)
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
  assert.match(content, /attachShadow\(\{ mode: 'closed' \}\)/)
  assert.match(content, /if \(!event\.isTrusted\) return/)
  assert.doesNotMatch(content, /data-entry-id/)
  assert.match(content, /MYPWDMG_AUTHORIZE_FILL/)
  assert.match(content, /authorizationToken: authorization\.data\.token/)
  assert.doesNotMatch(content, /lastOtpAutoFillKey/)
  assert.match(popup, /matchListEl\.addEventListener[\s\S]*if \(!event\.isTrusted\) return/)
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
  assert.match(authorizedFill, /nativeCall\('queryMatches'/)
  assert.match(authorizedFill, /matchingEntry/)
  assert.match(authorizedFill, /payloadMatchesEntry/)

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

test('manifest loads shared policy before the content script', () => {
  const manifest = JSON.parse(source('manifest.json'))
  assert.deepEqual(manifest.content_scripts[0].js, ['security-core.js', 'content.js'])
  assert.equal(manifest.content_scripts[0].css, undefined)
  assert.ok(manifest.web_accessible_resources[0].resources.includes('content.css'))
})
