const statusEl = document.getElementById('status')
const matchInfoEl = document.getElementById('matchInfo')
const siteHostEl = document.getElementById('siteHost')
const stateBadgeEl = document.getElementById('stateBadge')
const form = document.getElementById('unlockForm')
const passwordInput = document.getElementById('password')
const lockButton = document.getElementById('lockButton')
const refreshButton = document.getElementById('refreshButton')
const showPanelButton = document.getElementById('showPanelButton')
const autoFillToggle = document.getElementById('autoFillToggle')
const autoSaveToggle = document.getElementById('autoSaveToggle')
const shortcutInput = document.getElementById('shortcutInput')
const resetShortcutButton = document.getElementById('resetShortcutButton')
const matchListEl = document.getElementById('matchList')

const DEFAULT_MANUAL_PANEL_SHORTCUT = 'Alt+T'
let activeTab = null
let activeHost = ''
let autoFillEnabled = true
let autoSaveEnabled = true
let manualPanelShortcut = DEFAULT_MANUAL_PANEL_SHORTCUT

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      if (error) {
        resolve({ ok: false, code: 'EXTENSION_MESSAGE_ERROR', message: String(error.message || error) })
        return
      }
      resolve(response)
    })
  })
}

function sendToActiveTab(message) {
  return new Promise((resolve) => {
    if (!activeTab?.id) {
      resolve({ ok: false, message: '当前页面不可填充。' })
      return
    }
    chrome.tabs.sendMessage(activeTab.id, message, (response) => {
      const error = chrome.runtime.lastError
      if (!error) {
        resolve(response || { ok: true })
        return
      }
      if (!/receiving end does not exist|could not establish connection/i.test(String(error.message || error))) {
        resolve({ ok: false, message: String(error.message || error) })
        return
      }
      chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content.css'] }, () => {
        chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] }, () => {
          const injectError = chrome.runtime.lastError
          if (injectError) {
            resolve({ ok: false, message: String(injectError.message || injectError) })
            return
          }
          chrome.tabs.sendMessage(activeTab.id, message, (retryResponse) => {
            const retryError = chrome.runtime.lastError
            resolve(retryError ? { ok: false, message: String(retryError.message || retryError) } : (retryResponse || { ok: true }))
          })
        })
      })
    })
  })
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  activeTab = tab || null
  activeHost = tabHost(tab)
  siteHostEl.textContent = activeHost || '当前页面不可填充'
  return activeTab
}

