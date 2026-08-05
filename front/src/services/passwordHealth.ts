import type { VaultEntry } from '../types'

export type PasswordHealthIssue =
  | 'missing'
  | 'weak'
  | 'reused'
  | 'stale'

export type PasswordWeaknessReason =
  | 'too-short'
  | 'common-password'
  | 'low-diversity'
  | 'repetitive'
  | 'sequential'
  | 'contains-account-data'
  | 'low-estimated-entropy'

export interface PasswordStrengthAssessment {
  score: 0 | 1 | 2 | 3 | 4
  estimatedEntropyBits: number
  analyzedLength: number
  inputTruncated: boolean
  weak: boolean
  reasons: PasswordWeaknessReason[]
}

export interface PasswordAgeAssessment {
  changedAt: number
  ageDays: number
  source: 'history-change' | 'history-created' | 'provided'
  stale: boolean
}

export interface PasswordHealthEntryResult {
  entryId: string
  title: string
  issues: PasswordHealthIssue[]
  strength: PasswordStrengthAssessment
  reuseGroupId?: string
  passwordAge?: PasswordAgeAssessment
}

export interface PasswordReuseGroup {
  id: string
  count: number
  entries: Array<{
    entryId: string
    title: string
  }>
}

export interface PasswordHealthSummary {
  analyzedCount: number
  atRiskCount: number
  missingCount: number
  weakCount: number
  reusedEntryCount: number
  reuseGroupCount: number
  staleCount: number
  averageScore: number
}

export interface PasswordHealthReport {
  summary: PasswordHealthSummary
  entries: PasswordHealthEntryResult[]
  reuseGroups: PasswordReuseGroup[]
  truncated: boolean
  skippedDuplicateIds: number
}

export interface PasswordHealthOptions {
  now?: number
  staleAfterDays?: number | null
  maxEntries?: number
  maxVisitedNodes?: number
  maxDepth?: number
  getPasswordChangedAtMs?: (entry: VaultEntry) => number | undefined
}

interface Candidate {
  entry: VaultEntry
  password: string
  result: PasswordHealthEntryResult
}

const DAY_MS = 86_400_000
const DEFAULT_STALE_AFTER_DAYS = 365
const DEFAULT_MAX_ENTRIES = 10_000
const DEFAULT_MAX_VISITED_NODES = 50_000
const DEFAULT_MAX_DEPTH = 64
const MAX_PASSWORD_CODE_UNITS = 8_192
const MAX_ANALYZED_CODE_POINTS = 4_096

const COMMON_PASSWORDS = new Set([
  '123456', '12345678', '123456789', '111111', '000000', 'abc123', 'admin',
  'iloveyou', 'letmein', 'password', 'password1', 'passw0rd', 'qwerty',
  'qwerty123', 'welcome', 'welcome1'
])

const REASON_ORDER: PasswordWeaknessReason[] = [
  'common-password',
  'too-short',
  'low-diversity',
  'repetitive',
  'sequential',
  'contains-account-data',
  'low-estimated-entropy'
]

const ISSUE_ORDER: PasswordHealthIssue[] = ['missing', 'weak', 'reused', 'stale']

