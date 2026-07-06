const statusEl = document.getElementById('status')
const matchInfoEl = document.getElementById('matchInfo')
const siteHostEl = document.getElementById('siteHost')
const stateBadgeEl = document.getElementById('stateBadge')
const form = document.getElementById('unlockForm')
const passwordInput = document.getElementById('password')
const lockButton = document.getElementById('lockButton')
const refreshButton = document.getElementById('refreshButton')
const matchListEl = document.getElementById('matchList')

let activeTab = null
let activeHost = ''

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
      resolve(error ? { ok: false, message: String(error.message || error) } : (response || { ok: true }))
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

function setBadge(text, state) {
  stateBadgeEl.textContent = text
  stateBadgeEl.dataset.state = state
}

function showLocked(message = '请输入主密码解锁插件。') {
  setBadge('已锁定', 'locked')
  statusEl.textContent = message
  matchInfoEl.textContent = ''
  matchListEl.innerHTML = ''
  form.hidden = false
  lockButton.hidden = true
  window.setTimeout(() => passwordInput.focus(), 20)
}

function showUnlocked() {
  setBadge('已解锁', 'unlocked')
  form.hidden = true
  lockButton.hidden = false
}

function showUnavailable(message, state = 'error') {
  setBadge(state === 'empty' ? '未创建' : '不可用', state)
  statusEl.textContent = message
  matchInfoEl.textContent = ''
  matchListEl.innerHTML = ''
  form.hidden = true
  lockButton.hidden = true
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
    return
  }

  statusEl.textContent = '已连接本地保险库。'
  matchInfoEl.textContent = '正在查询当前站点...'
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
  matchListEl.innerHTML = ''
  setBadge('检测中', 'checking')

  await getActiveTab()
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

matchListEl.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('.fill-button')
  if (!button) return
  button.disabled = true
  button.textContent = '...'
  const response = await sendToActiveTab({ type: 'MYPWDMG_FILL_ENTRY', entryId: button.getAttribute('data-entry-id') })
  if (!response?.ok) {
    button.disabled = false
    button.textContent = '填充'
    statusEl.textContent = response?.message || '无法向当前页面填充。'
    return
  }
  window.close()
})

loadState()