function tabHost(tab) {
  try {
    const url = new URL(tab?.url || '')
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function refreshActiveTab() {
  await sendToActiveTab({ type: 'MYPWDMG_REFRESH' })
}

async function loadAutoSettings() {
  const response = await send({ type: 'MYPWDMG_GET_AUTO_SETTINGS' })
  autoFillEnabled = response?.data?.autoFillEnabled !== false
  autoSaveEnabled = response?.data?.autoSaveEnabled !== false
  manualPanelShortcut = response?.data?.manualPanelShortcut || DEFAULT_MANUAL_PANEL_SHORTCUT
  autoFillToggle.checked = autoFillEnabled
  autoSaveToggle.checked = autoSaveEnabled
  shortcutInput.value = manualPanelShortcut
  updateShowPanelShortcutLabel()
}

async function setAutoSettings(nextSettings) {
  const response = await send({ type: 'MYPWDMG_SET_AUTO_SETTINGS', settings: nextSettings })
  if (!response?.ok) {
    autoFillToggle.checked = autoFillEnabled
    autoSaveToggle.checked = autoSaveEnabled
    statusEl.textContent = response?.message || '切换自动设置失败。'
    return
  }
  autoFillEnabled = response.data?.autoFillEnabled !== false
  autoSaveEnabled = response.data?.autoSaveEnabled !== false
  manualPanelShortcut = response.data?.manualPanelShortcut || DEFAULT_MANUAL_PANEL_SHORTCUT
  autoFillToggle.checked = autoFillEnabled
  autoSaveToggle.checked = autoSaveEnabled
  shortcutInput.value = manualPanelShortcut
  updateShowPanelShortcutLabel()
  statusEl.textContent = `自动填充${autoFillEnabled ? '已开启' : '已关闭'}，自动保存${autoSaveEnabled ? '已开启' : '已关闭'}。`
  await refreshActiveTab()
}

function setBadge(text, state) {
  stateBadgeEl.textContent = text
  stateBadgeEl.dataset.state = state
}

function updateShowPanelShortcutLabel() {
  showPanelButton.innerHTML = `页面弹窗 <span>${escapeHtml(manualPanelShortcut)}</span>`
}

function shortcutFromEvent(event) {
  const key = shortcutKeyFromEvent(event)
  if (!key) return ''
  const parts = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(key)
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return ''
  return parts.join('+')
}

function shortcutKeyFromEvent(event) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code
  const aliases = {
    Space: 'Space',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backquote: 'Backquote',
    Minus: 'Minus',
    Equal: 'Equal',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    BracketLeft: 'BracketLeft',
    BracketRight: 'BracketRight',
    Backslash: 'Backslash'
  }
  return aliases[event.code] || ''
}

function showLocked(message = '请输入主密码解锁插件。') {
  setBadge('已锁定', 'locked')
  statusEl.textContent = message
  matchInfoEl.textContent = ''
  matchListEl.innerHTML = ''
  form.hidden = false
  lockButton.hidden = true
  showPanelButton.hidden = true
  window.setTimeout(() => passwordInput.focus(), 20)
}

function showUnlocked() {
  setBadge('已解锁', 'unlocked')
  form.hidden = true
  lockButton.hidden = false
  showPanelButton.hidden = !activeHost
}

function showUnavailable(message, state = 'error') {
  setBadge(state === 'empty' ? '未创建' : '不可用', state)
  statusEl.textContent = message
  matchInfoEl.textContent = ''
  matchListEl.innerHTML = ''
  form.hidden = true
  lockButton.hidden = true
  showPanelButton.hidden = true
}

async function unlock(password, silent = false) {
  if (!silent) {
    setBadge('解锁中', 'checking')
    statusEl.textContent = '正在解锁...'
  }

  const response = await send({ type: 'MYPWDMG_UNLOCK', password })
  passwordInput.value = ''
  if (!response?.ok) {
    if (!silent) showLocked(response?.message || '解锁失败。')
    return false
  }

  showUnlocked()
  await refreshActiveTab()
  await loadMatches()
  return true
}

async function loadMatches() {
  if (!activeHost) {
    statusEl.textContent = '当前页面不是可填充的网站。'
    matchInfoEl.textContent = ''
    matchListEl.innerHTML = ''
    showPanelButton.hidden = true
    return
  }

  statusEl.textContent = '已连接本地保险库。'
  matchInfoEl.textContent = autoFillEnabled ? '正在查询当前站点...' : '自动填充已关闭，下面账号仍可手动填充。'
  const response = await send({ type: 'MYPWDMG_QUERY_MATCHES', hostname: activeHost })
  if (!response?.ok) {
    if (response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
      showLocked('请输入主密码解锁插件。')
      return
    }
    matchInfoEl.textContent = response?.message || '无法读取当前网站账号。'
    matchListEl.innerHTML = ''
    return
  }

  const matches = Array.isArray(response.data) ? response.data : []
  matchInfoEl.textContent = matches.length ? `当前站点有 ${matches.length} 个匹配账号。` : '当前站点暂无匹配账号。'
  matchListEl.innerHTML = matches.map(renderMatch).join('')
}

function renderMatch(entry) {
  const label = entry.username || entry.email || entry.phone || entry.domains?.[0] || '未设置账号'
  const badges = [
    sourceLabel(entry.loginAccountSource),
    entry.hasTotp ? 'TOTP' : ''
  ].filter(Boolean)
  return `
    <div class="match-row">
      <div class="match-copy">
        <strong>${escapeHtml(entry.title || 'Untitled')}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
      <div class="match-meta">
        <small>${escapeHtml(badges.join(' · '))}</small>
        <button class="fill-button" type="button" data-entry-id="${escapeAttr(entry.id)}">填充</button>
      </div>
    </div>
  `
}

function sourceLabel(source) {
  if (source === 'email') return '邮箱'
  if (source === 'phone') return '手机'
  if (source === 'username') return '账号'
  return '自动'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

async function loadState() {
  form.hidden = true
  lockButton.hidden = true
  showPanelButton.hidden = true
  matchListEl.innerHTML = ''
  setBadge('检测中', 'checking')

  await getActiveTab()
  await loadAutoSettings()
  const response = await send({ type: 'MYPWDMG_STATE' })
  if (!response?.ok) {
    showUnavailable(response?.message || '无法连接本地 Native Host。')
    return
  }

  const state = response.data
  if (!state.hasVault) {
    showUnavailable('还没有保险库，请先打开桌面端创建。', 'empty')
    return
  }

  if (!state.locked) {
    showUnlocked()
    await loadMatches()
    return
  }

  setBadge('解锁中', 'checking')
  statusEl.textContent = '正在尝试空密码解锁...'
  const unlocked = await unlock('', true)
  if (!unlocked) showLocked('请输入主密码解锁插件。')
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  await unlock(passwordInput.value, false)
})

lockButton.addEventListener('click', async () => {
  setBadge('锁定中', 'checking')
  statusEl.textContent = '正在锁定...'
  const response = await send({ type: 'MYPWDMG_LOCK' })
  if (!response?.ok) {
    statusEl.textContent = response?.message || '锁定失败。'
    return
  }
  showLocked('插件已锁定。')
  await refreshActiveTab()
})

refreshButton.addEventListener('click', async () => {
  await refreshActiveTab()
  await loadState()
})

autoFillToggle.addEventListener('change', async () => {
  await setAutoSettings({ autoFillEnabled: autoFillToggle.checked })
})

autoSaveToggle.addEventListener('change', async () => {
  await setAutoSettings({ autoSaveEnabled: autoSaveToggle.checked })
})

shortcutInput.addEventListener('focus', () => {
  shortcutInput.value = '按下组合键'
})

shortcutInput.addEventListener('blur', () => {
  shortcutInput.value = manualPanelShortcut
})

shortcutInput.addEventListener('keydown', async (event) => {
  event.preventDefault()
  event.stopPropagation()
  const shortcut = shortcutFromEvent(event)
  if (!shortcut) {
    shortcutInput.value = '需要 Ctrl/Alt/Meta + 按键'
    return
  }
  shortcutInput.value = shortcut
  await setAutoSettings({ manualPanelShortcut: shortcut })
})

resetShortcutButton.addEventListener('click', async () => {
  await setAutoSettings({ manualPanelShortcut: DEFAULT_MANUAL_PANEL_SHORTCUT })
})

showPanelButton.addEventListener('click', async () => {
  showPanelButton.disabled = true
  showPanelButton.textContent = '...'
  const response = await sendToActiveTab({ type: 'MYPWDMG_SHOW_PANEL' })
  if (!response?.ok) {
    showPanelButton.disabled = false
    showPanelButton.textContent = '页面弹窗'
    statusEl.textContent = response?.message || '无法在当前页面显示弹窗。'
    return
  }
  window.close()
})

matchListEl.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('.fill-button')
  if (!button) return
  button.disabled = true
  button.textContent = '...'
  const response = await sendToActiveTab({ type: 'MYPWDMG_FILL_ENTRY', entryId: button.getAttribute('data-entry-id'), manual: true })
  if (!response?.ok) {
    button.disabled = false
    button.textContent = '填充'
    statusEl.textContent = response?.message || '无法向当前页面填充。'
    return
  }
  window.close()
})

loadState()