export function analyzePasswordHealth(
  entries: readonly VaultEntry[],
  options: PasswordHealthOptions = {}
): PasswordHealthReport {
  const now = finiteTimestamp(options.now) ?? Date.now()
  const staleAfterDays = options.staleAfterDays === null
    ? null
    : clampFinite(options.staleAfterDays, DEFAULT_STALE_AFTER_DAYS, 1, 36_500)
  const maxEntries = clampInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, 100_000)
  const maxVisitedNodes = clampInteger(options.maxVisitedNodes, DEFAULT_MAX_VISITED_NODES, 1, 500_000)
  const maxDepth = clampInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 512)
  const seenObjects = new WeakSet<object>()
  const seenIds = new Set<string>()
  const candidates: Candidate[] = []
  let visitedNodes = 0
  let skippedDuplicateIds = 0
  let truncated = false

  function visit(items: readonly VaultEntry[], depth: number, ancestorInactive: boolean): void {
    if (depth > maxDepth) {
      if (items.length) truncated = true
      return
    }
    for (const rawEntry of items) {
      if (visitedNodes >= maxVisitedNodes || candidates.length >= maxEntries) {
        truncated = true
        return
      }
      if (!rawEntry || typeof rawEntry !== 'object') continue
      if (seenObjects.has(rawEntry)) {
        truncated = true
        continue
      }
      seenObjects.add(rawEntry)
      visitedNodes += 1

      const inactive = ancestorInactive || !isActive(rawEntry)
      if (!inactive && rawEntry.kind === 'login') {
        const entryId = typeof rawEntry.id === 'string' ? rawEntry.id : ''
        if (seenIds.has(entryId)) {
          skippedDuplicateIds += 1
        } else {
          seenIds.add(entryId)
          const password = typeof rawEntry.password === 'string' ? rawEntry.password : ''
          const strength = estimatePasswordStrength(password, rawEntry)
          const issues: PasswordHealthIssue[] = []
          if (!password.length) issues.push('missing')
          else if (strength.weak) issues.push('weak')
          const passwordAge = password.length
            ? assessPasswordAge(rawEntry, now, staleAfterDays, options.getPasswordChangedAtMs)
            : undefined
          if (passwordAge?.stale) issues.push('stale')
          candidates.push({
            entry: rawEntry,
            password,
            result: {
              entryId,
              title: safeTitle(rawEntry.title),
              issues,
              strength,
              ...(passwordAge ? { passwordAge } : {})
            }
          })
        }
      }

      const children = Array.isArray(rawEntry.children) ? rawEntry.children : []
      if (children.length) visit(children, depth + 1, inactive)
    }
  }

  visit(Array.isArray(entries) ? entries : [], 0, false)
  const reuseGroups = buildReuseGroups(candidates)
  const entriesResult = candidates.map(({ result }) => result).sort(compareEntryResults)
  const missingCount = entriesResult.filter((item) => item.issues.includes('missing')).length
  const weakCount = entriesResult.filter((item) => item.issues.includes('weak')).length
  const reusedEntryCount = entriesResult.filter((item) => item.issues.includes('reused')).length
  const staleCount = entriesResult.filter((item) => item.issues.includes('stale')).length
  const scoreTotal = entriesResult.reduce((sum, item) => sum + item.strength.score, 0)

  return {
    summary: {
      analyzedCount: entriesResult.length,
      atRiskCount: entriesResult.filter((item) => item.issues.length > 0).length,
      missingCount,
      weakCount,
      reusedEntryCount,
      reuseGroupCount: reuseGroups.length,
      staleCount,
      averageScore: entriesResult.length ? round(scoreTotal / entriesResult.length, 2) : 0
    },
    entries: entriesResult,
    reuseGroups,
    truncated,
    skippedDuplicateIds
  }
}

