const statusEl = document.getElementById('status')
const noticeEl = document.getElementById('notice')
const matchesEl = document.getElementById('matches')
const matchCountEl = document.getElementById('matchCount')
const matchInfoEl = document.getElementById('matchInfo')
const siteHostEl = document.getElementById('siteHost')
const stateBadgeEl = document.getElementById('stateBadge')
const form = document.getElementById('unlockForm')
const passwordInput = document.getElementById('password')
const unlockButton = document.getElementById('unlockButton')
const quickUnlockButton = document.getElementById('quickUnlockButton')
const lockButton = document.getElementById('lockButton')
const refreshButton = document.getElementById('refreshButton')
const showPanelButton = document.getElementById('showPanelButton')
const showPanelLabel = document.getElementById('showPanelLabel')
const showPanelShortcut = document.getElementById('showPanelShortcut')
const autoFillToggle = document.getElementById('autoFillToggle')
const autoSaveToggle = document.getElementById('autoSaveToggle')
const ignoredSiteSettingEl = document.getElementById('ignoredSiteSetting')
const ignoredCurrentEl = document.getElementById('ignoredCurrent')
const ignoredCurrentStateEl = document.getElementById('ignoredCurrentState')
const toggleIgnoredSiteButton = document.getElementById('toggleIgnoredSiteButton')
const ignoredSiteCountEl = document.getElementById('ignoredSiteCount')
const ignoredSiteListEl = document.getElementById('ignoredSiteList')
const shortcutInput = document.getElementById('shortcutInput')
const resetShortcutButton = document.getElementById('resetShortcutButton')
const matchListEl = document.getElementById('matchList')
const appearance = MyPwdMgAppearance.createController(() => document.documentElement)
const appearanceButton = document.getElementById('appearanceButton')

