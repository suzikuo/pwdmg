const statusEl = document.getElementById('status')
const form = document.getElementById('unlockForm')
const passwordInput = document.getElementById('password')
const lockButton = document.getElementById('lockButton')

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve))
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'MYPWDMG_REFRESH' }).catch(() => {})
}

function setUnlocked() {
  statusEl.textContent = '插件已解锁，可以回到网页登录框选择账号。'
  form.style.display = 'none'
  lockButton.style.display = 'block'
}

function setLocked(message = '插件未解锁。') {
  statusEl.textContent = message
  form.style.display = 'grid'
  lockButton.style.display = 'none'
  passwordInput.focus()
}

async function unlock(password, silent = false) {
  if (!silent) statusEl.textContent = '正在解锁...'
  const response = await send({ type: 'MYPWDMG_UNLOCK', password })
  passwordInput.value = ''
  if (!response?.ok) {
    if (!silent) setLocked(response?.message || '解锁失败。')
    return false
  }
  setUnlocked()
  refreshActiveTab()
  return true
}

async function loadState() {
  form.style.display = 'none'
  lockButton.style.display = 'none'

  const response = await send({ type: 'MYPWDMG_STATE' })
  if (!response?.ok) {
    statusEl.textContent = response?.message || '无法连接本地 Native Host。'
    return
  }

  const state = response.data
  if (!state.hasVault) {
    statusEl.textContent = '还没有保险库，请先打开桌面端创建。'
    return
  }

  if (!state.locked) {
    setUnlocked()
    return
  }

  statusEl.textContent = '正在尝试空密码解锁...'
  const unlocked = await unlock('', true)
  if (!unlocked) setLocked('请输入主密码解锁插件。')
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  await unlock(passwordInput.value, false)
})

lockButton.addEventListener('click', async () => {
  statusEl.textContent = '正在锁定...'
  await send({ type: 'MYPWDMG_LOCK' })
  setLocked('插件已锁定。')
  refreshActiveTab()
})

loadState()
