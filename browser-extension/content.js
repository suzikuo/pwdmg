if (!window.__mypwdmgContentScriptLoaded) {
  window.__mypwdmgContentScriptLoaded = true
  const Security = globalThis.MyPwdMgSecurity
  const ROOT_ID = 'mypwdmg-autofill-root'
  const FIELD_ID_ATTR = 'data-mypwdmg-field-id'
  const QUERY_DEBOUNCE_MS = 300
  const MUTATION_DEBOUNCE_MS = 900
  const SAVE_PROMPT_CAPTURE_DELAY_MS = 2500
  const SAVE_PROMPT_RESTORE_DELAY_MS = 700
  const CAPTURE_CLICK_WINDOW_MS = 800
  const RECENT_INPUT_CAPTURE_TTL_MS = 15000
  const FILL_CAPTURE_SUPPRESS_MS = 2500
  const INPUT_SELECTOR = 'input, textarea'
  const ACTION_CONTROL_SELECTOR = 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]'
  const SUBMIT_ACTION_RE = /(login|log in|sign in|signin|sign up|signup|register|create account|submit|continue|登录|登陆|注册|提交|继续|创建)/i
  const SHOW_PANEL_SHORTCUT = 'Alt+T'

  const USER_RE = /(user|login|email|mail|account|phone|mobile|tel|\u7528\u6237\u540d|\u8d26\u53f7|\u8d26\u6237|\u90ae\u7bb1|\u624b\u673a)/i
  const EMAIL_RE = /(email|e-mail|mail|\u90ae\u7bb1)/i
  const PHONE_RE = /(phone|mobile|tel|\u624b\u673a)/i
  const USERNAME_RE = /(user|username|userid|\u7528\u6237\u540d)/i
  const PASSWORD_RE = /(^|[^a-z0-9])(password|passwd|pwd|passphrase|pass[\s_-]*phrase|pass)(?=$|[^a-z0-9])|\u5bc6\u7801/i
  const NON_LOGIN_SECRET_RE = /(\bapi[-_\s]*key\b|\bapi[-_\s]*secret\b|\baccess[-_\s]*key\b|\bsecret[-_\s]*key\b|\bkey[-_\s]*secret\b|\bclient[-_\s]*secret\b|\bpersonal[-_\s]*access[-_\s]*token\b|\baccess[-_\s]*token\b|\brefresh[-_\s]*token\b|\bbearer\b|\bprivate[-_\s]*key\b|\bpublic[-_\s]*key\b|\bwebhook\b|\bbase[-_\s]*url\b|\bendpoint\b|\bopenai\b|\banthropic\b|\bgemini\b|\bmodel\b|\u63a5\u53e3|\u5bc6\u94a5|\u4ee4\u724c|\u6a21\u578b)/i
  const MANUAL_SECRET_FIELD_RE = /(\bapi[-_\s]*key\b|\bapi[-_\s]*secret\b|\baccess[-_\s]*key\b|\bsecret[-_\s]*key\b|\bkey[-_\s]*secret\b|\bclient[-_\s]*secret\b|\bpersonal[-_\s]*access[-_\s]*token\b|\baccess[-_\s]*token\b|\brefresh[-_\s]*token\b|\bprivate[-_\s]*key\b|\bbearer[-_\s]*token\b|\u5bc6\u94a5|\u4ee4\u724c)/i
  const LOGIN_SCOPE_RE = /(login|log in|sign in|signin|sign up|signup|register|create account|username|email|password|\u767b\u5f55|\u767b\u9646|\u6ce8\u518c|\u7528\u6237\u540d|\u8d26\u53f7|\u90ae\u7bb1|\u5bc6\u7801)/i
  const MODAL_SCOPE_SELECTOR = 'form, dialog, [role="dialog"], [aria-modal="true"], .modal, .dialog, .popup, .drawer, .sheet, [class*="modal"], [class*="dialog"], [class*="popup"], [class*="drawer"], [class*="sheet"]'

  let fieldSeq = 1
  let lastMatches = []
  let lastQueryKey = ''
  let queryTimer = 0
  let panelPinned = false
  let panelDrag = null
  let lastSubmitCapture = null
  let lastInputCapture = null
  let savePromptTimer = 0
  let pendingSave = null
  let extensionContextInvalidated = false
  let suppressCaptureUntil = 0
  let panelManualMode = false
  let lastManualFields = null
  let contextMenuInput = null
  let contextMenuInputAt = 0
  let autoFillEnabled = true
  let autoSaveEnabled = true
  let ignoredSites = []
  let manualPanelShortcut = parseShortcut(SHOW_PANEL_SHORTCUT)
  const completedSaveTokens = new Set()
  const extensionFilledPasswords = new Map()
  let rootHost = null
  let rootView = null
  let entryButtonIds = new WeakMap()

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
    if (extensionContextInvalidated) {
      return Promise.resolve({ ok: false, code: 'EXTENSION_CONTEXT_INVALIDATED', message: 'Extension context invalidated.' })
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError
          if (error) {
            const messageText = String(error.message || error)
            if (/context invalidated|extension context/i.test(messageText)) {
              extensionContextInvalidated = true
            }
            resolve({ ok: false, code: 'EXTENSION_MESSAGE_ERROR', message: messageText })
            return
          }
          resolve(response)
        })
      } catch (error) {
        const messageText = String(error?.message || error)
        if (/context invalidated|extension context/i.test(messageText)) {
          extensionContextInvalidated = true
        }
        resolve({ ok: false, code: 'EXTENSION_MESSAGE_ERROR', message: messageText })
      }
    })
  }

  function parseShortcut(value) {
    const parts = String(value || SHOW_PANEL_SHORTCUT).split('+').map((part) => part.trim()).filter(Boolean)
    const shortcut = {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      code: ''
    }
    for (const part of parts) {
      const lower = part.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') shortcut.ctrlKey = true
      else if (lower === 'alt' || lower === 'option') shortcut.altKey = true
      else if (lower === 'shift') shortcut.shiftKey = true
      else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') shortcut.metaKey = true
      else shortcut.code = shortcutCode(part)
    }
    if (!shortcut.code || (!shortcut.ctrlKey && !shortcut.altKey && !shortcut.metaKey)) {
      return parseShortcut(SHOW_PANEL_SHORTCUT)
    }
    return shortcut
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

  function findMatchingIgnoredSite(hostname = location.hostname) {
    const host = normalizeHost(hostname)
    if (!host) return ''
    const exact = ignoredSites.find((site) => site === host)
    if (exact) return exact
    return ignoredSites.find((site) => hostMatchesIgnore(host, site)) || ''
  }

  function isCurrentSiteIgnored(hostname = location.hostname) {
    return Boolean(findMatchingIgnoredSite(hostname))
  }

  function shortcutCode(value) {
    const key = String(value || '').trim()
    if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
    if (/^[0-9]$/.test(key)) return `Digit${key}`
    if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase()
    const aliases = {
      Space: 'Space',
      Escape: 'Escape',
      Esc: 'Escape',
      Enter: 'Enter',
      Return: 'Enter',
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
    return aliases[key] || ''
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
    const labelText = Array.from(input.labels || []).map((label) => label.textContent)
    const labelledByText = String(input.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
    return [
      input.name,
      input.id,
      input.autocomplete,
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('aria-labelledby'),
      input.getAttribute('title'),
      ...labelText,
      ...labelledByText
    ]
      .join(' ')
      .toLowerCase()
  }

  function fieldContextText(input) {
    const parts = [fieldText(input)]
    let node = input.parentElement
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
      const text = compactText(node.textContent)
      if (text && text.length <= 220) parts.push(text)
    }
    const previous = input.previousElementSibling
    const next = input.nextElementSibling
    if (previous) parts.push(compactText(previous.textContent))
    if (next) parts.push(compactText(next.textContent))
    return parts.join(' ').toLowerCase()
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function allInputs(scope = document) {
    return Array.from(scope.querySelectorAll(INPUT_SELECTOR)).filter(isVisible)
  }

  function inputType(input) {
    return (input.getAttribute('type') || 'text').toLowerCase()
  }

  function fieldSignal(input) {
    return {
      type: inputType(input),
      text: fieldText(input),
      autocomplete: input.getAttribute('autocomplete') || '',
      inputMode: input.getAttribute('inputmode') || '',
      pattern: input.getAttribute('pattern') || '',
      maxLength: Number(input.getAttribute('maxlength') || 0)
    }
  }

  function isPasswordInput(input) {
    if (isNonLoginSecretInput(input)) return false
    return Security.passwordEvidence(fieldSignal(input)) === 'strong'
  }

  function isManualPasswordInput(input) {
    return Security.passwordEvidence(fieldSignal(input)) === 'strong'
      || MANUAL_SECRET_FIELD_RE.test(fieldContextText(input))
  }

  function isOtpInput(input) {
    if (isNonLoginSecretInput(input)) return false
    return Security.otpEvidence(fieldSignal(input)) !== 'none'
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

  function isNonLoginSecretInput(input) {
    const type = inputType(input)
    const text = fieldContextText(input)
    if (!text || !NON_LOGIN_SECRET_RE.test(text)) return false
    const signal = fieldSignal(input)
    if (PASSWORD_RE.test(fieldText(input)) || /(^|\s)(current-password|new-password)(?=\s|$)/i.test(signal.autocomplete)) return false
    if (Security.otpEvidence(signal) === 'strong' && !/(api|access|secret|key|\u5bc6\u94a5|\u63a5\u53e3)/i.test(text)) return false
    return type === 'password' || PASSWORD_RE.test(text) || /(key|token|secret|\u5bc6\u94a5|\u4ee4\u724c)/i.test(text)
  }

  function isManualSecretInput(input) {
    return Boolean(input && MANUAL_SECRET_FIELD_RE.test(fieldContextText(input)) && !PASSWORD_RE.test(fieldText(input)))
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

  function activeInput() {
    const active = document.activeElement
    if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) return null
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image'].includes(inputType(active))) return null
    return isVisible(active) ? active : null
  }

  function usableInput(input) {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return null
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image'].includes(inputType(input))) return null
    return isVisible(input) ? input : null
  }

  function inputFromEventTarget(target) {
    if (!(target instanceof Element)) return null
    return usableInput(target.closest(INPUT_SELECTOR))
  }

  function manualAnchorInput(source = '') {
    const now = Date.now()
    if (source === 'contextMenu' && contextMenuInput && now - contextMenuInputAt < 5000) {
      const target = usableInput(contextMenuInput)
      if (target) return target
    }
    return activeInput()
  }

  function scopeForFocusedInput(input) {
    if (!input) return null
    const explicitScope = input.closest(MODAL_SCOPE_SELECTOR)
    if (explicitScope) return explicitScope

    let node = input.parentElement
    for (let depth = 0; node && node !== document.documentElement && depth < 6; depth += 1, node = node.parentElement) {
      const visibleInputs = allInputs(node)
      const text = compactText(node.textContent)
      if (visibleInputs.length >= 2 && text.length <= 1200) return node
    }
    return null
  }

  function fieldsContainInput(fields, input) {
    if (!fields || !input) return false
    return fields.usernameInput === input || fields.passwordInput === input || fields.otpInput === input
  }

  function scopeText(scope) {
    if (!scope || scope === document) return ''
    return compactText(scope.textContent).toLowerCase()
  }

  function scopeLooksLikeNonLoginSecretEditor(scope) {
    const text = scopeText(scope)
    if (!text || !NON_LOGIN_SECRET_RE.test(text)) return false
    return !LOGIN_SCOPE_RE.test(text) || !SUBMIT_ACTION_RE.test(text)
  }

  function detectLoginFields(scope = document) {
    const focused = activeInput()
    const focusedScope = scope === document ? scopeForFocusedInput(focused) : null
    if (focusedScope) {
      const scopedFields = detectLoginFields(focusedScope)
      if (!scopedFields) return null
      if (!fieldsContainInput(scopedFields, focused) && !focused.closest('form')) return null
      return scopedFields
    }

    const inputs = allInputs(scope)
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

    if (scopeLooksLikeNonLoginSecretEditor(scope)) return null

    const form = passwordInput.closest('form') || (scope === document ? document : scope)
    const usernameInput =
      findUsernameInput(passwordInput, form) ||
      (scope === document ? findUsernameInput(passwordInput, document) : null)
    const otpInput =
      allInputs(form).find((input) => input !== usernameInput && input !== passwordInput && isOtpInput(input)) ||
      (scope === document ? inputs.find((input) => input !== usernameInput && input !== passwordInput && isOtpInput(input)) : null)

    return {
      usernameInput,
      usernameKind: accountFieldKind(usernameInput),
      passwordInput,
      otpInput,
      otpOnly: false,
      anchor: passwordInput || usernameInput || otpInput
    }
  }

  function detectManualFields(anchorInput = activeInput()) {
    const focused = anchorInput || activeInput()
    const scope = scopeForFocusedInput(focused) || focused?.closest('form') || document
    const inputs = allInputs(scope)
    if (!inputs.length) return null

    const passwordInput =
      (focused && isManualPasswordInput(focused) ? focused : null) ||
      inputs.find(isManualPasswordInput) ||
      null
    const usernameInput =
      (passwordInput && !isManualSecretInput(passwordInput) ? findUsernameInput(passwordInput, scope) : null) ||
      (focused && focused !== passwordInput && isUsernameInput(focused) ? focused : null) ||
      (!isManualSecretInput(passwordInput) ? inputs.find((input) => input !== passwordInput && isUsernameInput(input)) : null) ||
      null
    const otpInput =
      inputs.find((input) => input !== usernameInput && input !== passwordInput && isOtpInput(input)) ||
      null

    if (!usernameInput && !passwordInput && !otpInput) return null
    return {
      usernameInput,
      usernameKind: accountFieldKind(usernameInput),
      passwordInput,
      otpInput,
      otpOnly: Boolean(otpInput && !usernameInput && !passwordInput),
      anchor: focused || passwordInput || usernameInput || otpInput
    }
  }

  function ensureRoot() {
    if (rootHost?.isConnected && rootView) return rootView

    rootHost = document.createElement('div')
    rootHost.id = ROOT_ID
    const shadow = rootHost.attachShadow({ mode: 'closed' })
    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = chrome.runtime.getURL('content.css')
    rootView = document.createElement('div')
    rootView.className = 'mypwdmg-root'
    shadow.append(stylesheet, rootView)
    document.documentElement.appendChild(rootHost)
    return rootView
  }

  function removeRoot() {
    rootHost?.remove()
    rootHost = null
    rootView = null
    entryButtonIds = new WeakMap()
    panelManualMode = false
  }

  function applyAutoSettings(settings = {}) {
    autoFillEnabled = settings.autoFillEnabled !== false
    autoSaveEnabled = settings.autoSaveEnabled !== false
    ignoredSites = normalizeIgnoredSites(settings.ignoredSites)
    manualPanelShortcut = parseShortcut(settings.manualPanelShortcut || SHOW_PANEL_SHORTCUT)
    if (isCurrentSiteIgnored() && pendingSave?.token) dismissSavePrompt()
    if (!autoFillEnabled && !panelManualMode) removeRoot()
  }

  function isRootOpen() {
    return Boolean(rootHost?.isConnected && rootView)
  }

  function isManualPanelOpen() {
    return panelManualMode && isRootOpen() && !pendingSave?.token
  }

  function toggleManualPanel(source = '') {
    if (isManualPanelOpen()) {
      removeRoot()
      return Promise.resolve()
    }
    lastQueryKey = ''
    return queryMatches(true, true, source)
  }

  function positionRoot(anchor) {
    ensureRoot()
    const root = rootHost
    if (panelPinned) {
      clampPanelPosition()
      return
    }

    const rect = usableAnchorRect(anchor)
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

  function usableAnchorRect(anchor) {
    if (!(anchor instanceof Element)) return null
    if (anchor === document.body || anchor === document.documentElement) return null
    const rect = anchor.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return rect
  }

  function promptPlacementForAnchor(anchor) {
    const rect = usableAnchorRect(anchor)
    if (!rect) return null
    const panelWidth = Math.min(286, window.innerWidth - 24)
    const top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - 280))
    const anchorRight = window.innerWidth - Math.min(window.innerWidth - 12, rect.right) - 4
    const maxRight = Math.max(12, window.innerWidth - panelWidth - 12)
    return {
      top: Math.round(top),
      right: Math.round(Math.max(12, Math.min(anchorRight, maxRight))),
      viewportWidth: Math.round(window.innerWidth),
      viewportHeight: Math.round(window.innerHeight)
    }
  }

  function applyPromptPlacement(placement) {
    if (!placement || typeof placement !== 'object') return false
    const top = Number(placement.top)
    const right = Number(placement.right)
    if (!Number.isFinite(top) || !Number.isFinite(right)) return false
    setPanelPosition(top, right)
    return true
  }

  function setPanelPosition(top, right) {
    const panel = ensureRoot().querySelector('.mypwdmg-panel')
    const panelWidth = panel?.getBoundingClientRect().width || 286
    const panelHeight = panel?.getBoundingClientRect().height || 220
    const nextTop = Math.max(8, Math.min(top, window.innerHeight - Math.min(panelHeight, window.innerHeight - 16) - 8))
    const nextRight = Math.max(8, Math.min(right, window.innerWidth - Math.min(panelWidth, window.innerWidth - 16) - 8))
    const root = rootHost
    root.style.setProperty('--mypwdmg-top', `${Math.round(nextTop)}px`)
    root.style.setProperty('--mypwdmg-right', `${Math.round(nextRight)}px`)
  }

  function clampPanelPosition() {
    ensureRoot()
    const root = rootHost
    const top = Number.parseFloat(root.style.getPropertyValue('--mypwdmg-top')) || 76
    const right = Number.parseFloat(root.style.getPropertyValue('--mypwdmg-right')) || 16
    setPanelPosition(top, right)
  }

  function startPanelDrag(event) {
    if (!event.isTrusted || event.button !== 0 || event.target?.closest?.('.mypwdmg-close')) return
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
      rootView?.querySelector('.mypwdmg-panel')?.classList.remove('is-dragging')
      panelDrag = null
    }
    window.removeEventListener('pointermove', dragPanel)
  }

  function addTrustedClick(element, handler) {
    element?.addEventListener('click', (event) => {
      if (!event.isTrusted) return
      handler(event)
    })
  }

  function renderPanel(matches, statusText = '', anchor = null, manualMode = false) {
    if (!matches.length && !statusText) {
      removeRoot()
      return
    }

    panelManualMode = Boolean(manualMode)
    positionRoot(anchor)
    const root = ensureRoot()
    root.innerHTML = `
    <div class="mypwdmg-panel" role="dialog" aria-label="My Password 自动填充">
      <div class="mypwdmg-title">
        <div class="mypwdmg-title-text">
          <span>My Password</span>
          <small>${escapeHtml(statusText ? '状态' : `${matches.length} 个匹配账号`)}</small>
        </div>
        <button class="mypwdmg-close" type="button" title="关闭" aria-label="关闭">×</button>
      </div>
      ${statusText
        ? `<div class="mypwdmg-status"><span class="mypwdmg-status-dot"></span><span>${escapeHtml(statusText)}</span></div>`
        : `
            <div class="mypwdmg-list" role="list">
              ${matches.map((entry) => renderEntryButton(entry)).join('')}
            </div>
          `
      }
    </div>
  `

    addTrustedClick(root.querySelector('.mypwdmg-close'), removeRoot)
    root.querySelector('.mypwdmg-title')?.addEventListener('pointerdown', startPanelDrag)
    root.querySelectorAll('.mypwdmg-entry').forEach((button, index) => {
      const entryId = String(matches[index]?.id || '')
      entryButtonIds.set(button, entryId)
      addTrustedClick(button, () => fillEntry(entryButtonIds.get(button), panelManualMode, true))
    })
  }

  function renderEntryButton(entry) {
    const label = accountLabel(entry)
    const domain = entry.domains?.[0] || ''
    return `
    <button class="mypwdmg-entry" type="button" role="listitem">
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
    if (!applyPromptPlacement(preview.placement)) {
      positionRoot(preview.anchor || null)
    }
    const folders = Array.isArray(preview.folders) ? preview.folders : []
    const update = preview.updateCandidate
    const titleValue = update?.title || preview.title || preview.hostname || 'Untitled'
    const accountValue = preview.accountLabel || update?.username || update?.email || update?.phone || ''
    const accountKind = ['email', 'phone', 'username'].includes(preview.accountKind) ? preview.accountKind : 'username'
    const statusNotice = String(preview.notice || '').trim()
    root.innerHTML = `
    <div class="mypwdmg-panel mypwdmg-save-panel" role="dialog" aria-label="保存到 My Password">
      <div class="mypwdmg-title">
        <div class="mypwdmg-title-text">
          <span>${escapeHtml(update ? '更新登录项' : '保存新登录')}</span>
          <small>${escapeHtml(preview.hostname || '当前网站')}</small>
        </div>
        <button class="mypwdmg-close" type="button" title="关闭" aria-label="关闭">×</button>
      </div>
      <div class="mypwdmg-save-body">
        <div class="mypwdmg-save-editor">
          <label class="mypwdmg-save-field">
            <span>名称</span>
            <input id="mypwdmg-save-title" class="mypwdmg-save-input" value="${escapeAttr(titleValue)}" autocomplete="off" />
          </label>
          <label class="mypwdmg-save-field">
            <span>账号</span>
            <div class="mypwdmg-account-edit">
              <select id="mypwdmg-save-account-kind" class="mypwdmg-save-select" aria-label="账号类型">
                <option value="username"${accountKind === 'username' ? ' selected' : ''}>账号</option>
                <option value="email"${accountKind === 'email' ? ' selected' : ''}>邮箱</option>
                <option value="phone"${accountKind === 'phone' ? ' selected' : ''}>手机</option>
              </select>
              <input id="mypwdmg-save-account" class="mypwdmg-save-input" value="${escapeAttr(accountValue)}" placeholder="未识别，可手动填写" autocomplete="off" />
            </div>
          </label>
        </div>
        ${update
        ? `<div class="mypwdmg-save-note">将更新：${escapeHtml(update.title || 'Untitled')}${update.path ? ` · ${escapeHtml(update.path)}` : ''}</div>`
        : `
              <label class="mypwdmg-save-label" for="mypwdmg-save-folder">保存位置</label>
              <select id="mypwdmg-save-folder" class="mypwdmg-save-select">
                ${folders
          .map((folder) => `<option value="${escapeAttr(folder.id || '')}">${escapeHtml(folder.path || folder.title || '根目录')}</option>`)
          .join('')}
              </select>
            `
      }
        ${statusNotice ? `<div class="mypwdmg-save-note">${escapeHtml(statusNotice)}</div>` : ''}
        <div class="mypwdmg-save-actions mypwdmg-save-actions-wide">
          <button class="mypwdmg-save-secondary" type="button" data-action="dismiss">忽略本次</button>
          <button class="mypwdmg-save-secondary" type="button" data-action="ignore-site">忽略此站点</button>
          <button class="mypwdmg-save-primary" type="button" data-action="save">${escapeHtml(update ? '更新' : '保存')}</button>
        </div>
      </div>
    </div>
  `

    addTrustedClick(root.querySelector('.mypwdmg-close'), dismissSavePrompt)
    addTrustedClick(root.querySelector('[data-action="dismiss"]'), dismissSavePrompt)
    addTrustedClick(root.querySelector('[data-action="ignore-site"]'), ignoreCurrentSaveSite)
    addTrustedClick(root.querySelector('[data-action="save"]'), savePendingCapture)
    root.querySelector('.mypwdmg-title')?.addEventListener('pointerdown', startPanelDrag)
  }

  function dismissSavePrompt() {
    if (pendingSave?.token) {
      completedSaveTokens.add(pendingSave.token)
      sendMessage({ type: 'MYPWDMG_DISMISS_CAPTURE', token: pendingSave.token }).catch(() => { })
    }
    pendingSave = null
    removeRoot()
  }

  async function ignoreCurrentSaveSite() {
    if (!pendingSave?.token) return
    const token = pendingSave.token
    const anchor = pendingSave.anchor || document.activeElement
    const hostname = normalizeHost(pendingSave.hostname || location.hostname)
    if (!hostname) return

    const root = ensureRoot()
    const button = root.querySelector('[data-action="ignore-site"]')
    button?.setAttribute('disabled', 'true')
    const response = await sendMessage({
      type: 'MYPWDMG_ADD_IGNORED_SITE',
      token
    })
    if (!response?.ok) {
      renderSavePrompt({
        ...pendingSave,
        anchor,
        notice: response?.message || '忽略站点失败。'
      })
      return
    }

    ignoredSites = normalizeIgnoredSites(response.data?.ignoredSites)
    completedSaveTokens.add(token)
    pendingSave = null
    renderPanel([], `已忽略 ${hostname}，之后不会自动保存该站点。`, anchor)
    window.setTimeout(removeRoot, 1800)
  }

  async function savePendingCapture() {
    if (!pendingSave?.token) return
    const token = pendingSave.token
    const root = ensureRoot()
    const button = root.querySelector('[data-action="save"]')
    const folderSelect = root.querySelector('#mypwdmg-save-folder')
    const titleInput = root.querySelector('#mypwdmg-save-title')
    const accountInput = root.querySelector('#mypwdmg-save-account')
    const accountKindSelect = root.querySelector('#mypwdmg-save-account-kind')
    const title = String(titleInput?.value || '').trim()
    const account = String(accountInput?.value || '').trim()
    const accountKind = String(accountKindSelect?.value || 'username')
    button?.setAttribute('disabled', 'true')
    const response = await sendMessage({
      type: 'MYPWDMG_SAVE_CAPTURE',
      token,
      parentId: pendingSave.updateCandidate ? '' : folderSelect?.value || '',
      updateEntryId: pendingSave.updateCandidate?.id || '',
      overrides: {
        title,
        titleEdited: Boolean(title),
        account,
        accountKind,
        accountEdited: Boolean(account)
      }
    })
    if (!response?.ok) {
      renderSavePrompt({
        ...pendingSave,
        notice: response?.message || '保存失败，请重试。'
      })
      return
    }
    renderPanel([], response.data?.action === 'updated' ? '已更新。' : '已保存。', pendingSave.anchor || document.activeElement)
    completedSaveTokens.add(token)
    pendingSave = null
    window.setTimeout(removeRoot, 1600)
  }

  function scheduleQuery(force = false, delay = QUERY_DEBOUNCE_MS) {
    if (extensionContextInvalidated) return
    if (!autoFillEnabled) return
    if (pendingSave?.token) return
    if (!force && panelManualMode && isRootOpen()) return
    window.clearTimeout(queryTimer)
    queryTimer = window.setTimeout(() => queryMatches(force), delay)
  }

  async function queryMatches(force = false, manualMode = false, manualSource = '') {
    if (extensionContextInvalidated) return
    if (!manualMode && !autoFillEnabled) {
      removeRoot()
      return
    }
    if (pendingSave?.token) return
    const manualInput = manualMode ? manualAnchorInput(manualSource) : null
    const fields = manualMode ? (detectLoginFields() || detectManualFields(manualInput)) : detectLoginFields()
    if (!fields) {
      lastManualFields = null
      if (manualMode) {
        renderPanel([], '当前焦点附近没有可填充的登录字段。', activeInput(), true)
      } else {
        removeRoot()
      }
      return
    }
    lastManualFields = manualMode ? fields : null

    const key = [manualMode ? 'manual' : 'auto', location.hostname, fieldId(fields.usernameInput), fields.usernameKind, fieldId(fields.passwordInput), fieldId(fields.otpInput)].join('|')
    if (!force && key === lastQueryKey) return
    lastQueryKey = key

    const response = await sendMessage({
      type: 'MYPWDMG_QUERY_MATCHES'
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
    renderPanel(lastMatches, lastMatches.length ? '' : '当前站点暂无匹配账号。', fields.anchor, manualMode)
  }

  async function fillEntry(entryId, manualMode = false, authorizedSelection = false) {
    if (!entryId) return { ok: false, code: 'ENTRY_REQUIRED' }
    if (extensionContextInvalidated) return { ok: false, code: 'EXTENSION_CONTEXT_INVALIDATED' }
    if (pendingSave?.token) return { ok: false, code: 'SAVE_PROMPT_ACTIVE' }
    if (!authorizedSelection) return { ok: false, code: 'TRUSTED_GESTURE_REQUIRED' }

    const authorization = await sendMessage({ type: 'MYPWDMG_AUTHORIZE_FILL', entryId })
    if (!authorization?.ok || !authorization.data?.token) {
      const fields = detectLoginFields()
      renderPanel(lastMatches, authorization?.message || '填充授权失败，请重试。', fields?.anchor, manualMode)
      return authorization || { ok: false, code: 'FILL_AUTH_FAILED' }
    }

    suppressCaptureUntil = Date.now() + FILL_CAPTURE_SUPPRESS_MS
    const response = await sendMessage({
      type: 'MYPWDMG_GET_FILL',
      entryId,
      authorizationToken: authorization.data.token
    })
    if (!response?.ok || !response.data) {
      const fields = detectLoginFields()
      if (response?.code === 'PLUGIN_DISABLED' || response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
        removeRoot()
        return response
      }
      renderPanel(lastMatches, response?.message || 'Failed to read entry.', fields?.anchor, manualMode)
      return response || { ok: false, code: 'FILL_FAILED' }
    }
    if (!applyFill(response.data, manualMode)) {
      renderPanel(lastMatches, '当前焦点附近没有可填充的登录字段。', activeInput(), manualMode)
      return { ok: false, code: 'NO_FILLABLE_FIELDS' }
    }
    suppressCaptureUntil = Date.now() + FILL_CAPTURE_SUPPRESS_MS
    removeRoot()
    return { ok: true }
  }

  function applyFill(payload, manualMode = false) {
    const fields = manualMode ? (lastManualFields || detectManualFields()) : detectLoginFields()
    if (!fields) return false

    setInputValue(fields.usernameInput, resolveAccountValue(payload, fields.usernameKind))
    setInputValue(fields.passwordInput, payload.password || '')
    if (fields.otpInput && payload.totp) setInputValue(fields.otpInput, payload.totp)
    return true
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
    if (isPasswordInput(input)) {
      extensionFilledPasswords.set(fieldId(input), String(value))
    }
  }

  function captureLoginFromScope(scope = document, anchor = null) {
    if (Date.now() < suppressCaptureUntil) return null
    const fields = detectLoginFieldsInScope(scope)
    if (!fields?.passwordInput) return null
    const password = String(fields.passwordInput.value || '')
    if (!password) return null
    const passwordFieldId = fieldId(fields.passwordInput)
    if (extensionFilledPasswords.get(passwordFieldId) === password) return null

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
    const promptAnchor = anchor || fields.passwordInput || fields.usernameInput
    return {
      capture,
      anchor: promptAnchor,
      placement: promptPlacementForAnchor(promptAnchor)
    }
  }

  function detectLoginFieldsInScope(scope = document) {
    if (scopeLooksLikeNonLoginSecretEditor(scope)) return null
    const inputs = allInputs(scope)
    const passwordInputs = inputs.filter(isPasswordInput)
    if (!passwordInputs.length) return null
    const passwordInput = passwordInputs.filter((input) => String(input.value || '')).at(-1) || passwordInputs.at(-1)
    const usernameInput =
      findUsernameInput(passwordInput, scope) ||
      (scope === document ? findUsernameInput(passwordInput, document) : null)
    return {
      usernameInput,
      usernameKind: accountFieldKind(usernameInput),
      passwordInput
    }
  }

  function scheduleSaveCapture(captureInfo) {
    if (!autoSaveEnabled) return
    if (isCurrentSiteIgnored()) return
    if (!captureInfo?.capture?.password) return
    lastSubmitCapture = { ...captureInfo, at: Date.now() }
    window.clearTimeout(savePromptTimer)
    prepareSavePrompt(captureInfo, SAVE_PROMPT_CAPTURE_DELAY_MS).catch(() => { })
  }

  function sameCapture(left, right) {
    if (!left?.capture || !right?.capture) return false
    return left.capture.hostname === right.capture.hostname
      && left.capture.account === right.capture.account
      && left.capture.accountKind === right.capture.accountKind
      && left.capture.password === right.capture.password
  }

  function rememberInputCapture(target) {
    if (!autoSaveEnabled) return
    if (isCurrentSiteIgnored()) return
    const input = target instanceof Element ? inputFromEventTarget(target) : null
    if (!input) return
    if (!isPasswordInput(input) && !isUsernameInput(input)) return
    const scope = input.closest('form') || scopeForFocusedInput(input) || document
    const captureInfo = captureLoginFromScope(scope, input)
    if (captureInfo) lastInputCapture = { ...captureInfo, at: Date.now() }
  }

  function recentInputCaptureFor(scope, anchor) {
    if (!lastInputCapture || Date.now() - lastInputCapture.at > RECENT_INPUT_CAPTURE_TTL_MS) return null
    const fresh = captureLoginFromScope(scope, anchor)
    if (fresh) return fresh
    return lastInputCapture
  }

  async function prepareSavePrompt(captureInfo, renderDelay = 0) {
    if (!autoSaveEnabled) return
    if (isCurrentSiteIgnored()) return
    if (!captureInfo?.capture?.password) return
    const response = await sendMessage({
      type: 'MYPWDMG_PREPARE_CAPTURE',
      capture: captureInfo.capture,
      placement: captureInfo.placement || promptPlacementForAnchor(captureInfo.anchor)
    })
    if (!response?.ok) {
      if (response?.code === 'LOCKED_CAPTURE_PENDING' || response?.code === 'LOCKED' || response?.code === 'BAD_PASSWORD') {
        renderPanel([], response?.message || 'My Password 插件已锁定，解锁后继续保存。', captureInfo.anchor)
      }
      return
    }
    if (!response?.ok || !response.data?.shouldPrompt || !response.data?.token) return
    scheduleTakePreparedSavePrompt(renderDelay)
  }

  async function takePreparedSavePrompt() {
    if (extensionContextInvalidated) return
    if (!autoSaveEnabled) return
    if (pendingSave?.token) return
    if (isCurrentSiteIgnored()) return
    const response = await sendMessage({ type: 'MYPWDMG_TAKE_SAVE_PROMPT' })
    if (!response?.ok || !response.data?.token) return
    if (completedSaveTokens.has(response.data.token) || pendingSave?.token === response.data.token) return
    renderSavePrompt({
      ...response.data
    })
  }

  function scheduleTakePreparedSavePrompt(delay = 0) {
    if (extensionContextInvalidated) return
    window.clearTimeout(savePromptTimer)
    const run = () => {
      savePromptTimer = 0
      takePreparedSavePrompt().catch(() => { })
    }
    if (delay > 0) {
      savePromptTimer = window.setTimeout(run, delay)
      return
    }
    run()
  }

  function handleSubmitCapture(event) {
    if (!event.isTrusted) return
    const form = event.target?.closest?.('form') || event.target
    if (scopeLooksLikeNonLoginSecretEditor(form)) return
    scheduleSaveCapture(captureLoginFromScope(form, event.target))
  }

  function handleClickCapture(event) {
    if (!event.isTrusted) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest?.(`#${ROOT_ID}`)) return
    const control = target?.closest(ACTION_CONTROL_SELECTOR)
    if (!control) return
    const text = [
      control.textContent,
      control.getAttribute?.('aria-label'),
      control.getAttribute?.('title'),
      control.getAttribute?.('value')
    ]
      .join(' ')
      .toLowerCase()
    const type = inputType(control)
    const isNativeSubmit = control instanceof HTMLButtonElement
      ? (control.getAttribute('type') || 'submit').toLowerCase() === 'submit'
      : type === 'submit' || type === 'image'
    if (!isNativeSubmit && !SUBMIT_ACTION_RE.test(text)) return

    const form = control.closest('form') || document
    if (scopeLooksLikeNonLoginSecretEditor(form)) return
    const captureInfo = recentInputCaptureFor(form, control)
    if (!captureInfo) return
    if (lastSubmitCapture && Date.now() - lastSubmitCapture.at <= CAPTURE_CLICK_WINDOW_MS && sameCapture(lastSubmitCapture, captureInfo)) return
    scheduleSaveCapture({ ...captureInfo, at: Date.now() })
  }

  function handleEnterCapture(event) {
    if (!event.isTrusted) return
    if (event.key !== 'Enter') return
    const target = event.target instanceof Element ? event.target : null
    if (!target?.matches?.('input')) return
    const type = inputType(target)
    if (['button', 'submit', 'checkbox', 'radio', 'file', 'hidden'].includes(type)) return
    const form = target.closest('form') || document
    if (scopeLooksLikeNonLoginSecretEditor(form)) return
    const captureInfo = recentInputCaptureFor(form, target)
    if (!captureInfo) return
    if (lastSubmitCapture && Date.now() - lastSubmitCapture.at <= CAPTURE_CLICK_WINDOW_MS && sameCapture(lastSubmitCapture, captureInfo)) return
    scheduleSaveCapture({ ...captureInfo, at: Date.now() })
  }

  function isShowPanelShortcut(event) {
    return event.altKey === manualPanelShortcut.altKey
      && event.shiftKey === manualPanelShortcut.shiftKey
      && event.ctrlKey === manualPanelShortcut.ctrlKey
      && event.metaKey === manualPanelShortcut.metaKey
      && event.code === manualPanelShortcut.code
  }

  function handleShowPanelShortcut(event) {
    if (!isShowPanelShortcut(event)) return false
    event.preventDefault()
    event.stopPropagation()
    toggleManualPanel('shortcut').catch(() => { })
    return true
  }

  function rememberContextMenuInput(event) {
    if (!event.isTrusted) return
    const input = inputFromEventTarget(event.target)
    if (!input) return
    contextMenuInput = input
    contextMenuInputAt = Date.now()
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'MYPWDMG_REFRESH') {
      lastQueryKey = ''
      queryMatches(true)
      scheduleTakePreparedSavePrompt(SAVE_PROMPT_RESTORE_DELAY_MS)
      sendResponse?.({ ok: true })
    }
    if (message?.type === 'MYPWDMG_AUTO_SETTINGS_CHANGED') {
      applyAutoSettings(message.settings || {})
      sendResponse?.({ ok: true })
    }
    if (message?.type === 'MYPWDMG_SHOW_PANEL') {
      toggleManualPanel(message.source || '')
        .then(() => sendResponse?.({ ok: true }))
        .catch((error) => sendResponse?.({ ok: false, message: String(error?.message || error) }))
      return true
    }
    if (message?.type === 'MYPWDMG_FILL_ENTRY') {
      let popupSender = false
      try {
        const senderUrl = new URL(sender?.url || '')
        popupSender = sender?.id === chrome.runtime.id
          && senderUrl.protocol === 'chrome-extension:'
          && senderUrl.hostname === chrome.runtime.id
          && senderUrl.pathname.endsWith('/popup.html')
      } catch { }
      if (!popupSender) {
        sendResponse({ ok: false, code: 'TRUSTED_GESTURE_REQUIRED' })
        return
      }
      fillEntry(message.entryId, Boolean(message.manual), true)
        .then((response) => sendResponse(response || { ok: false, code: 'FILL_FAILED' }))
        .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }))
      return true
    }
    if (message?.type === 'MYPWDMG_CAPTURE_READY') {
      scheduleTakePreparedSavePrompt(SAVE_PROMPT_CAPTURE_DELAY_MS)
    }
  })

  document.addEventListener('focusin', () => scheduleQuery(false), true)
  document.addEventListener('input', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target || !event.isTrusted) return
    if (isPasswordInput(target)) extensionFilledPasswords.delete(fieldId(target))
    rememberInputCapture(target)
  }, true)
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return
    if (handleShowPanelShortcut(event)) return
    handleEnterCapture(event)
    if (event.key !== 'Escape') return
    if (!isRootOpen()) return
    if (pendingSave?.token) {
      dismissSavePrompt()
      return
    }
    removeRoot()
  }, true)
  document.addEventListener('submit', handleSubmitCapture, true)
  document.addEventListener('click', handleClickCapture, true)
  document.addEventListener('contextmenu', rememberContextMenuInput, true)
  window.addEventListener('pageshow', () => {
    scheduleQuery(true)
    scheduleTakePreparedSavePrompt(SAVE_PROMPT_RESTORE_DELAY_MS)
  })
  window.addEventListener('resize', () => {
    if (panelPinned) clampPanelPosition()
    else if (panelManualMode && isRootOpen()) positionRoot(lastManualFields?.anchor || activeInput())
    else scheduleQuery(true)
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'name', 'id', 'autocomplete', 'placeholder', 'aria-label', 'style', 'class', 'disabled', 'readonly']
  })
  sendMessage({ type: 'MYPWDMG_GET_AUTO_SETTINGS' })
    .then((response) => {
      if (response?.ok) applyAutoSettings(response.data || {})
      scheduleQuery(true)
      scheduleTakePreparedSavePrompt(SAVE_PROMPT_RESTORE_DELAY_MS)
    })
    .catch(() => {
      scheduleQuery(true)
      scheduleTakePreparedSavePrompt(SAVE_PROMPT_RESTORE_DELAY_MS)
    })
}
