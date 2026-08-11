import type { PasswordHealthIssue } from './passwordHealth.ts'

export type HealthPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface IgnoredHealthFinding {
  entryId: string
  issue: PasswordHealthIssue
  reason: string
  ignoredAt: number
}

export const HEALTH_TOTP_EXPECTED_IDS_KEY = 'mypwdmg.healthTotpExpected.v1'
export const HEALTH_IGNORED_FINDINGS_KEY = 'mypwdmg.healthIgnoredFindings.v1'
const MAX_ENTRY_IDS = 500
const MAX_IGNORED_FINDINGS = 1_000
const MAX_REASON_LENGTH = 120
const VALID_ISSUES = new Set<PasswordHealthIssue>([
  'missing', 'weak', 'reused', 'stale', 'insecure-url', 'duplicate',
  'expired', 'expiring', 'missing-totp'
])

function resolveStorage(): HealthPreferenceStorage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

export function healthFindingKey(entryId: string, issue: PasswordHealthIssue): string {
  return `${entryId}\u0000${issue}`
}

export function loadExpectedTotpEntryIds(
  storage: HealthPreferenceStorage | null = resolveStorage()
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HEALTH_TOTP_EXPECTED_IDS_KEY) || '[]')
    return new Set(Array.isArray(parsed) ? normalizeIds(parsed) : [])
  } catch {
    return new Set()
  }
}

export function setExpectedTotpEntryId(
  entryId: string,
  expected: boolean,
  current: Iterable<string>,
  storage: HealthPreferenceStorage | null = resolveStorage()
): Set<string> {
  const next = new Set(normalizeIds(current))
  const normalizedId = normalizeId(entryId)
  if (normalizedId) {
    if (expected) next.add(normalizedId)
    else next.delete(normalizedId)
  }
  writeExpectedTotpEntryIds(next, storage)
  return next
}

export function loadIgnoredHealthFindings(
  storage: HealthPreferenceStorage | null = resolveStorage()
): Map<string, IgnoredHealthFinding> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HEALTH_IGNORED_FINDINGS_KEY) || '[]')
    return normalizeIgnoredFindings(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Map()
  }
}

export function ignoreHealthFinding(
  entryId: string,
  issue: PasswordHealthIssue,
  reason: string,
  current: ReadonlyMap<string, IgnoredHealthFinding>,
  storage: HealthPreferenceStorage | null = resolveStorage(),
  now = Date.now()
): Map<string, IgnoredHealthFinding> {
  const next = normalizeIgnoredFindings(current.values())
  const finding = normalizeIgnoredFinding({ entryId, issue, reason, ignoredAt: now })
  if (finding) next.set(healthFindingKey(finding.entryId, finding.issue), finding)
  return writeIgnoredHealthFindings(next, storage)
}

export function restoreHealthFinding(
  entryId: string,
  issue: PasswordHealthIssue,
  current: ReadonlyMap<string, IgnoredHealthFinding>,
  storage: HealthPreferenceStorage | null = resolveStorage()
): Map<string, IgnoredHealthFinding> {
  const next = normalizeIgnoredFindings(current.values())
  next.delete(healthFindingKey(entryId, issue))
  return writeIgnoredHealthFindings(next, storage)
}

export function clearIgnoredHealthFindingsForEntry(
  entryId: string,
  current: ReadonlyMap<string, IgnoredHealthFinding>,
  storage: HealthPreferenceStorage | null = resolveStorage()
): Map<string, IgnoredHealthFinding> {
  const next = normalizeIgnoredFindings(current.values())
  for (const [key, finding] of next) {
    if (finding.entryId === entryId) next.delete(key)
  }
  return writeIgnoredHealthFindings(next, storage)
}

export function pruneHealthPreferences(
  validEntryIds: ReadonlySet<string>,
  validLoginIds: ReadonlySet<string>,
  expectedTotpIds: Iterable<string>,
  ignoredFindings: ReadonlyMap<string, IgnoredHealthFinding>,
  storage: HealthPreferenceStorage | null = resolveStorage()
): { expectedTotpIds: Set<string>; ignoredFindings: Map<string, IgnoredHealthFinding> } {
  const nextExpected = new Set(normalizeIds(expectedTotpIds).filter((id) => validLoginIds.has(id)))
  const nextIgnored = normalizeIgnoredFindings(
    [...ignoredFindings.values()].filter((finding) => validEntryIds.has(finding.entryId))
  )
  writeExpectedTotpEntryIds(nextExpected, storage)
  writeIgnoredHealthFindings(nextIgnored, storage)
  return { expectedTotpIds: nextExpected, ignoredFindings: nextIgnored }
}

function normalizeIds(values: Iterable<unknown>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const id = normalizeId(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= MAX_ENTRY_IDS) break
  }
  return result
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  return id && id.length <= 256 ? id : ''
}

function normalizeIgnoredFindings(values: Iterable<unknown>): Map<string, IgnoredHealthFinding> {
  const result = new Map<string, IgnoredHealthFinding>()
  for (const value of values) {
    const finding = normalizeIgnoredFinding(value)
    if (!finding) continue
    const key = healthFindingKey(finding.entryId, finding.issue)
    const previous = result.get(key)
    if (!previous || finding.ignoredAt >= previous.ignoredAt) result.set(key, finding)
  }
  return new Map([...result.entries()]
    .sort((left, right) => right[1].ignoredAt - left[1].ignoredAt || left[0].localeCompare(right[0], 'en'))
    .slice(0, MAX_IGNORED_FINDINGS))
}

function normalizeIgnoredFinding(value: unknown): IgnoredHealthFinding | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<IgnoredHealthFinding>
  const entryId = normalizeId(source.entryId)
  const issue = source.issue
  const reason = typeof source.reason === 'string'
    ? source.reason.trim().slice(0, MAX_REASON_LENGTH)
    : ''
  const ignoredAt = typeof source.ignoredAt === 'number' && Number.isFinite(source.ignoredAt) && source.ignoredAt > 0
    ? Math.floor(source.ignoredAt)
    : 0
  if (!entryId || !VALID_ISSUES.has(issue as PasswordHealthIssue) || !reason || !ignoredAt) return null
  return { entryId, issue: issue as PasswordHealthIssue, reason, ignoredAt }
}

function writeExpectedTotpEntryIds(
  ids: Iterable<string>,
  storage: HealthPreferenceStorage | null
): void {
  try {
    storage?.setItem(HEALTH_TOTP_EXPECTED_IDS_KEY, JSON.stringify(normalizeIds(ids)))
  } catch {
    // Optional local metadata must never block vault access.
  }
}

function writeIgnoredHealthFindings(
  findings: ReadonlyMap<string, IgnoredHealthFinding>,
  storage: HealthPreferenceStorage | null
): Map<string, IgnoredHealthFinding> {
  const normalized = normalizeIgnoredFindings(findings.values())
  try {
    storage?.setItem(HEALTH_IGNORED_FINDINGS_KEY, JSON.stringify([...normalized.values()]))
  } catch {
    // Optional local metadata must never block vault access.
  }
  return normalized
}
