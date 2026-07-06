const ROOT_ID = 'mypwdmg-autofill-root'
const FIELD_ID_ATTR = 'data-mypwdmg-field-id'
const QUERY_DEBOUNCE_MS = 300
const MUTATION_DEBOUNCE_MS = 900
const SAVE_PROMPT_DELAY_MS = 900
const CAPTURE_CLICK_WINDOW_MS = 800
const INPUT_SELECTOR = 'input, textarea'

const USER_RE = /(user|login|email|mail|account|phone|mobile|tel|\u7528\u6237\u540d|\u8d26\u53f7|\u8d26\u6237|\u90ae\u7bb1|\u624b\u673a)/i
const EMAIL_RE = /(email|e-mail|mail|\u90ae\u7bb1)/i
const PHONE_RE = /(phone|mobile|tel|\u624b\u673a)/i
const USERNAME_RE = /(user|username|userid|\u7528\u6237\u540d)/i
const PASSWORD_RE = /(password|passwd|pwd|pass|\u5bc6\u7801)/i
const OTP_RE = /(otp|totp|2fa|mfa|code|verification|verify|auth|token|\u9a8c\u8bc1\u7801|\u52a8\u6001|\u4e8c\u6b21|\u5b89\u5168\u7801)/i

let fieldSeq = 1
let lastMatches = []
let lastQueryKey = ''
let queryTimer = 0
let panelPinned = false
let panelDrag = null
let lastSubmitCapture = null
let savePromptTimer = 0
let pendingSave = null
let lastOtpAutoFillKey = ''

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

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve))
}

function fieldId(input) {
  if (!input) return ''
  if (!input.getAttribute(FIELD_ID_ATTR)) {
    input.setAttribute(FIELD_ID_ATTR, `mypwdmg-field-${fieldSeq++}`)
  }
  return input.getAttribute(FIELD_ID_ATTR)
}

function isVisible(element) {
  if (!element || element.disabled || element.readOnly) return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function fieldText(input) {
  return [
    input.name,
    input.id,
    input.autocomplete,
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('aria-labelledby'),
    input.getAttribute('title')
  ]
    .join(' ')
    .toLowerCase()
}

function allInputs(scope = document) {
  return Array.from(scope.querySelectorAll(INPUT_SELECTOR)).filter(isVisible)
}

function inputType(input) {
  return (input.getAttribute('type') || 'text').toLowerCase()
}

function isPasswordInput(input) {
  const type = inputType(input)
  return type === 'password' || PASSWORD_RE.test(fieldText(input))
}

function isOtpInput(input) {
  const text = fieldText(input)
  const maxLength = Number(input.getAttribute('maxlength') || 0)
  return OTP_RE.test(text) || (maxLength >= 4 && maxLength <= 8 && /code|one-time-code/i.test(text))
}

function isUsernameInput(input) {
  const type = inputType(input)
  if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(type)) return false
  return ['text', 'email', 'tel', 'number', 'search', 'url'].includes(type) || USER_RE.test(fieldText(input))
}

function accountFieldKind(input) {
  if (!input) return 'generic'
  const type = inputType(input)
  const text = fieldText(input)
  const autocomplete = String(input.autocomplete || '').toLowerCase()
  if (type === 'email' || /\bemail\b/.test(autocomplete)) return 'email'
  if (type === 'tel' || /\b(tel|phone|mobile)\b/.test(autocomplete)) return 'phone'
  if (/\b(username|userid)\b/.test(autocomplete)) return 'username'

  const hasEmail = EMAIL_RE.test(text)
  const hasPhone = PHONE_RE.test(text)
  const hasUsername = USERNAME_RE.test(text)
  const hasChoiceText = /(^|[\s_/-])(or|and)([\s_/-]|$)|[\/|,\uFF0C\u3001]|\u6216|\u6216\u8005/.test(text)
  if (hasEmail && !hasPhone && !(hasUsername && hasChoiceText)) return 'email'
  if (hasPhone && !hasEmail && !(hasUsername && hasChoiceText)) return 'phone'
  if (hasUsername && !hasEmail && !hasPhone) return 'username'
  return 'generic'
}

