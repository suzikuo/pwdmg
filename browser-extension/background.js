const HOST_NAME = 'com.suzikuo.mypwdmg'
const REQUEST_TIMEOUT_MS = 15000
const SAVE_CAPTURE_TTL_MS = 5 * 60 * 1000
const QUERY_CACHE_TTL_MS = 8000
const QUERY_CACHE_MAX = 64

let port = null
let nextId = 1
const pending = new Map()
const pendingCaptures = new Map()
const pendingPromptsByTab = new Map()
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
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'MYPWDMG_REFRESH' }).catch(() => {})
}

function prunePendingCaptures() {
  const now = Date.now()
  for (const [token, item] of pendingCaptures) {
    if (item.expiresAt <= now) pendingCaptures.delete(token)
  }
  for (const [tabId, item] of pendingPromptsByTab) {
    if (item.expiresAt <= now) pendingPromptsByTab.delete(tabId)
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

async function prepareCapturedLogin(capture, tabId = 0) {
  prunePendingCaptures()
  const previewResponse = await nativeCall('previewCapturedLogin', { capture })
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
  }
  return {
    ok: true,
    data: preview
  }
}

async function savePreparedCapture(token, parentId = '', updateEntryId = '') {
  prunePendingCaptures()
  const item = pendingCaptures.get(token)
  if (!item) {
    return { ok: false, code: 'CAPTURE_EXPIRED', message: '保存请求已过期，请重新提交登录表单。' }
  }
  pendingCaptures.delete(token)
  forgetPromptToken(token)
  const response = await nativeCall('saveCapturedLogin', {
    capture: item.capture,
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
      sendResponse(await prepareCapturedLogin(message.capture || {}, sender?.tab?.id || 0))
      return
    }
    if (message?.type === 'MYPWDMG_SAVE_CAPTURE') {
      sendResponse(await savePreparedCapture(message.token, message.parentId, message.updateEntryId))
      return
    }
    if (message?.type === 'MYPWDMG_TAKE_SAVE_PROMPT') {
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
    sendResponse({ ok: false, code: 'UNKNOWN_MESSAGE', message: 'Unknown extension message.' })
  })()
  return true
})
