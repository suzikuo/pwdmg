import './security-core.js'

const Security = globalThis.MyPwdMgSecurity
const HOST_NAME = 'com.suzikuo.mypwdmg'
const REQUEST_TIMEOUT_MS = 15000
const SAVE_CAPTURE_TTL_MS = 5 * 60 * 1000
const FILL_AUTH_TTL_MS = 8000
const QUERY_CACHE_TTL_MS = 8000
const QUERY_CACHE_MAX = 64
const CONTEXT_MENU_SHOW_PANEL_ID = 'mypwdmg-show-panel'
const LEGACY_AUTO_FILL_SAVE_ENABLED_KEY = 'autoFillSaveEnabled'
const AUTO_FILL_ENABLED_KEY = 'autoFillEnabled'
const AUTO_SAVE_ENABLED_KEY = 'autoSaveEnabled'
const IGNORED_SITES_KEY = 'ignoredSites'
const MANUAL_PANEL_SHORTCUT_KEY = 'manualPanelShortcut'
const DEFAULT_MANUAL_PANEL_SHORTCUT = 'Alt+T'

let port = null
let nextId = 1
const pending = new Map()
const pendingCaptures = new Map()
const pendingPromptsByContext = new Map()
const pendingLockedCapturesByContext = new Map()
const fillAuthorizations = new Map()
const queryCache = new Map()
const inflightQueryMatches = new Map()
let queryCacheVersion = 0

function ensurePort() {
  if (port) return port

  port = chrome.runtime.connectNative(HOST_NAME)
  port.onMessage.addListener((response) => {
    const id = response?.id
    const pendingRequest = pending.get(id)
    if (!pendingRequest) return

    clearTimeout(pendingRequest.timer)
    pending.delete(id)
    pendingRequest.resolve(response)
  })
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || 'Native host disconnected.'
    for (const pendingRequest of pending.values()) {
      clearTimeout(pendingRequest.timer)
      pendingRequest.resolve({ ok: false, code: 'NATIVE_HOST_ERROR', message })
    }
    pending.clear()
    port = null
    clearQueryCache()
  })

  return port
}

function nativeCall(method, params = {}) {
  return new Promise((resolve) => {
    try {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, code: 'NATIVE_HOST_TIMEOUT', message: 'Native host request timed out.' })
      }, REQUEST_TIMEOUT_MS)

      pending.set(id, { resolve, timer })
      ensurePort().postMessage({ id, method, params })
    } catch (error) {
      resolve({ ok: false, code: 'NATIVE_HOST_ERROR', message: String(error?.message || error) })
    }
  })
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) sendMessageToTab(tab.id, { type: 'MYPWDMG_REFRESH' }).catch(() => {})
}

function prunePendingCaptures() {
  const now = Date.now()
  for (const [token, item] of pendingCaptures) {
    if (item.expiresAt <= now) pendingCaptures.delete(token)
  }
  for (const [key, item] of pendingPromptsByContext) {
    if (item.expiresAt <= now || !pendingCaptures.has(item.token)) pendingPromptsByContext.delete(key)
  }
  for (const [key, item] of pendingLockedCapturesByContext) {
    if (item.expiresAt <= now) pendingLockedCapturesByContext.delete(key)
  }
  for (const [token, item] of fillAuthorizations) {
    if (item.expiresAt <= now) fillAuthorizations.delete(token)
  }
}

function pruneQueryCache() {
  const now = Date.now()
  for (const [key, item] of queryCache) {
    if (item.expiresAt <= now) queryCache.delete(key)
  }
  while (queryCache.size > QUERY_CACHE_MAX) {
    const firstKey = queryCache.keys().next().value
    if (!firstKey) break
    queryCache.delete(firstKey)
  }
}

function clearQueryCache() {
  queryCacheVersion += 1
  queryCache.clear()
  inflightQueryMatches.clear()
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve))
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve))
}

function normalizeShortcut(value, fallback = DEFAULT_MANUAL_PANEL_SHORTCUT) {
  const raw = String(value || '').trim()
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean)
  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let key = ''

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') ctrl = true
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'shift') shift = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') meta = true
    else key = normalizeShortcutKey(part)
  }

  if (!key || (!ctrl && !alt && !meta)) return fallback
  return [
    ctrl ? 'Ctrl' : '',
    alt ? 'Alt' : '',
    shift ? 'Shift' : '',
    meta ? 'Meta' : '',
    key
  ].filter(Boolean).join('+')
}