function documentOrderBefore(left, right) {
  if (!left || !right || left === right) return false
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function findUsernameInput(passwordInput, scope) {
  const candidates = allInputs(scope).filter((input) => input !== passwordInput && isUsernameInput(input))
  if (!candidates.length) return null

  const autocompleteMatch = candidates.find((input) => /username|email|tel/i.test(input.autocomplete || ''))
  if (autocompleteMatch) return autocompleteMatch

  const beforePassword = candidates.filter((input) => documentOrderBefore(input, passwordInput))
  return beforePassword.at(-1) || candidates[0] || null
}

function detectLoginFields() {
  const inputs = allInputs()
  const passwordInput = inputs.find(isPasswordInput)
  if (!passwordInput) {
    const otpInput = inputs.find(isOtpInput)
    if (!otpInput) return null
    return {
      usernameInput: null,
      usernameKind: 'generic',
      passwordInput: null,
      otpInput,
      otpOnly: true,
      anchor: otpInput
    }
  }

  const form = passwordInput.closest('form') || document
  const usernameInput = findUsernameInput(passwordInput, form) || findUsernameInput(passwordInput, document)
  const otpInput =
    allInputs(form).find((input) => input !== usernameInput && input !== passwordInput && isOtpInput(input)) ||
    inputs.find((input) => input !== usernameInput && input !== passwordInput && isOtpInput(input))

  return {
    usernameInput,
    usernameKind: accountFieldKind(usernameInput),
    passwordInput,
    otpInput,
    otpOnly: false,
    anchor: passwordInput || usernameInput || otpInput
  }
}

function ensureRoot() {
  let root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = ROOT_ID
    document.documentElement.appendChild(root)
  }
  return root
}

function removeRoot() {
  document.getElementById(ROOT_ID)?.remove()
}

function positionRoot(anchor) {
  const root = ensureRoot()
  if (panelPinned) {
    clampPanelPosition()
    return
  }

  const rect = anchor?.getBoundingClientRect()
  if (!rect) {
    root.style.removeProperty('--mypwdmg-top')
    root.style.removeProperty('--mypwdmg-right')
    return
  }

  const panelWidth = Math.min(286, window.innerWidth - 24)
  const top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - 280))
  const anchorRight = window.innerWidth - Math.min(window.innerWidth - 12, rect.right) - 4
  const maxRight = Math.max(12, window.innerWidth - panelWidth - 12)
  const right = Math.max(12, Math.min(anchorRight, maxRight))
  root.style.setProperty('--mypwdmg-top', `${Math.round(top)}px`)
  root.style.setProperty('--mypwdmg-right', `${Math.round(right)}px`)
}

function setPanelPosition(top, right) {
  const panel = document.querySelector(`#${ROOT_ID} .mypwdmg-panel`)
  const panelWidth = panel?.getBoundingClientRect().width || 286
  const panelHeight = panel?.getBoundingClientRect().height || 220
  const nextTop = Math.max(8, Math.min(top, window.innerHeight - Math.min(panelHeight, window.innerHeight - 16) - 8))
  const nextRight = Math.max(8, Math.min(right, window.innerWidth - Math.min(panelWidth, window.innerWidth - 16) - 8))
  const root = ensureRoot()
  root.style.setProperty('--mypwdmg-top', `${Math.round(nextTop)}px`)
  root.style.setProperty('--mypwdmg-right', `${Math.round(nextRight)}px`)
}

function clampPanelPosition() {
  const root = ensureRoot()
  const top = Number.parseFloat(root.style.getPropertyValue('--mypwdmg-top')) || 76
  const right = Number.parseFloat(root.style.getPropertyValue('--mypwdmg-right')) || 16
  setPanelPosition(top, right)
}

function startPanelDrag(event) {
  if (event.button !== 0 || event.target?.closest?.('.mypwdmg-close')) return
  const root = ensureRoot()
  const panel = root.querySelector('.mypwdmg-panel')
  const rect = panel?.getBoundingClientRect()
  if (!rect) return

  panelPinned = true
  panelDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startTop: rect.top,
    startRight: window.innerWidth - rect.right
  }
  panel?.classList.add('is-dragging')
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  window.addEventListener('pointermove', dragPanel)
  window.addEventListener('pointerup', stopPanelDrag, { once: true })
}

function dragPanel(event) {
  if (!panelDrag || event.pointerId !== panelDrag.pointerId) return
  const nextTop = panelDrag.startTop + event.clientY - panelDrag.startY
  const nextRight = panelDrag.startRight - (event.clientX - panelDrag.startX)
  setPanelPosition(nextTop, nextRight)
}

function stopPanelDrag(event) {
  if (panelDrag && event.pointerId === panelDrag.pointerId) {
    document.querySelector(`#${ROOT_ID} .mypwdmg-panel`)?.classList.remove('is-dragging')
    panelDrag = null
  }
  window.removeEventListener('pointermove', dragPanel)
}

