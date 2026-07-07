const HOST_NAME = 'com.suzikuo.mypwdmg'
const REQUEST_TIMEOUT_MS = 15000
const SAVE_CAPTURE_TTL_MS = 5 * 60 * 1000
const QUERY_CACHE_TTL_MS = 8000
const QUERY_CACHE_MAX = 64
const CONTEXT_MENU_SHOW_PANEL_ID = 'mypwdmg-show-panel'
const LEGACY_AUTO_FILL_SAVE_ENABLED_KEY = 'autoFillSaveEnabled'
const AUTO_FILL_ENABLED_KEY = 'autoFillEnabled'
const AUTO_SAVE_ENABLED_KEY = 'autoSaveEnabled'
const MANUAL_PANEL_SHORTCUT_KEY = 'manualPanelShortcut'
const DEFAULT_MANUAL_PANEL_SHORTCUT = 'Alt+T'

let port = null
let nextId = 1
const pending = new Map()
const pendingCaptures = new Map()
const pendingPromptsByTab = new Map()
const pendingLockedCapturesByTab = new Map()
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
  for (const [tabId, item] of pendingPromptsByTab) {
    if (item.expiresAt <= now) pendingPromptsByTab.delete(tabId)
  }
  for (const [tabId, item] of pendingLockedCapturesByTab) {
    if (item.expiresAt <= now) pendingLockedCapturesByTab.delete(tabId)
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

async function getAutoSettings() {
  const values = await storageGet({
    [LEGACY_AUTO_FILL_SAVE_ENABLED_KEY]: true,
    [AUTO_FILL_ENABLED_KEY]: null,
    [AUTO_SAVE_ENABLED_KEY]: null,
    [MANUAL_PANEL_SHORTCUT_KEY]: DEFAULT_MANUAL_PANEL_SHORTCUT
  })
  const legacyEnabled = values[LEGACY_AUTO_FILL_SAVE_ENABLED_KEY] !== false
  return {
    autoFillEnabled: values[AUTO_FILL_ENABLED_KEY] === null ? legacyEnabled : values[AUTO_FILL_ENABLED_KEY] !== false,
    autoSaveEnabled: values[AUTO_SAVE_ENABLED_KEY] === null ? legacyEnabled : values[AUTO_SAVE_ENABLED_KEY] !== false,
    manualPanelShortcut: normalizeShortcut(values[MANUAL_PANEL_SHORTCUT_KEY])
  }
}

async function setAutoSettings(next = {}) {
  const current = await getAutoSettings()
  const values = {
    [AUTO_FILL_ENABLED_KEY]: next.autoFillEnabled === undefined ? current.autoFillEnabled : next.autoFillEnabled !== false,
    [AUTO_SAVE_ENABLED_KEY]: next.autoSaveEnabled === undefined ? current.autoSaveEnabled : next.autoSaveEnabled !== false,
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
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content.css']
  }).catch(() => {})
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
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

function publicCapturePreview(preview) {
  return {
    hostname: preview.hostname || '',
    title: preview.title || '',
    accountLabel: preview.accountLabel || '',
    accountKind: preview.accountKind || 'generic',
    folders: Array.isArray(preview.folders) ? preview.folders : [],
    updateCandidate: preview.updateCandidate || null,
    passwordSame: Boolean(preview.passwordSame),
    shouldPrompt: Boolean(preview.shouldPrompt)
  }
}

function normalizeHost(value = '') {
  let host = String(value || '').trim().toLowerCase()
  const schemeIndex = host.indexOf('://')
  if (schemeIndex >= 0) host = host.slice(schemeIndex + 3)
  host = host.split('/', 1)[0].replace(/^\.+|\.+$/g, '')
  return host.startsWith('www.') ? host.slice(4) : host
}

function hostLooksRelated(left, right) {
  const a = normalizeHost(left)
  const b = normalizeHost(right)
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)))
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id || 0
}

function notifyTabCaptureReady(tabId) {
  if (!tabId) return
  sendMessageToTab(tabId, { type: 'MYPWDMG_CAPTURE_READY' }).catch(() => {})
}

function queryCacheKey(hostname = '') {
  return normalizeHost(hostname)
}