export function estimatePasswordStrength(
  password: string,
  entry?: Pick<VaultEntry, 'title' | 'username' | 'email' | 'domains'>
): PasswordStrengthAssessment {
  if (typeof password !== 'string' || password.length === 0) {
    return {
      score: 0,
      estimatedEntropyBits: 0,
      analyzedLength: 0,
      inputTruncated: false,
      weak: true,
      reasons: ['too-short', 'low-estimated-entropy']
    }
  }

  const inputTruncated = password.length > MAX_PASSWORD_CODE_UNITS
  const characters = Array.from(password.slice(0, MAX_PASSWORD_CODE_UNITS)).slice(0, MAX_ANALYZED_CODE_POINTS)
  const length = characters.length
  const normalized = characters.join('').toLocaleLowerCase('en-US')
  const uniqueCount = new Set(characters).size
  let poolSize = 0
  if (/[a-z]/.test(normalized)) poolSize += 26
  if (/[A-Z]/.test(characters.join(''))) poolSize += 26
  if (/\d/.test(normalized)) poolSize += 10
  if (/[^\p{L}\p{N}\s]/u.test(normalized)) poolSize += 33
  if (/\s/u.test(normalized)) poolSize += 1
  if (/[^\x00-\x7f]/u.test(normalized)) poolSize += 100
  poolSize = Math.max(poolSize, uniqueCount, 1)

  const reasons = new Set<PasswordWeaknessReason>()
  let entropy = Math.min(256, length * Math.log2(poolSize))
  if (length < 12) reasons.add('too-short')
  if (COMMON_PASSWORDS.has(normalized)) {
    reasons.add('common-password')
    entropy = Math.min(entropy, 8)
  }
  if (uniqueCount <= Math.max(2, Math.floor(length / 5))) {
    reasons.add('low-diversity')
    entropy *= 0.45
  }

  const repeatedUnitLength = findRepeatedUnitLength(characters)
  if (repeatedUnitLength !== null) {
    reasons.add('repetitive')
    entropy = Math.min(
      entropy,
      repeatedUnitLength * Math.log2(poolSize) + Math.log2(Math.max(2, length / repeatedUnitLength))
    )
  }

  const longestSequence = longestAsciiSequence(characters)
  if (longestSequence >= 4) {
    reasons.add('sequential')
    entropy = Math.max(0, entropy - Math.min(28, longestSequence * 2))
  }

  if (containsAccountData(normalized, entry)) {
    reasons.add('contains-account-data')
    entropy = Math.max(0, entropy - 20)
  }

  entropy = Math.max(0, Math.min(256, entropy))
  const score: 0 | 1 | 2 | 3 | 4 = entropy < 20
    ? 0
    : entropy < 36
      ? 1
      : entropy < 60
        ? 2
        : entropy < 80
          ? 3
          : 4
  if (score <= 1) reasons.add('low-estimated-entropy')
  const orderedReasons = REASON_ORDER.filter((reason) => reasons.has(reason))

  return {
    score,
    estimatedEntropyBits: round(entropy, 1),
    analyzedLength: length,
    inputTruncated: inputTruncated || characters.length >= MAX_ANALYZED_CODE_POINTS,
    weak: score <= 1,
    reasons: orderedReasons
  }
}

function buildReuseGroups(candidates: Candidate[]): PasswordReuseGroup[] {
  const passwordGroups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    if (!candidate.password.length) continue
    const group = passwordGroups.get(candidate.password)
    if (group) group.push(candidate)
    else passwordGroups.set(candidate.password, [candidate])
  }

  const groups = [...passwordGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((left, right) => compareRefs(left.result, right.result)))
    .sort((left, right) => right.length - left.length || compareRefs(left[0].result, right[0].result))

  return groups.map((group, index) => {
    const id = `reuse-${index + 1}`
    for (const candidate of group) {
      candidate.result.reuseGroupId = id
      candidate.result.issues.push('reused')
      candidate.result.issues.sort((left, right) => ISSUE_ORDER.indexOf(left) - ISSUE_ORDER.indexOf(right))
    }
    return {
      id,
      count: group.length,
      entries: group.map(({ result }) => ({ entryId: result.entryId, title: result.title }))
    }
  })
}

function assessPasswordAge(
  entry: VaultEntry,
  now: number,
  staleAfterDays: number | null,
  provider?: (entry: VaultEntry) => number | undefined
): PasswordAgeAssessment | undefined {
  let changedAt: number | undefined
  let source: PasswordAgeAssessment['source'] | undefined
  if (provider) {
    try {
      changedAt = finiteTimestamp(provider(entry))
      source = changedAt === undefined ? undefined : 'provided'
    } catch {
      return undefined
    }
  } else {
    const inferred = inferPasswordChangedAtFromHistory(entry)
    changedAt = inferred?.changedAt
    source = inferred?.source
  }
  if (changedAt === undefined || source === undefined || changedAt > now) return undefined
  const ageDays = Math.max(0, Math.floor((now - changedAt) / DAY_MS))
  return {
    changedAt,
    ageDays,
    source,
    stale: staleAfterDays !== null && ageDays >= staleAfterDays
  }
}

