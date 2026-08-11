import type { AutofillMatchMode } from '../types'

export const AUTOFILL_MATCH_MODES = new Set<AutofillMatchMode>([
  'base-domain',
  'exact-host',
  'subdomain',
  'url-prefix',
  'never'
])

export function normalizeAutofillMatchMode(value: unknown): AutofillMatchMode {
  return typeof value === 'string' && AUTOFILL_MATCH_MODES.has(value as AutofillMatchMode)
    ? value as AutofillMatchMode
    : 'base-domain'
}

export function normalizeAutofillRuleValues(value: string, mode: AutofillMatchMode): string[] {
  const values = value
    .split(/[\n,，\s]+/)
    .map((item) => mode === 'url-prefix' ? normalizeUrlPrefix(item) : normalizeSavedHost(item, mode !== 'base-domain'))
    .filter(Boolean)
  return [...new Set(values)]
}

function normalizeSavedHost(value: string, preserveWww: boolean): string {
  const raw = value.trim().toLowerCase()
  if (!raw) return ''
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return ''
    const host = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '')
    return preserveWww ? host : host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeUrlPrefix(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return ''
    parsed.hash = ''
    return parsed.href
  } catch {
    return ''
  }
}