function normalizeShortcutKey(value) {
  const key = String(value || '').trim()
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  const lower = key.toLowerCase()
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase()
  if (lower === 'space') return 'Space'
  if (lower === 'escape' || lower === 'esc') return 'Escape'
  if (lower === 'enter' || lower === 'return') return 'Enter'
  if (lower === 'tab') return 'Tab'
  if (lower === 'backquote') return 'Backquote'
  if (lower === 'minus') return 'Minus'
  if (lower === 'equal') return 'Equal'
  if (lower === 'comma') return 'Comma'
  if (lower === 'period') return 'Period'
  if (lower === 'slash') return 'Slash'
  if (lower === 'semicolon') return 'Semicolon'
  if (lower === 'quote') return 'Quote'
  if (lower === 'bracketleft') return 'BracketLeft'
  if (lower === 'bracketright') return 'BracketRight'
  if (lower === 'backslash') return 'Backslash'
  return ''
}

function normalizeIgnoredSites(values = []) {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const host = normalizeHost(value)
    if (!host || seen.has(host)) continue
    seen.add(host)
    result.push(host)
  }
  return result
}

function hostMatchesIgnore(hostname = '', ignoredHost = '') {
  const host = normalizeHost(hostname)
  const pattern = normalizeHost(ignoredHost)
  return Boolean(host && pattern && (host === pattern || host.endsWith(`.${pattern}`)))
}

function isHostIgnored(hostname = '', ignoredSites = []) {
  return normalizeIgnoredSites(ignoredSites).some((site) => hostMatchesIgnore(hostname, site))
}

function clearPendingCapturesForHost(hostname = '') {
  for (const [token, item] of pendingCaptures) {
    if (hostMatchesIgnore(item.capture?.hostname, hostname)) pendingCaptures.delete(token)
  }
  for (const [key, item] of pendingPromptsByContext) {
    if (hostMatchesIgnore(item.preview?.hostname, hostname)) pendingPromptsByContext.delete(key)
  }
  for (const [key, item] of pendingLockedCapturesByContext) {
    if (hostMatchesIgnore(item.capture?.hostname, hostname)) pendingLockedCapturesByContext.delete(key)
  }
}

async function getAutoSettings() {
  const values = await storageGet({
    [LEGACY_AUTO_FILL_SAVE_ENABLED_KEY]: true,
    [AUTO_FILL_ENABLED_KEY]: null,
    [AUTO_SAVE_ENABLED_KEY]: null,
    [IGNORED_SITES_KEY]: [],
    [MANUAL_PANEL_SHORTCUT_KEY]: DEFAULT_MANUAL_PANEL_SHORTCUT
  })
  const legacyEnabled = values[LEGACY_AUTO_FILL_SAVE_ENABLED_KEY] !== false
  return {
    autoFillEnabled: values[AUTO_FILL_ENABLED_KEY] === null ? legacyEnabled : values[AUTO_FILL_ENABLED_KEY] !== false,
    autoSaveEnabled: values[AUTO_SAVE_ENABLED_KEY] === null ? legacyEnabled : values[AUTO_SAVE_ENABLED_KEY] !== false,
    ignoredSites: normalizeIgnoredSites(values[IGNORED_SITES_KEY]),
    manualPanelShortcut: normalizeShortcut(values[MANUAL_PANEL_SHORTCUT_KEY])
  }
}

async function setAutoSettings(next = {}) {
  const current = await getAutoSettings()
  const values = {
    [AUTO_FILL_ENABLED_KEY]: next.autoFillEnabled === undefined ? current.autoFillEnabled : next.autoFillEnabled !== false,
    [AUTO_SAVE_ENABLED_KEY]: next.autoSaveEnabled === undefined ? current.autoSaveEnabled : next.autoSaveEnabled !== false,
    [IGNORED_SITES_KEY]: next.ignoredSites === undefined ? current.ignoredSites : normalizeIgnoredSites(next.ignoredSites),
    [MANUAL_PANEL_SHORTCUT_KEY]: next.manualPanelShortcut === undefined
      ? current.manualPanelShortcut
      : normalizeShortcut(next.manualPanelShortcut, current.manualPanelShortcut)
  }
  await storageSet(values)
  const settings = await getAutoSettings()
  broadcastAutoSettings(settings).catch(() => {})
  return settings
}