function inferPasswordChangedAtFromHistory(
  entry: VaultEntry
): Pick<PasswordAgeAssessment, 'changedAt' | 'source'> | undefined {
  if (!Array.isArray(entry.history) || typeof entry.password !== 'string') return undefined
  const history = entry.history
    .map((item) => ({ item, at: normalizeHistoryTimestamp(item?.at) }))
    .filter((value): value is { item: NonNullable<VaultEntry['history']>[number]; at: number } => value.at !== undefined)
    .sort((left, right) => right.at - left.at || String(left.item.id).localeCompare(String(right.item.id)))

  for (const { item, at } of history) {
    if (item.action === 'updated' && typeof item.snapshot?.password === 'string' && item.snapshot.password !== entry.password) {
      return { changedAt: at, source: 'history-change' }
    }
  }
  const created = history.find(({ item }) =>
    item.action === 'created' && item.snapshot?.password === entry.password
  )
  return created ? { changedAt: created.at, source: 'history-created' } : undefined
}

function containsAccountData(
  normalizedPassword: string,
  entry?: Pick<VaultEntry, 'title' | 'username' | 'email' | 'domains'>
): boolean {
  if (!entry) return false
  const values = [entry.title, entry.username, entry.email, ...(Array.isArray(entry.domains) ? entry.domains : [])]
  for (const value of values) {
    if (typeof value !== 'string') continue
    for (const token of value.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/u)) {
      if (token.length >= 4 && normalizedPassword.includes(token)) return true
    }
  }
  return false
}

function findRepeatedUnitLength(characters: string[]): number | null {
  const length = characters.length
  for (let unitLength = 1; unitLength <= Math.min(64, Math.floor(length / 2)); unitLength += 1) {
    if (length % unitLength !== 0) continue
    let repeated = true
    for (let index = unitLength; index < length; index += 1) {
      if (characters[index] !== characters[index % unitLength]) {
        repeated = false
        break
      }
    }
    if (repeated) return unitLength
  }
  return null
}

function longestAsciiSequence(characters: string[]): number {
  let longest = 1
  let ascending = 1
  let descending = 1
  for (let index = 1; index < characters.length; index += 1) {
    const current = characters[index].toLocaleLowerCase('en-US').codePointAt(0) ?? -1
    const previous = characters[index - 1].toLocaleLowerCase('en-US').codePointAt(0) ?? -1
    const bothAsciiAlphaNumeric = isAsciiAlphaNumeric(current) && isAsciiAlphaNumeric(previous)
    ascending = bothAsciiAlphaNumeric && current - previous === 1 ? ascending + 1 : 1
    descending = bothAsciiAlphaNumeric && previous - current === 1 ? descending + 1 : 1
    longest = Math.max(longest, ascending, descending)
  }
  return longest
}

function isAsciiAlphaNumeric(codePoint: number): boolean {
  return (codePoint >= 48 && codePoint <= 57) || (codePoint >= 97 && codePoint <= 122)
}

function compareEntryResults(left: PasswordHealthEntryResult, right: PasswordHealthEntryResult): number {
  const leftRisk = entryRiskRank(left)
  const rightRisk = entryRiskRank(right)
  return rightRisk - leftRisk || compareRefs(left, right)
}

function entryRiskRank(entry: PasswordHealthEntryResult): number {
  if (entry.issues.includes('missing')) return 5
  if (entry.issues.includes('weak')) return 4
  if (entry.issues.includes('reused')) return 3
  if (entry.issues.includes('stale')) return 2
  return 1
}

function compareRefs(
  left: Pick<PasswordHealthEntryResult, 'entryId' | 'title'>,
  right: Pick<PasswordHealthEntryResult, 'entryId' | 'title'>
): number {
  return left.title.localeCompare(right.title, 'zh-CN') || left.entryId.localeCompare(right.entryId, 'en')
}

function normalizeHistoryTimestamp(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return finiteTimestamp(numeric < 100_000_000_000 ? numeric * 1000 : numeric)
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isActive(entry: VaultEntry): boolean {
  return entry.status === undefined || entry.status === 'active'
}

function safeTitle(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 512) : ''
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(clampFinite(value, fallback, minimum, maximum))))
}

function clampFinite(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, numeric))
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits
  return Math.round(value * multiplier) / multiplier
}
