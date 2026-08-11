import type { VaultEntry } from '../types'

export type QuickAccessPreferences = {
  favoriteIds?: ReadonlySet<string>
  recentIds?: readonly string[]
  limit?: number
}

type RankedEntry = {
  entry: VaultEntry
  relevance: number
  favoriteRank: number
  recentRank: number
  treeRank: number
}

const DEFAULT_RESULT_LIMIT = 12
const MAX_RESULT_LIMIT = 50

export function searchQuickAccessEntries(
  entries: VaultEntry[],
  term = '',
  preferences: QuickAccessPreferences = {}
): VaultEntry[] {
  const query = normalizeText(term)
  const recentRanks = new Map((preferences.recentIds || []).map((id, index) => [id, index]))
  const ranked: RankedEntry[] = []
  let treeRank = 0

  function visit(items: VaultEntry[], ancestorActive: boolean) {
    for (const entry of items) {
      const active = ancestorActive && (!entry.status || entry.status === 'active')
      if (active && entry.kind !== 'folder') {
        const relevance = quickAccessRelevance(entry, query)
        if (relevance !== Number.POSITIVE_INFINITY) {
          ranked.push({
            entry,
            relevance,
            favoriteRank: preferences.favoriteIds?.has(entry.id) ? 0 : 1,
            recentRank: recentRanks.get(entry.id) ?? Number.POSITIVE_INFINITY,
            treeRank
          })
        }
        treeRank += 1
      }
      visit(entry.children || [], active)
    }
  }

  visit(entries, true)
  const limit = Math.min(Math.max(1, Math.floor(preferences.limit || DEFAULT_RESULT_LIMIT)), MAX_RESULT_LIMIT)
  return ranked
    .sort(compareQuickAccessEntries)
    .slice(0, limit)
    .map((item) => item.entry)
}

function compareQuickAccessEntries(left: RankedEntry, right: RankedEntry) {
  return left.relevance - right.relevance
    || left.favoriteRank - right.favoriteRank
    || left.recentRank - right.recentRank
    || normalizeText(left.entry.title).localeCompare(normalizeText(right.entry.title), 'zh-CN')
    || left.treeRank - right.treeRank
}

function quickAccessRelevance(entry: VaultEntry, query: string) {
  if (!query) return 0
  const title = normalizeText(entry.title)
  const accounts = [entry.username, entry.email, entry.phone].map(normalizeText).filter(Boolean)
  const domains = (entry.domains || []).map(normalizeText).filter(Boolean)
  const secondary = [
    entry.note,
    ...(entry.customFields || [])
      .filter((field) => !field.protected && field.type !== 'secret')
      .flatMap((field) => [field.label, field.value])
  ].map(normalizeText).filter(Boolean)

  if (title === query) return 0
  if (title.startsWith(query)) return 1
  if (accounts.some((value) => value === query)) return 2
  if (accounts.some((value) => value.startsWith(query))) return 3
  if (domains.some((value) => value === query)) return 4
  if (domains.some((value) => value.startsWith(query))) return 5
  if (title.includes(query)) return 6
  if (accounts.some((value) => value.includes(query))) return 7
  if (domains.some((value) => value.includes(query))) return 8
  if (secondary.some((value) => value.includes(query))) return 9
  return Number.POSITIVE_INFINITY
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}