async function broadcastAutoSettings(settings = null) {
  const nextSettings = settings || await getAutoSettings()
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
  await Promise.all(tabs.map((tab) => (
    tab?.id
      ? sendMessageToTab(tab.id, { type: 'MYPWDMG_AUTO_SETTINGS_CHANGED', settings: nextSettings }).catch(() => {})
      : Promise.resolve()
  )))
}

function receivingEndMissing(error) {
  return /receiving end does not exist|could not establish connection/i.test(String(error?.message || error || ''))
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['security-core.js', 'content.js']
  })
}

async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (error) {
    if (!receivingEndMissing(error)) throw error
    await ensureContentScript(tabId)
    return chrome.tabs.sendMessage(tabId, message)
  }
}

function newToken() {
  return crypto.randomUUID?.() || `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function publicPromptPlacement(placement) {
  if (!placement || typeof placement !== 'object') return null
  const top = Number(placement.top)
  const right = Number(placement.right)
  if (!Number.isFinite(top) || !Number.isFinite(right)) return null
  const viewportWidth = Number(placement.viewportWidth)
  const viewportHeight = Number(placement.viewportHeight)
  return {
    top: Math.max(0, Math.round(top)),
    right: Math.max(0, Math.round(right)),
    viewportWidth: Number.isFinite(viewportWidth) ? Math.max(0, Math.round(viewportWidth)) : 0,
    viewportHeight: Number.isFinite(viewportHeight) ? Math.max(0, Math.round(viewportHeight)) : 0
  }
}

function publicCapturePreview(preview, placement = null) {
  return {
    hostname: preview.hostname || '',
    title: preview.title || '',
    accountLabel: preview.accountLabel || '',
    accountKind: preview.accountKind || 'generic',
    folders: Array.isArray(preview.folders) ? preview.folders : [],
    updateCandidate: preview.updateCandidate || null,
    passwordSame: Boolean(preview.passwordSame),
    shouldPrompt: Boolean(preview.shouldPrompt),
    placement: publicPromptPlacement(placement)
  }
}

function normalizeHost(value = '') {
  return Security.normalizeHost(value)
}

function senderWebContext(sender) {
  return Security.webContext({
    tabId: sender?.tab?.id,
    frameId: sender?.frameId ?? 0,
    documentId: sender?.documentId || '',
    url: sender?.url || sender?.tab?.url || ''
  })
}

function isExtensionPageSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false
  try {
    const url = new URL(sender.url || '')
    return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id
  } catch {
    return false
  }
}

async function activeTabWebContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return Security.webContext({ tabId: tab?.id, frameId: 0, url: tab?.url || '' })
}

async function queryContextForSender(sender) {
  return senderWebContext(sender) || (isExtensionPageSender(sender) ? activeTabWebContext() : null)
}

function contextKey(context) {
  if (!context) return ''
  const documentKey = context.documentId || context.url
  return `${context.tabId}:${context.frameId}:${documentKey}`
}

function contextError(code = 'INVALID_PAGE_CONTEXT') {
  return { ok: false, code, message: 'The request is not authorized for this page.' }
}

async function sendMessageToContext(context, message) {
  if (!context?.tabId && context?.tabId !== 0) return
  const options = context.documentId
    ? { documentId: context.documentId }
    : { frameId: context.frameId || 0 }
  return chrome.tabs.sendMessage(context.tabId, message, options)
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id || 0
}

function notifyContextCaptureReady(context) {
  if (!context) return
  sendMessageToContext(context, { type: 'MYPWDMG_CAPTURE_READY' }).catch(() => {})
}

function queryCacheKey(hostname = '') {
  return normalizeHost(hostname)
}

function queryHostnames(hostname = '') {
  const host = normalizeHost(hostname)
  if (!host) return []
  if (!host.includes('.') || /^[\d.]+$/.test(host)) return [host]

  const labels = host.split('.').filter(Boolean)
  const candidates = []
  for (let index = 0; index < labels.length - 1; index += 1) {
    candidates.push(labels.slice(index).join('.'))
  }
  return candidates
}

function filterMatchesForHostname(response, hostname = '') {
  if (!response?.ok || !Array.isArray(response.data)) return response
  return {
    ...response,
    data: response.data.filter((entry) => Security.entryMatchesHostname(entry, hostname))
  }
}

async function queryMatchesWithParentFallback(hostname = '') {
  const host = normalizeHost(hostname)
  const candidates = queryHostnames(host)
  const primaryHostname = host || hostname
  const primary = filterMatchesForHostname(
    await nativeCall('queryMatches', { hostname: primaryHostname }),
    host
  )
  if (!primary?.ok || !Array.isArray(primary.data) || primary.data.length || candidates.length < 2) {
    return primary
  }

  for (const candidate of candidates.slice(1)) {
    const fallback = filterMatchesForHostname(
      await nativeCall('queryMatches', { hostname: candidate }),
      host
    )
    if (!fallback?.ok || !Array.isArray(fallback.data)) return fallback
    if (fallback.data.length) return fallback
  }
  return primary
}

async function queryMatchesCached(hostname = '') {
  pruneQueryCache()
  const key = queryCacheKey(hostname)
  if (!key) return queryMatchesWithParentFallback(hostname)

  const cached = queryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.response

  const inflight = inflightQueryMatches.get(key)
  if (inflight) return inflight

  const cacheVersion = queryCacheVersion
  let request
  request = queryMatchesWithParentFallback(key).then((response) => {
    if (response?.ok && cacheVersion === queryCacheVersion) {
      queryCache.set(key, {
        response,
        expiresAt: Date.now() + QUERY_CACHE_TTL_MS
      })
      pruneQueryCache()
    }
    return response
  }).finally(() => {
    if (inflightQueryMatches.get(key) === request) {
      inflightQueryMatches.delete(key)
    }
  })

  inflightQueryMatches.set(key, request)
  return request
}

function matchingEntry(response, entryId, hostname) {
  if (!response?.ok || !Array.isArray(response.data)) return null
  const requestedId = String(entryId || '')
  if (!requestedId) return null
  return response.data.find((entry) => (
    String(entry?.id || '') === requestedId
    && Security.entryMatchesHostname(entry, hostname)
  )) || null
}

function payloadMatchesEntry(payload, entry) {
  if (!payload || !entry) return false
  return ['id', 'title', 'username', 'email', 'phone', 'loginAccountSource']
    .every((key) => String(payload[key] ?? '') === String(entry[key] ?? ''))
}

async function authorizeFill(entryId, sender) {
  prunePendingCaptures()
  const context = senderWebContext(sender)
  if (!context) return contextError()

  const matches = await queryMatchesCached(context.hostname)
  if (!matches?.ok) return matches
  const matchedEntry = matchingEntry(matches, entryId, context.hostname)
  if (!matchedEntry) {
    return contextError('ENTRY_NOT_AUTHORIZED_FOR_SITE')
  }

  const token = newToken()
  fillAuthorizations.set(token, {
    context,
    entryId: String(entryId),
    expiresAt: Date.now() + FILL_AUTH_TTL_MS
  })
  return { ok: true, data: { token, expiresAt: Date.now() + FILL_AUTH_TTL_MS } }
}

async function getAuthorizedFill(entryId, token, sender) {
  prunePendingCaptures()
  const context = senderWebContext(sender)
  const authorization = fillAuthorizations.get(String(token || ''))
  if (!context || !authorization) return contextError('FILL_AUTH_REQUIRED')

  fillAuthorizations.delete(String(token))
  if (authorization.entryId !== String(entryId || '')
    || !Security.sameDocumentContext(authorization.context, context)) {
    return contextError('FILL_AUTH_CONTEXT_MISMATCH')
  }

  const matches = await queryMatchesWithParentFallback(context.hostname)
  if (!matches?.ok) return matches
  const matchedEntry = matchingEntry(matches, entryId, context.hostname)
  if (!matchedEntry) {
    return contextError('ENTRY_NOT_AUTHORIZED_FOR_SITE')
  }

  const response = await nativeCall('getFillPayload', { entryId: String(entryId) })
  if (!response?.ok) return response
  if (!payloadMatchesEntry(response.data, matchedEntry)) {
    return contextError('ENTRY_ID_MISMATCH')
  }
  return response
}

function forgetPromptToken(token) {
  if (!token) return
  for (const [key, item] of pendingPromptsByContext) {
    if (item.token === token || item.preview?.token === token) pendingPromptsByContext.delete(key)
  }
}

function cleanText(value = '') {
  return String(value ?? '').replace(/\0/g, '').trim()
}

function applyCaptureOverrides(capture = {}, overrides = {}) {
  const next = { ...capture }
  const title = cleanText(overrides.title)
  const account = cleanText(overrides.account)
  const accountKind = ['email', 'phone', 'username'].includes(overrides.accountKind) ? overrides.accountKind : 'username'

  if (overrides.titleEdited && title) {
    next.title = title
    next.titleEdited = true
  }
  if (overrides.accountEdited && account) {
    next.account = account
    next.accountKind = accountKind
    next.username = accountKind === 'username' ? account : ''
    next.email = accountKind === 'email' ? account : ''
    next.phone = accountKind === 'phone' ? account : ''
    next.accountEdited = true
  }
  return next
}

async function prepareCapturedLogin(capture, context, placement = null) {
  prunePendingCaptures()
  if (!context) return contextError()
  const settings = await getAutoSettings()
  if (isHostIgnored(capture?.hostname || '', settings.ignoredSites)) {
    return { ok: true, data: { shouldPrompt: false } }
  }
  const previewResponse = await nativeCall('previewCapturedLogin', { capture })
  if (!previewResponse?.ok && (previewResponse?.code === 'LOCKED' || previewResponse?.code === 'BAD_PASSWORD')) {
    pendingLockedCapturesByContext.set(contextKey(context), {
      capture,
      context,
      placement: publicPromptPlacement(placement),
      expiresAt: Date.now() + SAVE_CAPTURE_TTL_MS
    })
    return {
      ok: false,
      code: 'LOCKED_CAPTURE_PENDING',
      message: 'My Password 插件已锁定。请点击浏览器右上角 My Password 解锁，解锁后会继续弹出保存。'
    }
  }
  if (!previewResponse?.ok || !previewResponse.data) return previewResponse
  const nativePreview = previewResponse.data
  if (!nativePreview.shouldPrompt) {
    return { ok: true, data: { shouldPrompt: false } }
  }

  const token = newToken()
  pendingCaptures.set(token, {
    capture,
    context,
    saving: false,
    expiresAt: Date.now() + SAVE_CAPTURE_TTL_MS
  })
  const preview = {
    ...publicCapturePreview(nativePreview, placement),
    token
  }
  pendingPromptsByContext.set(contextKey(context), {
    token,
    preview,
    context,
    expiresAt: Date.now() + SAVE_CAPTURE_TTL_MS
  })
  notifyContextCaptureReady(context)
  return {
    ok: true,
    data: preview
  }
}

async function prepareLockedCapturesForTab(tabId = 0) {
  prunePendingCaptures()
  const items = [...pendingLockedCapturesByContext.entries()]
    .filter(([, item]) => item.context?.tabId === tabId)
  for (const [key, item] of items) {
    pendingLockedCapturesByContext.delete(key)
    await prepareCapturedLogin(item.capture, item.context, item.placement)
  }
}

async function savePreparedCapture(token, context, parentId = '', updateEntryId = '', overrides = {}) {
  prunePendingCaptures()
  const item = pendingCaptures.get(token)
  if (!item) {
    return { ok: false, code: 'CAPTURE_EXPIRED', message: '保存请求已过期，请重新提交登录表单。' }
  }
  if (!context || !Security.sameDocumentContext(item.context, context)) {
    return contextError('CAPTURE_CONTEXT_MISMATCH')
  }
  if (item.saving) {
    return { ok: false, code: 'CAPTURE_SAVE_IN_PROGRESS', message: 'Save already in progress.' }
  }
  item.saving = true
  const capture = applyCaptureOverrides(item.capture, overrides)
  let response
  try {
    response = await nativeCall('saveCapturedLogin', {
      capture,
      parentId: parentId || '',
      updateEntryId: updateEntryId || ''
    })
  } finally {
    item.saving = false
  }
  if (response?.ok) {
    pendingCaptures.delete(token)
    forgetPromptToken(token)
    clearQueryCache()
    refreshActiveTab()
  }
  return response
}

function takePreparedPrompt(context) {
  prunePendingCaptures()
  if (!context) return contextError()
  let key = contextKey(context)
  let item = pendingPromptsByContext.get(key)
  if (!item) {
    const redirected = [...pendingPromptsByContext.entries()]
      .find(([, candidate]) => Security.sameOriginFrame(candidate.context, context))
    if (redirected) {
      const [oldKey, candidate] = redirected
      pendingPromptsByContext.delete(oldKey)
      candidate.context = context
      key = contextKey(context)
      pendingPromptsByContext.set(key, candidate)
      const captureItem = pendingCaptures.get(candidate.token)
      if (captureItem) captureItem.context = context
      item = candidate
    }
  }
  if (!item) return { ok: true, data: null }
  if (!pendingCaptures.has(item.token)) {
    pendingPromptsByContext.delete(key)
    return { ok: true, data: null }
  }
  return { ok: true, data: item.preview }
}

function dismissPreparedCapture(token, context) {
  const item = pendingCaptures.get(token)
  if (!item) return { ok: true, data: null }
  if (!context || !Security.sameDocumentContext(item.context, context)) {
    return contextError('CAPTURE_CONTEXT_MISMATCH')
  }
  pendingCaptures.delete(token)
  forgetPromptToken(token)
  return { ok: true, data: null }
}

async function addIgnoredSite(hostname = '', token = '', context = null) {
  const targetHost = normalizeHost(hostname)
  if (!targetHost) return getAutoSettings()

  const current = await getAutoSettings()
  const alreadyIgnored = isHostIgnored(targetHost, current.ignoredSites)
  const ignoredSites = alreadyIgnored ? current.ignoredSites : normalizeIgnoredSites([...current.ignoredSites, targetHost])
  const alreadySaved = alreadyIgnored || (
    ignoredSites.length === current.ignoredSites.length
    && ignoredSites.every((site, index) => site === current.ignoredSites[index])
  )
  const settings = alreadySaved ? current : await setAutoSettings({ ignoredSites })

  clearPendingCapturesForHost(targetHost)
  if (token) dismissPreparedCapture(token, context)
  return settings
}

async function removeIgnoredSite(hostname = '') {
  const targetHost = normalizeHost(hostname)
  if (!targetHost) return getAutoSettings()

  const current = await getAutoSettings()
  const ignoredSites = current.ignoredSites.filter((site) => !hostMatchesIgnore(site, targetHost) && !hostMatchesIgnore(targetHost, site))
  if (ignoredSites.length === current.ignoredSites.length) return current
  return setAutoSettings({ ignoredSites })
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SHOW_PANEL_ID,
      title: 'My Password 页面弹窗',
      contexts: ['editable', 'page', 'selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    })
  })
}

async function showPanelInTab(tabId = 0, source = 'contextMenu') {
  if (!tabId) return
  await sendMessageToTab(tabId, { type: 'MYPWDMG_SHOW_PANEL', source }).catch(() => {})
}

async function showPanelInActiveTab(source = 'command') {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await showPanelInTab(tab?.id || 0, source)
}

chrome.runtime.onInstalled.addListener(setupContextMenus)
chrome.runtime.onStartup?.addListener(setupContextMenus)
setupContextMenus()

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_SHOW_PANEL_ID) {
    showPanelInTab(tab?.id || 0, 'contextMenu')
    return
  }
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'show-panel') showPanelInActiveTab('command').catch(() => {})
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (message?.type === 'MYPWDMG_QUERY_MATCHES') {
      const context = await queryContextForSender(sender)
      sendResponse(context ? await queryMatchesCached(context.hostname) : contextError())
      return
    }
    if (message?.type === 'MYPWDMG_UNLOCK') {
      const response = await nativeCall('unlock', { password: message.password || '' })
      if (response?.ok) {
        clearQueryCache()
        await prepareLockedCapturesForTab(await activeTabId())
        refreshActiveTab()
      }
      sendResponse(response)
      return
    }
    if (message?.type === 'MYPWDMG_LOCK') {
      const response = await nativeCall('lock')
      if (response?.ok) {
        clearQueryCache()
        fillAuthorizations.clear()
      }
      sendResponse(response)
      return
    }
    if (message?.type === 'MYPWDMG_AUTHORIZE_FILL') {
      sendResponse(await authorizeFill(message.entryId, sender))
      return
    }
    if (message?.type === 'MYPWDMG_GET_FILL') {
      sendResponse(await getAuthorizedFill(message.entryId, message.authorizationToken, sender))
      return
    }
    if (message?.type === 'MYPWDMG_PREPARE_CAPTURE') {
      const context = senderWebContext(sender)
      if (!context) {
        sendResponse(contextError())
        return
      }
      const capture = { ...(message.capture || {}), hostname: context.hostname }
      const settings = await getAutoSettings()
      if (!settings.autoSaveEnabled || isHostIgnored(context.hostname, settings.ignoredSites)) {
        sendResponse({ ok: true, data: { shouldPrompt: false } })
        return
      }
      sendResponse(await prepareCapturedLogin(capture, context, message.placement || null))
      return
    }
    if (message?.type === 'MYPWDMG_SAVE_CAPTURE') {
      sendResponse(await savePreparedCapture(
        message.token,
        senderWebContext(sender),
        message.parentId,
        message.updateEntryId,
        message.overrides || {}
      ))
      return
    }
    if (message?.type === 'MYPWDMG_TAKE_SAVE_PROMPT') {
      const context = senderWebContext(sender)
      if (!context) {
        sendResponse(contextError())
        return
      }
      const settings = await getAutoSettings()
      if (!settings.autoSaveEnabled || isHostIgnored(context.hostname, settings.ignoredSites)) {
        sendResponse({ ok: true, data: null })
        return
      }
      sendResponse(takePreparedPrompt(context))
      return
    }
    if (message?.type === 'MYPWDMG_ADD_IGNORED_SITE') {
      const contentContext = senderWebContext(sender)
      if (contentContext) {
        const item = pendingCaptures.get(String(message.token || ''))
        if (!item || !Security.sameDocumentContext(item.context, contentContext)) {
          sendResponse(contextError('CAPTURE_CONTEXT_MISMATCH'))
          return
        }
        sendResponse({ ok: true, data: await addIgnoredSite(contentContext.hostname, message.token, contentContext) })
        return
      }
      const popupContext = isExtensionPageSender(sender) ? await activeTabWebContext() : null
      sendResponse(popupContext
        ? { ok: true, data: await addIgnoredSite(popupContext.hostname) }
        : contextError())
      return
    }
    if (message?.type === 'MYPWDMG_REMOVE_IGNORED_SITE') {
      sendResponse(isExtensionPageSender(sender)
        ? { ok: true, data: await removeIgnoredSite(message.hostname || '') }
        : contextError())
      return
    }
    if (message?.type === 'MYPWDMG_DISMISS_CAPTURE') {
      sendResponse(dismissPreparedCapture(message.token, senderWebContext(sender)))
      return
    }
    if (message?.type === 'MYPWDMG_LIST_SAVE_TARGETS') {
      sendResponse(await nativeCall('listSaveTargets'))
      return
    }
    if (message?.type === 'MYPWDMG_STATE') {
      sendResponse(await nativeCall('getState'))
      return
    }
    if (message?.type === 'MYPWDMG_GET_AUTO_SETTINGS') {
      sendResponse({ ok: true, data: await getAutoSettings() })
      return
    }
    if (message?.type === 'MYPWDMG_SET_AUTO_SETTINGS') {
      sendResponse({ ok: true, data: await setAutoSettings(message.settings || {}) })
      return
    }
    sendResponse({ ok: false, code: 'UNKNOWN_MESSAGE', message: 'Unknown extension message.' })
  })().catch((error) => {
    sendResponse({ ok: false, code: 'EXTENSION_INTERNAL_ERROR', message: String(error?.message || error) })
  })
  return true
})