function renderPanel(matches, statusText = '', anchor = null) {
  if (!matches.length && !statusText) {
    removeRoot()
    return
  }

  positionRoot(anchor)
  const root = ensureRoot()
  root.innerHTML = `
    <div class="mypwdmg-panel" role="dialog" aria-label="My Password 自动填充">
      <div class="mypwdmg-title">
        <div class="mypwdmg-title-text">
          <span>My Password</span>
          <small>${escapeHtml(statusText ? '状态' : `${matches.length} 个匹配账号`)}</small>
        </div>
        <button class="mypwdmg-close" type="button" title="关闭" aria-label="关闭">&times;</button>
      </div>
      ${
        statusText
          ? `<div class="mypwdmg-status"><span class="mypwdmg-status-dot"></span><span>${escapeHtml(statusText)}</span></div>`
          : `
            <div class="mypwdmg-list" role="list">
              ${matches.map((entry) => renderEntryButton(entry)).join('')}
            </div>
          `
      }
    </div>
  `

  root.querySelector('.mypwdmg-close')?.addEventListener('click', removeRoot)
  root.querySelector('.mypwdmg-title')?.addEventListener('pointerdown', startPanelDrag)
  root.querySelectorAll('.mypwdmg-entry').forEach((button) => {
    button.addEventListener('click', () => fillEntry(button.getAttribute('data-entry-id')))
  })
}

function renderEntryButton(entry) {
  const label = accountLabel(entry)
  const domain = entry.domains?.[0] || ''
  return `
    <button class="mypwdmg-entry" type="button" data-entry-id="${escapeAttr(entry.id)}" role="listitem">
      <span class="mypwdmg-entry-main">
        <span class="mypwdmg-entry-head">
          <strong>${escapeHtml(entry.title || 'Untitled')}</strong>
          ${entry.hasTotp ? '<span class="mypwdmg-badge">TOTP</span>' : ''}
        </span>
        <small>${escapeHtml(label || domain || '未设置账号')}</small>
      </span>
      <span class="mypwdmg-entry-side">
        <span class="mypwdmg-account-kind">${escapeHtml(sourceLabel(entry.loginAccountSource))}</span>
        <span class="mypwdmg-chevron">›</span>
      </span>
    </button>
  `
}

function accountLabel(entry) {
  return entry.username || entry.email || entry.phone || ''
}

function sourceLabel(source) {
  if (source === 'email') return '邮箱'
  if (source === 'phone') return '手机'
  if (source === 'username') return '账号'
  return '自动'
}

function renderSavePrompt(preview) {
  pendingSave = preview
  panelPinned = false
  const root = ensureRoot()
  positionRoot(preview.anchor || document.activeElement)
  const folders = Array.isArray(preview.folders) ? preview.folders : []
  const update = preview.updateCandidate
  root.innerHTML = `
    <div class="mypwdmg-panel mypwdmg-save-panel" role="dialog" aria-label="保存到 My Password">
      <div class="mypwdmg-title">
        <div class="mypwdmg-title-text">
          <span>${escapeHtml(update ? '更新 My Password' : '保存到 My Password')}</span>
          <small>${escapeHtml(preview.hostname || '当前网站')}</small>
        </div>
        <button class="mypwdmg-close" type="button" title="关闭" aria-label="关闭">&times;</button>
      </div>
      <div class="mypwdmg-save-body">
        <div class="mypwdmg-save-summary">
          <strong>${escapeHtml(preview.title || preview.hostname || 'Untitled')}</strong>
          <small>${escapeHtml(preview.accountLabel || '未识别账号')}</small>
        </div>
        ${
          update
            ? `<div class="mypwdmg-save-note">更新现有条目：${escapeHtml(update.title || 'Untitled')}${update.path ? ` · ${escapeHtml(update.path)}` : ''}</div>`
            : `
              <label class="mypwdmg-save-label" for="mypwdmg-save-folder">保存位置</label>
              <select id="mypwdmg-save-folder" class="mypwdmg-save-select">
                ${folders
                  .map((folder) => `<option value="${escapeAttr(folder.id || '')}">${escapeHtml(folder.path || folder.title || '根目录')}</option>`)
                  .join('')}
              </select>
            `
        }
        <div class="mypwdmg-save-actions">
          <button class="mypwdmg-save-secondary" type="button" data-action="dismiss">忽略</button>
          <button class="mypwdmg-save-primary" type="button" data-action="save">${escapeHtml(update ? '更新' : '保存')}</button>
        </div>
      </div>
    </div>
  `

  root.querySelector('.mypwdmg-close')?.addEventListener('click', dismissSavePrompt)
  root.querySelector('[data-action="dismiss"]')?.addEventListener('click', dismissSavePrompt)
  root.querySelector('[data-action="save"]')?.addEventListener('click', savePendingCapture)
  root.querySelector('.mypwdmg-title')?.addEventListener('pointerdown', startPanelDrag)
}

