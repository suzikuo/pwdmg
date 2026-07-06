const HOST_NAME = 'com.suzikuo.mypwdmg'
const REQUEST_TIMEOUT_MS = 15000

let port = null
let nextId = 1
const pending = new Map()

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (message?.type === 'MYPWDMG_QUERY_MATCHES') {
      sendResponse(await nativeCall('queryMatches', { hostname: message.hostname }))
      return
    }
    if (message?.type === 'MYPWDMG_UNLOCK') {
      const response = await nativeCall('unlock', { password: message.password || '' })
      if (response?.ok) refreshActiveTab()
      sendResponse(response)
      return
    }
    if (message?.type === 'MYPWDMG_LOCK') {
      sendResponse(await nativeCall('lock'))
      return
    }
    if (message?.type === 'MYPWDMG_GET_FILL') {
      sendResponse(await nativeCall('getFillPayload', { entryId: message.entryId }))
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
