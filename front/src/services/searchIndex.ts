import type { EntryFilterMode, EntryFilterPreferences } from './entryWorkspace.ts'
import type { QuickAccessPreferences } from './quickAccess.ts'
import type { VaultEntry } from '../types'

type SearchRecord = {
  id: string
  parentId: string
  kind: VaultEntry['kind']
  entry: VaultEntry
  title: string
  accounts: string[]
  domains: string[]
  secondary: string[]
  treeRank: number
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

export class VaultSearchIndex {
  private readonly records: SearchRecord[]
  private readonly byId = new Map<string, SearchRecord>()
  private readonly childrenByParent = new Map<string, SearchRecord[]>()

  constructor(entries: VaultEntry[]) {
    const records: SearchRecord[] = []
    let treeRank = 0

    const visit = (items: VaultEntry[], parentId: string, ancestorActive: boolean) => {
      for (const entry of items) {
        const active = ancestorActive && entry.status !== 'disabled' && entry.status !== 'trashed'
        if (!active) continue

        const record: SearchRecord = {
          id: entry.id,
          parentId,
          kind: entry.kind,
          entry,
          title: normalizeText(entry.title),
          accounts: [entry.username, entry.email, entry.phone].map(normalizeText).filter(Boolean),
          domains: (entry.domains || []).map(normalizeText).filter(Boolean),
          secondary: [
            entry.note,
            ...(entry.customFields || [])
              .filter((field) => !field.protected && field.type !== 'secret')
              .flatMap((field) => [field.label, field.value])
          ].map(normalizeText).filter(Boolean),
          treeRank
        }
        records.push(record)
        this.byId.set(record.id, record)
        const siblings = this.childrenByParent.get(parentId) || []
        siblings.push(record)
        this.childrenByParent.set(parentId, siblings)
        treeRank += entry.kind === 'folder' ? 0 : 1
        if (entry.kind === 'folder') visit(entry.children || [], entry.id, active)
      }
    }

    visit(entries, '', true)
    this.records = records
  }

  filter(term = '', mode: EntryFilterMode = 'all', preferences: EntryFilterPreferences = {}) {
    const query = normalizeText(term)
    const recentRanks = new Map((preferences.recentIds || []).map((id, index) => [id, index]))
    const includedIds = new Set<string>()

    for (const record of this.records) {
      if (matchesFilterMode(record, mode, preferences) && matchesSearchTerm(record, query)) {
        this.includeWithAncestors(record.id, includedIds)
      }
    }

    return this.rebuildTree(includedIds, mode === 'recent' ? recentRanks : undefined)
  }

  quickAccess(term = '', preferences: QuickAccessPreferences = {}) {
    const query = normalizeText(term)
    const recentRanks = new Map((preferences.recentIds || []).map((id, index) => [id, index]))
    const ranked: RankedEntry[] = []

    for (const record of this.records) {
      if (record.kind === 'folder') continue
      const relevance = quickAccessRelevance(record, query)
      if (relevance === Number.POSITIVE_INFINITY) continue
      ranked.push({
        entry: record.entry,
        relevance,
        favoriteRank: preferences.favoriteIds?.has(record.id) ? 0 : 1,
        recentRank: recentRanks.get(record.id) ?? Number.POSITIVE_INFINITY,
        treeRank: record.treeRank
      })
    }

    const limit = Math.min(Math.max(1, Math.floor(preferences.limit || DEFAULT_RESULT_LIMIT)), MAX_RESULT_LIMIT)
    return ranked.sort(compareQuickAccessEntries).slice(0, limit).map((item) => item.entry)
  }

  private includeWithAncestors(entryId: string, includedIds: Set<string>) {
    let current = this.byId.get(entryId)
    while (current) {
      if (includedIds.has(current.id)) return
      includedIds.add(current.id)
      current = current.parentId ? this.byId.get(current.parentId) : undefined
    }
  }

  private rebuildTree(includedIds: ReadonlySet<string>, recentRanks?: ReadonlyMap<string, number>) {
    const rebuild = (parentId: string): VaultEntry[] => {
      const childRecords = (this.childrenByParent.get(parentId) || [])
        .filter((record) => includedIds.has(record.id))
      const children = childRecords.map((record) => record.kind === 'folder'
          ? { ...record.entry, children: rebuild(record.id) }
          : record.entry)
      if (!recentRanks) return children
      return children.sort((left, right) => this.recentEntryRank(left.id, recentRanks) - this.recentEntryRank(right.id, recentRanks))
    }

    return rebuild('')
  }

  private recentEntryRank(entryId: string, recentRanks: ReadonlyMap<string, number>): number {
    const directRank = recentRanks.get(entryId)
    if (directRank !== undefined) return directRank
    const record = this.byId.get(entryId)
    if (!record || record.kind !== 'folder') return Number.POSITIVE_INFINITY
    return Math.min(
      ...(this.childrenByParent.get(entryId) || []).map((child) => this.recentEntryRank(child.id, recentRanks)),
      Number.POSITIVE_INFINITY
    )
  }
}

export function buildVaultSearchIndex(entries: VaultEntry[]) {
  return new VaultSearchIndex(entries)
}

function matchesFilterMode(record: SearchRecord, mode: EntryFilterMode, preferences: EntryFilterPreferences) {
  if (mode === 'favorites') return Boolean(preferences.favoriteIds?.has(record.id))
  if (mode === 'recent') return Boolean(preferences.recentIds?.includes(record.id))
  if (mode === 'login') return record.kind === 'login'
  if (mode === 'other') return record.kind !== 'login' && record.kind !== 'folder'
  if (mode === 'folder') return record.kind === 'folder'
  if (mode === 'totp') return record.kind === 'login' && Boolean(record.entry.totpSecret)
  return true
}

function matchesSearchTerm(record: SearchRecord, query: string) {
  if (!query) return true
  return [record.title, ...record.accounts, ...record.domains, ...record.secondary]
    .some((value) => value.includes(query))
}

function quickAccessRelevance(record: SearchRecord, query: string) {
  if (!query) return 0
  if (record.title === query) return 0
  if (record.title.startsWith(query)) return 1
  if (record.accounts.some((value) => value === query)) return 2
  if (record.accounts.some((value) => value.startsWith(query))) return 3
  if (record.domains.some((value) => value === query)) return 4
  if (record.domains.some((value) => value.startsWith(query))) return 5
  if (record.title.includes(query)) return 6
  if (record.accounts.some((value) => value.includes(query))) return 7
  if (record.domains.some((value) => value.includes(query))) return 8
  if (record.secondary.some((value) => value.includes(query))) return 9
  return Number.POSITIVE_INFINITY
}

function compareQuickAccessEntries(left: RankedEntry, right: RankedEntry) {
  return left.relevance - right.relevance
    || left.favoriteRank - right.favoriteRank
    || left.recentRank - right.recentRank
    || normalizeText(left.entry.title).localeCompare(normalizeText(right.entry.title), 'zh-CN')
    || left.treeRank - right.treeRank
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}