const DEFAULT_MANUAL_PANEL_SHORTCUT = 'Alt+T'
let activeTab = null
let activeHost = ''
let autoFillEnabled = true
let autoSaveEnabled = true
let manualPanelShortcut = DEFAULT_MANUAL_PANEL_SHORTCUT
let ignoredSites = []

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
      chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['security-core.js', 'builtin-skins.js', 'appearance.js', 'content.js'] }, () => {
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

function normalizeHost(value = '') {
  let host = String(value || '').trim().toLowerCase()
  const schemeIndex = host.indexOf('://')
  if (schemeIndex >= 0) host = host.slice(schemeIndex + 3)
  host = host.split('/', 1)[0].replace(/^\.+|\.+$/g, '')
  return host.startsWith('www.') ? host.slice(4) : host
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

function findMatchingIgnoredSite(hostname = activeHost) {
  const host = normalizeHost(hostname)
  if (!host) return ''
  const exact = ignoredSites.find((site) => site === host)
  if (exact) return exact
  return ignoredSites.find((site) => hostMatchesIgnore(host, site)) || ''
}

function isCurrentSiteIgnored() {
  return Boolean(findMatchingIgnoredSite(activeHost))
}

async function toggleCurrentSiteIgnored() {
  if (!activeHost) return
  const current = findMatchingIgnoredSite()
  const response = current
    ? await send({ type: 'MYPWDMG_REMOVE_IGNORED_SITE', hostname: activeHost })
    : await send({ type: 'MYPWDMG_ADD_IGNORED_SITE', hostname: activeHost })
  if (!response?.ok) {
    setNotice(response?.message || '更新忽略站点失败。', true)
    return
  }
  ignoredSites = normalizeIgnoredSites(response.data?.ignoredSites)
  renderIgnoredSites()
  setNotice(current ? `已取消忽略 ${activeHost}。` : `已忽略 ${activeHost}。`)
  await refreshActiveTab()
}

async function removeIgnoredSite(site) {
  const target = normalizeHost(site)
  if (!target) return
  const response = await send({ type: 'MYPWDMG_REMOVE_IGNORED_SITE', hostname: target })
  if (!response?.ok) {
    setNotice(response?.message || '移除忽略站点失败。', true)
    return
  }
  ignoredSites = normalizeIgnoredSites(response.data?.ignoredSites)
  renderIgnoredSites()
  setNotice(`已移除 ${target}。`)
  await refreshActiveTab()
}

async function refreshActiveTab() {
  await sendToActiveTab({ type: 'MYPWDMG_REFRESH' })
}

function applyAutoSettings(settings = {}) {
  autoFillEnabled = settings.autoFillEnabled !== false
  autoSaveEnabled = settings.autoSaveEnabled !== false
  ignoredSites = normalizeIgnoredSites(settings.ignoredSites)
  manualPanelShortcut = settings.manualPanelShortcut || DEFAULT_MANUAL_PANEL_SHORTCUT
  autoFillToggle.checked = autoFillEnabled
  autoSaveToggle.checked = autoSaveEnabled
  shortcutInput.value = manualPanelShortcut
  showPanelShortcut.textContent = manualPanelShortcut
  renderIgnoredSites()
}

async function loadAutoSettings() {
  const response = await send({ type: 'MYPWDMG_GET_AUTO_SETTINGS' })
  applyAutoSettings(response?.data)
}

async function setAutoSettings(nextSettings) {
  const response = await send({ type: 'MYPWDMG_SET_AUTO_SETTINGS', settings: nextSettings })
  if (!response?.ok) {
    autoFillToggle.checked = autoFillEnabled
    autoSaveToggle.checked = autoSaveEnabled
    shortcutInput.value = manualPanelShortcut
    setNotice(response?.message || '保存设置失败。', true)
    return
  }
  applyAutoSettings(response.data)
  const changedToggle = 'autoFillEnabled' in nextSettings || 'autoSaveEnabled' in nextSettings
  setNotice(changedToggle ? '自动功能设置已更新。' : `快捷键已设为 ${manualPanelShortcut}。`)
  await refreshActiveTab()
}

function setBadge(text, state) {
  stateBadgeEl.textContent = text
  stateBadgeEl.dataset.state = state
}

function setNotice(message = '', error = false) {
  noticeEl.hidden = !message
  noticeEl.textContent = message
  noticeEl.toggleAttribute('data-error', error)
}

function renderIgnoredSites() {
  const currentMatch = findMatchingIgnoredSite()
  ignoredSiteSettingEl.hidden = false
  ignoredCurrentEl.hidden = !activeHost
  ignoredCurrentStateEl.textContent = currentMatch ? `已忽略 ${currentMatch}` : '未忽略'
  toggleIgnoredSiteButton.textContent = currentMatch ? '取消忽略' : '忽略该网站'
  toggleIgnoredSiteButton.dataset.action = currentMatch ? 'remove' : 'add'
  ignoredSiteCountEl.textContent = String(ignoredSites.length)

  if (!ignoredSites.length) {
    ignoredSiteListEl.innerHTML = '<p class="ignored-empty">暂无已忽略网站。</p>'
    return
  }

  ignoredSiteListEl.innerHTML = ignoredSites.map((site) => {
    const active = hostMatchesIgnore(activeHost, site)
    return `
      <div class="ignored-row${active ? ' is-active' : ''}">
        <div class="ignored-row-copy">
          <strong>${escapeHtml(site)}</strong>
          <span>${active ? '当前站点匹配此规则' : '忽略规则'}</span>
        </div>
        <button class="secondary ignored-remove" type="button" data-site="${escapeAttr(site)}">移除</button>
      </div>
    `
  }).join('')
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

function resetMatches() {
  matchesEl.hidden = true
  matchCountEl.hidden = true
  matchInfoEl.textContent = ''
  matchListEl.replaceChildren()
}

async function showLocked(message = '输入主密码解锁保险库。') {
  setBadge('已锁定', 'locked')
  statusEl.textContent = message
  resetMatches()
  form.hidden = false
  lockButton.hidden = true
  showPanelButton.hidden = true
  quickUnlockButton.hidden = true
  passwordInput.focus()
  const deviceState = await send({ type: 'MYPWDMG_DEVICE_UNLOCK_STATE' })
  quickUnlockButton.hidden = form.hidden || !(deviceState?.ok && deviceState?.data?.enabled)
}

function showUnlocked() {
  setBadge('已解锁', 'unlocked')
  form.hidden = true
  quickUnlockButton.hidden = true
  lockButton.hidden = false
  showPanelButton.hidden = !activeHost
}

function showUnavailable(message, state = 'error') {
  setBadge(state === 'empty' ? '未创建' : '不可用', state)
  statusEl.textContent = message
  resetMatches()
  form.hidden = true
  lockButton.hidden = true
  showPanelButton.hidden = true
}

async function unlock(password, silent = false) {
  if (!silent) {
    setBadge('解锁中', 'checking')
    statusEl.textContent = '正在解锁…'
  }

  const response = await send({ type: 'MYPWDMG_UNLOCK', password })
  passwordInput.value = ''
  if (!response?.ok) {
    if (!silent) await showLocked(response?.message || '解锁失败。')
    return false
  }

  showUnlocked()
  await refreshActiveTab()
  await loadMatches()
  return true
}

async function loadMatches() {
  resetMatches()
  if (!activeHost) {
    statusEl.textContent = '切换到网站后可查找并填充账号。'
    showPanelButton.hidden = true
    return
  }

  statusEl.textContent = '已连接本地保险库。'
  matchesEl.hidden = false
  matchInfoEl.textContent = '正在查找账号…'
  const response = await send({ type: 'MYPWDMG_QUERY_MATCHES' })
  if (!response?.ok) {
    if (response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
      await showLocked()
      return
    }
    matchInfoEl.textContent = response?.message || '无法读取当前网站账号。'
    return
  }

  const matches = Array.isArray(response.data) ? response.data : []
  if (!matches.length) {
    matchInfoEl.textContent = '当前网站暂无匹配账号。'
    return
  }
  matchCountEl.textContent = String(matches.length)
  matchCountEl.hidden = false
  matchInfoEl.textContent = ''
  matchListEl.innerHTML = matches.map(renderMatch).join('')
}

function renderMatch(entry) {
  const title = entry.title || '未命名账号'
  const label = entry.username || entry.email || entry.phone || entry.domains?.[0] || '未设置账号'
  const badges = [
    sourceLabel(entry.loginAccountSource),
    entry.hasTotp ? 'TOTP' : ''
  ].filter(Boolean)
  return `
    <div class="match-row">
      <div class="match-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
      <div class="match-meta">
        <small>${escapeHtml(badges.join(' · '))}</small>
        <button class="fill-button" type="button" data-entry-id="${escapeAttr(entry.id)}" aria-label="填充 ${escapeAttr(title)}">填充</button>
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
  resetMatches()
  setNotice()
  setBadge('检测中', 'checking')
  statusEl.textContent = '正在连接本地保险库…'

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
  statusEl.textContent = '正在检查解锁状态…'
  const unlocked = await unlock('', true)
  if (!unlocked) await showLocked()
}

async function runVaultAction(action) {
  if (refreshButton.disabled) return
  const buttons = [unlockButton, quickUnlockButton, refreshButton, lockButton]
  for (const button of buttons) button.disabled = true
  try {
    await action()
  } finally {
    for (const button of buttons) button.disabled = false
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void runVaultAction(() => unlock(passwordInput.value))
})

quickUnlockButton.addEventListener('click', () => {
  void runVaultAction(() => unlock(''))
})

lockButton.addEventListener('click', () => {
  void runVaultAction(async () => {
    setNotice()
    const response = await send({ type: 'MYPWDMG_LOCK' })
    if (!response?.ok) {
      setNotice(response?.message || '锁定失败。', true)
      return
    }
    await showLocked('保险库已锁定。')
    await refreshActiveTab()
  })
})

refreshButton.addEventListener('click', () => {
  void runVaultAction(async () => {
    await refreshActiveTab()
    await loadState()
  })
})

autoFillToggle.addEventListener('change', async () => {
  await setAutoSettings({ autoFillEnabled: autoFillToggle.checked })
})

autoSaveToggle.addEventListener('change', async () => {
  await setAutoSettings({ autoSaveEnabled: autoSaveToggle.checked })
})

toggleIgnoredSiteButton?.addEventListener('click', async () => {
  await toggleCurrentSiteIgnored()
})

ignoredSiteListEl?.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('.ignored-remove')
  if (!button) return
  await removeIgnoredSite(button.getAttribute('data-site'))
})

shortcutInput.addEventListener('focus', () => {
  shortcutInput.value = '按下组合键'
})

shortcutInput.addEventListener('blur', () => {
  shortcutInput.value = manualPanelShortcut
})

shortcutInput.addEventListener('keydown', async (event) => {
  if (!event.ctrlKey && !event.altKey && !event.metaKey && ['Tab', 'Escape'].includes(event.key)) return
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
  showPanelLabel.textContent = '正在打开…'
  const response = await sendToActiveTab({ type: 'MYPWDMG_SHOW_PANEL' })
  if (!response?.ok) {
    showPanelButton.disabled = false
    showPanelLabel.textContent = '打开网页填充面板'
    setNotice(response?.message || '无法在当前页面显示弹窗。', true)
    return
  }
  window.close()
})

matchListEl.addEventListener('click', async (event) => {
  if (!event.isTrusted) return
  const button = event.target?.closest?.('.fill-button')
  if (!button) return
  button.disabled = true
  button.textContent = '...'
  const response = await sendToActiveTab({ type: 'MYPWDMG_FILL_ENTRY', entryId: button.getAttribute('data-entry-id'), manual: true })
  if (!response?.ok) {
    button.disabled = false
    button.textContent = '填充'
    setNotice(response?.message || '无法向当前页面填充。', true)
    return
  }
  window.close()
})
appearanceButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage().catch(() => setNotice('无法打开外观设置。', true))
})

void appearance.refresh().catch(() => {})
void runVaultAction(loadState)