function dismissSavePrompt() {
  if (pendingSave?.token) {
    sendMessage({ type: 'MYPWDMG_DISMISS_CAPTURE', token: pendingSave.token }).catch(() => {})
  }
  pendingSave = null
  removeRoot()
}

async function savePendingCapture() {
  if (!pendingSave?.token) return
  const root = ensureRoot()
  const button = root.querySelector('[data-action="save"]')
  const folderSelect = root.querySelector('#mypwdmg-save-folder')
  button?.setAttribute('disabled', 'true')
  const response = await sendMessage({
    type: 'MYPWDMG_SAVE_CAPTURE',
    token: pendingSave.token,
    parentId: pendingSave.updateCandidate ? '' : folderSelect?.value || '',
    updateEntryId: pendingSave.updateCandidate?.id || ''
  })
  if (!response?.ok) {
    renderPanel([], response?.message || '保存失败。', pendingSave.anchor || document.activeElement)
    return
  }
  renderPanel([], response.data?.action === 'updated' ? '已更新 My Password。' : '已保存到 My Password。', pendingSave.anchor || document.activeElement)
  pendingSave = null
  window.setTimeout(removeRoot, 1600)
}

function scheduleQuery(force = false, delay = QUERY_DEBOUNCE_MS) {
  window.clearTimeout(queryTimer)
  queryTimer = window.setTimeout(() => queryMatches(force), delay)
}

async function queryMatches(force = false) {
  const fields = detectLoginFields()
  if (!fields) {
    removeRoot()
    return
  }

  const key = [location.hostname, fieldId(fields.usernameInput), fields.usernameKind, fieldId(fields.passwordInput), fieldId(fields.otpInput)].join('|')
  if (!force && key === lastQueryKey) return
  lastQueryKey = key

  const response = await sendMessage({
    type: 'MYPWDMG_QUERY_MATCHES',
    hostname: location.hostname
  })

  if (!response?.ok) {
    lastMatches = []
    if (response?.code === 'PLUGIN_DISABLED' || response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
      removeRoot()
      return
    }
    removeRoot()
    return
  }

  lastMatches = response.data || []
  if (fields.otpOnly && fields.otpInput) {
    const totpMatches = lastMatches.filter((entry) => entry.hasTotp)
    if (totpMatches.length === 1) {
      const autoFillKey = [location.hostname, fieldId(fields.otpInput), totpMatches[0].id].join('|')
      if (autoFillKey !== lastOtpAutoFillKey) {
        lastOtpAutoFillKey = autoFillKey
        await fillEntry(totpMatches[0].id)
        return
      }
    }
  }
  renderPanel(lastMatches, '', fields.anchor)
}

async function fillEntry(entryId) {
  if (!entryId) return
  const response = await sendMessage({ type: 'MYPWDMG_GET_FILL', entryId })
  if (!response?.ok || !response.data) {
    const fields = detectLoginFields()
    if (response?.code === 'PLUGIN_DISABLED' || response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
      removeRoot()
      return
    }
    renderPanel(lastMatches, response?.message || 'Failed to read entry.', fields?.anchor)
    return
  }
  applyFill(response.data)
  removeRoot()
}

function applyFill(payload) {
  const fields = detectLoginFields()
  if (!fields) return

  setInputValue(fields.usernameInput, resolveAccountValue(payload, fields.usernameKind))
  setInputValue(fields.passwordInput, payload.password || '')
  if (fields.otpInput && payload.totp) setInputValue(fields.otpInput, payload.totp)
}

function resolveAccountValue(payload, fieldKind = 'generic') {
  const fallback = firstNotEmpty(payload.username, payload.email, payload.phone)
  if (fieldKind === 'email') return payload.email || fallback
  if (fieldKind === 'phone') return payload.phone || fallback
  if (fieldKind === 'username') return payload.username || fallback

  if (payload.loginAccountSource === 'email') return payload.email || fallback
  if (payload.loginAccountSource === 'phone') return payload.phone || fallback
  if (payload.loginAccountSource === 'username') return payload.username || fallback
  return fallback
}

function firstNotEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value) !== '') || ''
}