async function queryMatchesCached(hostname = '') {
  pruneQueryCache()
  const key = queryCacheKey(hostname)
  if (!key) return nativeCall('queryMatches', { hostname })

  const cached = queryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.response

  const inflight = inflightQueryMatches.get(key)
  if (inflight) return inflight

  const cacheVersion = queryCacheVersion
  let request
  request = nativeCall('queryMatches', { hostname: key }).then((response) => {
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

function forgetPromptToken(token) {
  if (!token) return
  for (const [tabId, item] of pendingPromptsByTab) {
    if (item.preview?.token === token) pendingPromptsByTab.delete(tabId)
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

async function prepareCapturedLogin(capture, tabId = 0) {
  prunePendingCaptures()
  const previewResponse = await nativeCall('previewCapturedLogin', { capture })
  if (!previewResponse?.ok && tabId && (previewResponse?.code === 'LOCKED' || previewResponse?.code === 'BAD_PASSWORD')) {
    pendingLockedCapturesByTab.set(tabId, {
      capture,
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
    expiresAt: Date.now() + SAVE_CAPTURE_TTL_MS
  })
  const preview = {
    ...publicCapturePreview(nativePreview),
    token
  }
  if (tabId) {
    pendingPromptsByTab.set(tabId, {
      preview,
      expiresAt: Date.now() + SAVE_CAPTURE_TTL_MS
    })
    notifyTabCaptureReady(tabId)
  }
  return {
    ok: true,
    data: preview
  }
}

async function prepareLockedCaptureForTab(tabId = 0) {
  prunePendingCaptures()
  const item = pendingLockedCapturesByTab.get(tabId)
  if (!item) return
  pendingLockedCapturesByTab.delete(tabId)
  await prepareCapturedLogin(item.capture, tabId)
}

async function savePreparedCapture(token, parentId = '', updateEntryId = '', overrides = {}) {
  prunePendingCaptures()
  const item = pendingCaptures.get(token)
  if (!item) {
    return { ok: false, code: 'CAPTURE_EXPIRED', message: '保存请求已过期，请重新提交登录表单。' }
  }
  pendingCaptures.delete(token)
  forgetPromptToken(token)
  const capture = applyCaptureOverrides(item.capture, overrides)
  const response = await nativeCall('saveCapturedLogin', {
    capture,
    parentId: parentId || '',
    updateEntryId: updateEntryId || ''
  })
  if (response?.ok) {
    clearQueryCache()
    refreshActiveTab()
  }
  return response
}

function takePreparedPrompt(tabId = 0, hostname = '') {
  prunePendingCaptures()
  const item = pendingPromptsByTab.get(tabId)
  if (!item) return { ok: true, data: null }
  if (!hostLooksRelated(hostname, item.preview?.hostname)) return { ok: true, data: null }
  pendingPromptsByTab.delete(tabId)
  return { ok: true, data: item.preview }
}

function dismissPreparedCapture(token) {
  pendingCaptures.delete(token)
  forgetPromptToken(token)
  return { ok: true, data: null }
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
      sendResponse(await queryMatchesCached(message.hostname))
      return
    }
    if (message?.type === 'MYPWDMG_UNLOCK') {
      const response = await nativeCall('unlock', { password: message.password || '' })
      if (response?.ok) {
        clearQueryCache()
        await prepareLockedCaptureForTab(await activeTabId())
        refreshActiveTab()
      }
      sendResponse(response)
      return
    }
    if (message?.type === 'MYPWDMG_LOCK') {
      const response = await nativeCall('lock')
      if (response?.ok) clearQueryCache()
      sendResponse(response)
      return
    }
    if (message?.type === 'MYPWDMG_GET_FILL') {
      sendResponse(await nativeCall('getFillPayload', { entryId: message.entryId }))
      return
    }
    if (message?.type === 'MYPWDMG_PREPARE_CAPTURE') {
      const settings = await getAutoSettings()
      if (!settings.autoSaveEnabled) {
        sendResponse({ ok: true, data: { shouldPrompt: false } })
        return
      }
      sendResponse(await prepareCapturedLogin(message.capture || {}, sender?.tab?.id || 0))
      return
    }
    if (message?.type === 'MYPWDMG_SAVE_CAPTURE') {
      sendResponse(await savePreparedCapture(message.token, message.parentId, message.updateEntryId, message.overrides || {}))
      return
    }
    if (message?.type === 'MYPWDMG_TAKE_SAVE_PROMPT') {
      const settings = await getAutoSettings()
      if (!settings.autoSaveEnabled) {
        sendResponse({ ok: true, data: null })
        return
      }
      sendResponse(takePreparedPrompt(sender?.tab?.id || 0, message.hostname || ''))
      return
    }
    if (message?.type === 'MYPWDMG_DISMISS_CAPTURE') {
      sendResponse(dismissPreparedCapture(message.token))
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
  })()
  return true
})
