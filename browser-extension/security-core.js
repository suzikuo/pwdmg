(function initMyPwdMgSecurity(globalObject, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  globalObject.MyPwdMgSecurity = api
})(globalThis, function createMyPwdMgSecurity() {
  'use strict'

  const PASSWORD_TOKEN_RE = /(^|[^a-z0-9])(password|passwd|pwd|passphrase|pass[\s_-]*phrase|pass)(?=$|[^a-z0-9])|\u5bc6\u7801/i
  const OTP_STRONG_RE = /(^|[^a-z0-9])(otp|totp|2fa|mfa|one[\s_-]*time(?:[\s_-]*(?:password|code))?|verification[\s_-]*code|authenticator[\s_-]*(?:code|token)|passcode)(?=$|[^a-z0-9])|\u9a8c\u8bc1\u7801|\u52a8\u6001\u7801|\u52a8\u6001\u53e3\u4ee4|\u4e8c\u6b21\u9a8c\u8bc1/i
  const OTP_WEAK_RE = /(^|[^a-z0-9])(code|pin)(?=$|[^a-z0-9])/i
  const CARD_CODE_RE = /(^|[^a-z0-9])(cvv|cvc|card[\s_-]*security|card[\s_-]*code)(?=$|[^a-z0-9])/i

  function normalizeHost(value = '') {
    const raw = String(value || '').trim()
    if (!raw) return ''
    try {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
      const parsed = new URL(candidate)
      if (!parsed.hostname) return ''
      return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^\.+|\.+$/g, '')
    } catch {
      return ''
    }
  }

  function normalizeSavedDomain(value = '') {
    let domain = String(value || '').trim().toLowerCase()
    if (!domain) return ''
    domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    domain = domain.split('/', 1)[0].split('@').at(-1) || ''
    if (domain.startsWith('[')) return ''
    domain = domain.replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '')
    return domain.startsWith('www.') ? domain.slice(4) : domain
  }

  function domainMatches(hostname = '', savedDomain = '') {
    const host = normalizeHost(hostname)
    const domain = normalizeSavedDomain(savedDomain)
    if (!host || !domain) return false
    if (domain.includes('*')) {
      const pattern = domain
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^.]*')
      return new RegExp(`^${pattern}$`, 'i').test(host)
    }
    return host === domain || host.endsWith(`.${domain}`)
  }

  function entryMatchesHostname(entry, hostname = '') {
    if (!entry || typeof entry !== 'object') return false
    const domains = Array.isArray(entry.domains) ? entry.domains : []
    return domains.some((domain) => domainMatches(hostname, domain))
  }

  function webContext(values = {}) {
    const tabId = Number(values.tabId)
    const frameId = Number(values.frameId ?? 0)
    if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) return null
    try {
      const parsed = new URL(String(values.url || ''))
      if (!['http:', 'https:'].includes(parsed.protocol)) return null
      parsed.hash = ''
      return {
        tabId,
        frameId,
        documentId: String(values.documentId || ''),
        origin: parsed.origin,
        hostname: normalizeHost(parsed.hostname),
        url: parsed.href
      }
    } catch {
      return null
    }
  }

  function sameDocumentContext(left, right) {
    if (!left || !right) return false
    if (left.tabId !== right.tabId || left.frameId !== right.frameId || left.origin !== right.origin) return false
    if (left.documentId || right.documentId) {
      return Boolean(left.documentId && right.documentId && left.documentId === right.documentId)
    }
    return left.url === right.url
  }

  function sameOriginFrame(left, right) {
    return Boolean(left && right
      && left.tabId === right.tabId
      && left.frameId === right.frameId
      && left.origin === right.origin
      && left.hostname === right.hostname)
  }

  function passwordEvidence(values = {}) {
    const type = String(values.type || '').toLowerCase()
    const text = String(values.text || '').toLowerCase()
    const autocomplete = String(values.autocomplete || '').toLowerCase()
    if (/(^|\s)one-time-code(?=\s|$)/.test(autocomplete)) return 'none'
    if (CARD_CODE_RE.test(text) || /(^|\s)cc-csc(?=\s|$)/.test(autocomplete)) return 'none'
    if (/(^|\s)(current-password|new-password)(?=\s|$)/.test(autocomplete)) return 'strong'
    if (OTP_STRONG_RE.test(text) && !PASSWORD_TOKEN_RE.test(text)) return 'none'
    if (type === 'password' || PASSWORD_TOKEN_RE.test(text)) return 'strong'
    return 'none'
  }

  function otpEvidence(values = {}) {
    const type = String(values.type || '').toLowerCase()
    const text = String(values.text || '').toLowerCase()
    const autocomplete = String(values.autocomplete || '').toLowerCase()
    const inputMode = String(values.inputMode || '').toLowerCase()
    const pattern = String(values.pattern || '')
    const maxLength = Number(values.maxLength || 0)
    if (CARD_CODE_RE.test(text) || /(^|\s)cc-csc(?=\s|$)/.test(autocomplete)) return 'none'
    if (/(^|\s)one-time-code(?=\s|$)/.test(autocomplete) || OTP_STRONG_RE.test(text)) return 'strong'

    const digitConstrained = ['number', 'tel'].includes(type)
      || ['numeric', 'decimal', 'tel'].includes(inputMode)
      || /(?:\\d|\[0-9\]|\[\\d\])/.test(pattern)
    if (OTP_WEAK_RE.test(text) && digitConstrained && maxLength >= 4 && maxLength <= 8) return 'weak'
    return 'none'
  }

  return Object.freeze({
    domainMatches,
    entryMatchesHostname,
    normalizeHost,
    normalizeSavedDomain,
    otpEvidence,
    passwordEvidence,
    sameDocumentContext,
    sameOriginFrame,
    webContext
  })
})