function setInputValue(input, value) {
  if (!input || value === undefined || value === null || value === '') return
  input.focus({ preventScroll: true })
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertReplacementText' }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function captureLoginFromScope(scope = document, anchor = null) {
  const fields = detectLoginFieldsInScope(scope)
  if (!fields?.passwordInput) return null
  const password = String(fields.passwordInput.value || '')
  if (!password) return null

  const account = String(fields.usernameInput?.value || '').trim()
  const accountKind = fields.usernameKind || accountFieldKind(fields.usernameInput)
  const capture = {
    hostname: location.hostname,
    title: document.title || location.hostname,
    account,
    accountKind,
    username: accountKind === 'username' ? account : '',
    email: accountKind === 'email' ? account : '',
    phone: accountKind === 'phone' ? account : '',
    password
  }
  return { capture, anchor: anchor || fields.passwordInput || fields.usernameInput }
}

function detectLoginFieldsInScope(scope = document) {
  const inputs = allInputs(scope)
  const passwordInputs = inputs.filter(isPasswordInput)
  if (!passwordInputs.length) return null
  const passwordInput = passwordInputs.at(-1)
  const usernameInput = findUsernameInput(passwordInput, scope) || findUsernameInput(passwordInput, document)
  return {
    usernameInput,
    usernameKind: accountFieldKind(usernameInput),
    passwordInput
  }
}

function scheduleSaveCapture(captureInfo) {
  if (!captureInfo?.capture?.password) return
  lastSubmitCapture = { ...captureInfo, at: Date.now() }
  window.clearTimeout(savePromptTimer)
  savePromptTimer = window.setTimeout(() => prepareSavePrompt(captureInfo), SAVE_PROMPT_DELAY_MS)
}

async function prepareSavePrompt(captureInfo) {
  if (!captureInfo?.capture?.password) return
  const response = await sendMessage({
    type: 'MYPWDMG_PREPARE_CAPTURE',
    capture: captureInfo.capture
  })
  if (!response?.ok || !response.data?.shouldPrompt || !response.data?.token) return
  renderSavePrompt({
    ...response.data,
    anchor: captureInfo.anchor
  })
}

async function takePreparedSavePrompt() {
  const response = await sendMessage({
    type: 'MYPWDMG_TAKE_SAVE_PROMPT',
    hostname: location.hostname
  })
  if (!response?.ok || !response.data?.token) return
  renderSavePrompt({
    ...response.data,
    anchor: document.activeElement
  })
}

function handleSubmitCapture(event) {
  const form = event.target?.closest?.('form') || event.target
  scheduleSaveCapture(captureLoginFromScope(form, event.target))
}

function handleClickCapture(event) {
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('button, input[type="submit"], input[type="button"], [role="button"]')) return
  const text = [
    target.textContent,
    target.getAttribute?.('aria-label'),
    target.getAttribute?.('title'),
    target.getAttribute?.('value')
  ]
    .join(' ')
    .toLowerCase()
  if (!/(login|log in|sign in|signin|sign up|signup|register|create account|submit|continue|登录|登陆|注册|提交|继续|创建)/i.test(text)) return

  const form = target.closest('form') || document
  const captureInfo = captureLoginFromScope(form, target)
  if (!captureInfo) return
  window.setTimeout(() => {
    if (lastSubmitCapture && Date.now() - lastSubmitCapture.at <= CAPTURE_CLICK_WINDOW_MS) return
    scheduleSaveCapture({ ...captureInfo, at: Date.now() })
  }, 0)
}

function nodeHasInput(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  return node.matches?.(INPUT_SELECTOR) || Boolean(node.querySelector?.(INPUT_SELECTOR))
}

function mutationMayAffectLoginFields(mutation) {
  if (mutation.target?.id === ROOT_ID || mutation.target?.closest?.(`#${ROOT_ID}`)) return false
  if (mutation.type === 'attributes') return nodeHasInput(mutation.target)
  if (mutation.type !== 'childList') return false
  return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeHasInput)
}

const observer = new MutationObserver((mutations) => {
  if (mutations.some(mutationMayAffectLoginFields)) scheduleQuery(false, MUTATION_DEBOUNCE_MS)
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'MYPWDMG_REFRESH') {
    lastQueryKey = ''
    queryMatches(true)
  }
})

document.addEventListener('focusin', () => scheduleQuery(false), true)
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (!document.getElementById(ROOT_ID)) return
  if (pendingSave?.token) {
    dismissSavePrompt()
    return
  }
  removeRoot()
}, true)
document.addEventListener('submit', handleSubmitCapture, true)
document.addEventListener('click', handleClickCapture, true)
window.addEventListener('pageshow', () => scheduleQuery(true))
window.addEventListener('resize', () => {
  if (panelPinned) clampPanelPosition()
  else scheduleQuery(true)
})
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['type', 'name', 'id', 'autocomplete', 'placeholder', 'aria-label', 'style', 'class', 'disabled', 'readonly']
})
scheduleQuery(true)
takePreparedSavePrompt()
