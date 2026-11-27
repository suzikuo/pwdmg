import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import type { SystemGroupKey } from '../composables/useSettingsPanel.ts'
import { api } from '../services/api.ts'
import { MAX_ATTACHMENT_BYTES } from '../services/attachmentCrypto.ts'
import { normalizeAutofillMatchMode, normalizeAutofillRuleValues } from '../services/autofillRules.ts'
import { copySensitiveText } from '../services/clipboardSecurity.ts'
import {
  collectEntryIds,
  moveSelectedEntries,
  normalizeSelectedRootIds,
  removeSelectedEntries
} from '../services/entryBatchOperations.ts'
import { insertDuplicateEntry } from '../services/entryDuplication.ts'
import {
  buildEntryHistoryChanges,
  clearEntryHistoryRecords,
  createEntrySnapshot,
  limitEntryHistory,
  restoreEntrySnapshot,
  shouldRecordEntryHistory
} from '../services/entryHistory.ts'
import { entryKindLabel, starterCustomFields } from '../services/entryKinds.ts'
import {
  loadFavoriteEntryIds,
  loadRecentEntryIds,
  pruneEntryPreferenceIds,
  rememberRecentEntryId,
  setFavoriteEntryIds,
  toggleFavoriteEntryId
} from '../services/entryListPreferences.ts'
import { removeTrashedEntries } from '../services/entryTrash.ts'
import { recordPermanentEntryDeletions } from '../services/entryTombstones.ts'
import { filterVaultEntries, type EntryFilterMode } from '../services/entryWorkspace.ts'
import {
  clearIgnoredHealthFindingsForEntry,
  healthFindingKey,
  ignoreHealthFinding,
  loadExpectedTotpEntryIds,
  loadIgnoredHealthFindings,
  pruneHealthPreferences,
  restoreHealthFinding,
  setExpectedTotpEntryId
} from '../services/healthPreferences.ts'
import { updatePasskeyMetadata } from '../services/passkeyManagement.ts'
import { buildPasskeyLoginOptions, buildPasskeyPresentationItems } from '../services/passkeyPresentation.ts'
import { analyzePasswordHealth, type PasswordHealthIssue } from '../services/passwordHealth.ts'
import { parseQrPayload } from '../services/qrPayload.ts'
import {
  androidBridgeCall,
  formatUnixTime,
  isAndroidRuntime,
  isDesktopRuntime,
  noopUiFeedback,
  type UiFeedback
} from '../services/runtime.ts'
import { buildVaultSearchIndex, type VaultSearchIndex } from '../services/searchIndex.ts'
import { secureRandomId } from '../services/secureRandom.ts'
import { findEntryById, flattenEntries } from '../services/shared/entryTree.ts'
import { collectAttachmentReferences } from '../services/sync/attachmentObjectSync.ts'
import { generateTotp, readTotpPeriod } from '../services/totp.ts'
import type { ImportedVaultRecord } from '../services/vaultImport.ts'
import type { CssVars, UiStore } from './uiStore.ts'
import type {
  ApiResult,
  AttachmentStorageState,
  AutofillMatchMode,
  EntryHistoryAction,
  EntryKind,
  EntryStatus,
  LoginAccountSource,
  VaultAttachment,
  VaultEntry,
  VaultPayload
} from '../types.ts'

export type MoveEntryPayload = {
  entryId: string
  targetParentId: string
  targetIndex: number
}

export type AndroidAutofillLaunchContext = {
  active: boolean
  target?: string
  searchTerm?: string
  includeAll?: boolean
}

export type SidebarView = 'all' | 'favorites' | 'recent' | 'archived' | 'trash' | 'folder'

export type SidebarCounts = {
  all: number
  favorites: number
  recent: number
  archived: number
  trash: number
  healthIssues: number
  passkeys: number
}

export type SystemGroupInfo = {
  key: SystemGroupKey
  title: string
  description: string
  emptyText: string
  icon: string
  count: number
}

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])
const TOTP_PERIOD_SECONDS = 30

export const loginAccountSourceOptions: Array<{ label: string; value: LoginAccountSource }> = [
  { label: '自动', value: 'auto' },
  { label: '账号', value: 'username' },
  { label: '邮箱', value: 'email' },
  { label: '手机', value: 'phone' }
]

export const autofillMatchModeOptions: Array<{ label: string; value: AutofillMatchMode }> = [
  { label: '根域及子域', value: 'base-domain' },
  { label: '仅精确主机', value: 'exact-host' },
  { label: '仅下级子域', value: 'subdomain' },
  { label: 'URL 前缀', value: 'url-prefix' },
  { label: '永不填充', value: 'never' }
]

// ---- Pure Entry Tree & Normalization Helpers ----

export function makeEntryId(): string {
  return secureRandomId()
}

export function normalizeLoginAccountSource(value: unknown): LoginAccountSource {
  return typeof value === 'string' && LOGIN_ACCOUNT_SOURCES.has(value as LoginAccountSource)
    ? (value as LoginAccountSource)
    : 'auto'
}

export function normalizeEntryStatus(value: unknown): EntryStatus {
  return typeof value === 'string' && ENTRY_STATUSES.has(value as EntryStatus)
    ? (value as EntryStatus)
    : 'active'
}

export function emptyEntry(kind: EntryKind): VaultEntry {
  return {
    id: makeEntryId(),
    kind,
    title: '',
    status: 'active',
    statusReason: '',
    statusUpdatedAt: 0,
    deletedAt: 0,
    domains: [],
    autofillMatchMode: 'base-domain',
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    customFields: starterCustomFields(kind, makeEntryId),
    attachments: [],
    history: [],
    children: []
  }
}

export function isActiveEntry(entry: VaultEntry): boolean {
  return normalizeEntryStatus(entry.status) === 'active'
}

export function activeTree(entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter(isActiveEntry)
    .map((entry) => entry.kind === 'folder' ? { ...entry, children: activeTree(entry.children || []) } : entry)
}

export function collectSystemGroupEntries(
  entries: VaultEntry[],
  status: EntryStatus,
  ancestorHidden = false
): VaultEntry[] {
  const result: VaultEntry[] = []
  for (const entry of entries) {
    const entryStatus = normalizeEntryStatus(entry.status)
    if (!ancestorHidden && entryStatus === status) result.push(entry)
    const nextAncestorHidden = ancestorHidden || entryStatus !== 'active'
    result.push(...collectSystemGroupEntries(entry.children || [], status, nextAncestorHidden))
  }
  return result
}

export function isDescendant(entry: VaultEntry, targetEntryId: string): boolean {
  if (!targetEntryId) return false
  for (const child of entry.children || []) {
    if (child.id === targetEntryId || isDescendant(child, targetEntryId)) return true
  }
  return false
}

function appendEntryHistory(
  entry: VaultEntry,
  action: EntryHistoryAction,
  note = '',
  snapshotSource: VaultEntry = entry
): void {
  const history = Array.isArray(entry.history) ? entry.history : []
  const changes = action === 'created' ? [] : buildEntryHistoryChanges(snapshotSource, entry)
  if (!shouldRecordEntryHistory(action, changes.length)) {
    entry.history = limitEntryHistory(history)
    return
  }
  history.unshift({
    id: makeEntryId(),
    action,
    at: Math.floor(Date.now() / 1000),
    title: snapshotSource.title || '',
    username: snapshotSource.username || '',
    email: snapshotSource.email || '',
    phone: snapshotSource.phone || '',
    domains: [...(snapshotSource.domains || [])],
    note,
    changes,
    snapshot: createEntrySnapshot(snapshotSource)
  })
  entry.history = limitEntryHistory(history)
}

function markEntrySelfStatus(entry: VaultEntry, status: EntryStatus, reason = ''): void {
  const previous = createEntrySnapshot(entry)
  const now = Math.floor(Date.now() / 1000)
  const nextStatus = normalizeEntryStatus(status)
  entry.status = nextStatus
  entry.statusReason = nextStatus === 'active' ? '' : reason
  entry.statusUpdatedAt = now
  entry.deletedAt = nextStatus === 'trashed' ? now : 0
  appendEntryHistory(entry, nextStatus === 'active' ? 'restored' : nextStatus, reason, previous)
}

function markEntryStatus(entry: VaultEntry, status: EntryStatus, reason = ''): void {
  markEntrySelfStatus(entry, status, reason)
  for (const child of entry.children || []) markEntryStatus(child, status, reason)
}

function updateEntryById(entries: VaultEntry[], entryId: string, updater: (entry: VaultEntry) => void): boolean {
  for (const entry of entries) {
    if (entry.id === entryId) {
      updater(entry)
      return true
    }
    if (updateEntryById(entry.children || [], entryId, updater)) return true
  }
  return false
}

function updateEntryAndAncestorsById(
  entries: VaultEntry[],
  entryId: string,
  updater: (entry: VaultEntry) => void,
  ancestorUpdater: (entry: VaultEntry) => void
): boolean {
  for (const entry of entries) {
    if (entry.id === entryId) {
      updater(entry)
      return true
    }
    if (updateEntryAndAncestorsById(entry.children || [], entryId, updater, ancestorUpdater)) {
      ancestorUpdater(entry)
      return true
    }
  }
  return false
}

function replaceEntry(entries: VaultEntry[], entryId: string, next: VaultEntry): boolean {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].id === entryId) {
      next.id = entryId
      if (next.kind === 'folder') next.children = entries[index].children || next.children || []
      entries[index] = next
      return true
    }
    if (replaceEntry(entries[index].children || [], entryId, next)) return true
  }
  return false
}

function insertEntryIntoParent(entries: VaultEntry[], parentId: string, entry: VaultEntry): boolean {
  for (const item of entries) {
    if (item.id === parentId && item.kind === 'folder') {
      item.children = item.children || []
      item.children.unshift(entry)
      return true
    }
    if (item.children && insertEntryIntoParent(item.children, parentId, entry)) return true
  }
  return false
}

function insertEntry(entries: VaultEntry[], parentId: string, entry: VaultEntry): boolean {
  if (!parentId) {
    entries.unshift(entry)
    return true
  }
  if (insertEntryIntoParent(entries, parentId, entry)) return true
  entries.unshift(entry)
  return false
}

function removeEntry(entries: VaultEntry[], entryId: string): boolean {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    entries.splice(index, 1)
    return true
  }
  return entries.some((entry) => removeEntry(entry.children || [], entryId))
}

function removeEntryCopies(entries: VaultEntry[], entryId: string): void {
  while (removeEntry(entries, entryId)) {
    // Keep removing stale duplicate IDs left by older drag operations.
  }
}

function takeEntry(entries: VaultEntry[], entryId: string, parentId = ''): { entry: VaultEntry; parentId: string; index: number } | null {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    const [entry] = entries.splice(index, 1)
    return { entry, parentId, index }
  }
  for (const entry of entries) {
    const result = takeEntry(entry.children || [], entryId, entry.id)
    if (result) return result
  }
  return null
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, index), length)
}

function insertEntryAtParent(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  for (const item of entries) {
    if (item.id === parentId && item.kind === 'folder') {
      item.children = item.children || []
      item.children.splice(clampIndex(targetIndex, item.children.length), 0, entry)
      return true
    }
    if (item.children && insertEntryAtParent(item.children, parentId, entry, targetIndex)) return true
  }
  return false
}

function insertEntryAt(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  if (!parentId) {
    entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
    return true
  }
  if (insertEntryAtParent(entries, parentId, entry, targetIndex)) return true
  entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
  return false
}

function vaultReferencesAttachment(entries: VaultEntry[], attachmentId: string): boolean {
  return flattenEntries(entries).some((entry) =>
    (entry.attachments || []).some((attachment) => attachment.id === attachmentId)
  )
}

function collectAncestorFolderIds(entries: VaultEntry[], targetId: string, path: string[] = []): string[] | null {
  for (const entry of entries) {
    if (entry.id === targetId) return path
    if (entry.kind === 'folder' && entry.children?.length) {
      const found = collectAncestorFolderIds(entry.children, targetId, [...path, entry.id])
      if (found) return found
    }
  }
  return null
}

function entryMatchesSearchTerm(entry: VaultEntry, query: string): boolean {
  if (!query) return true
  const fields = [
    entry.title,
    entry.username,
    entry.email,
    entry.phone,
    entry.note,
    ...(entry.domains || []),
    ...(entry.customFields || [])
      .filter((field) => !field.protected && field.type !== 'secret')
      .flatMap((field) => [field.label, field.value])
  ]
  return fields.some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query))
}

function filterTreeByPredicate(
  entries: VaultEntry[],
  predicate: (entry: VaultEntry) => boolean
): VaultEntry[] {
  const result: VaultEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'folder') {
      const children = filterTreeByPredicate(entry.children || [], predicate)
      if (children.length > 0 || predicate(entry)) {
        result.push({ ...entry, children })
      }
    } else if (predicate(entry)) {
      result.push(entry)
    }
  }
  return result
}

// ---- Vault Store ----

export type VaultStoreDeps = {
  ui: UiStore
  feedback?: UiFeedback
  isLocked: () => boolean
  isUnlocked: () => boolean
  isBusy: () => boolean
  beginBusyOperation: () => number
  finishBusyOperation: (operationId: number) => void
  saveVaultForCurrentSession: (next: VaultPayload) => Promise<ApiResult<VaultPayload>>
  syncSettings?: (nextSettings?: Partial<VaultPayload['settings']>) => void
  scheduleAutoCloudUpload?: () => void
  lockVault?: () => Promise<void>
  safeExit?: () => Promise<void>
}

export function createVaultStore(deps: VaultStoreDeps) {
  const feedback = deps.feedback || noopUiFeedback
  const { ui } = deps

  // Core Vault State
  const vault = ref<VaultPayload | null>(null)
  const vaultSearchIndex = shallowRef<VaultSearchIndex | null>(null)

  // Preferences
  const favoriteEntryIds = ref<Set<string>>(loadFavoriteEntryIds())
  const recentEntryIds = ref<string[]>(loadRecentEntryIds())
  const expectedTotpEntryIds = ref<Set<string>>(loadExpectedTotpEntryIds())
  const ignoredHealthFindings = ref(loadIgnoredHealthFindings())

  // Filter / Selection / Mode State
  const sidebarView = ref<SidebarView>('all')
  const activeFolderId = ref('')
  const expandedFolderIds = ref<Set<string>>(new Set())
  const keyword = ref('')
  const entryFilter = ref<EntryFilterMode>('all')
  const selectedEntry = ref<VaultEntry | null>(null)
  const selectedEntryId = computed(() => selectedEntry.value?.id || '')
  const showPassword = ref(false)
  const dragMode = ref(false)

  // Batch Selection State
  const batchSelectionMode = ref(false)
  const batchSelectedEntryIds = ref<Set<string>>(new Set())

  // Editor State
  const form = reactive<VaultEntry>(emptyEntry('login'))
  const domainText = ref('')
  const editingId = ref('')
  const editingParentId = ref('')
  const wasDetailOpenBeforeEdit = ref(false)
  const qrImageBusy = ref(false)

  // Move & Context Menu State
  const moveEntryId = ref('')
  const contextEntryId = ref('')
  const entryContextMenuX = ref(0)
  const entryContextMenuY = ref(0)

  // Generator / Import / Passkey / Attachment State
  const generatorApplyToPassword = ref(false)
  const generatorResetKey = ref(0)
  const importResetKey = ref(0)
  const passkeyManagerInitialId = ref('')
  const attachmentBusy = ref(false)
  const attachmentStorageBusy = ref(false)
  const attachmentStorageState = ref<AttachmentStorageState | null>(null)
  const androidAutofillLaunch = ref<AndroidAutofillLaunchContext | null>(null)

  // Undo Trash State
  const trashUndoState = ref<{ id: string; title: string; timer: number } | null>(null)

  // Live TOTP Ticker State
  const totpCode = ref('')
  const totpRemaining = ref(TOTP_PERIOD_SECONDS)
  const totpPeriodSeconds = ref(TOTP_PERIOD_SECONDS)
  const totpRequestId = ref(0)
  let totpTimer = 0
  let totpCurrentStep = -1

  // ---- Computed Projections ----
  const activeEntriesTree = computed(() => activeTree(vault.value?.entries || []))

  const sidebarFolders = computed<VaultEntry[]>(() =>
    activeEntriesTree.value.filter((entry) => entry.kind === 'folder')
  )

  const activeFolder = computed<VaultEntry | null>(() => {
    if (sidebarView.value !== 'folder' || !activeFolderId.value) return null
    const found = findEntryById(activeEntriesTree.value, activeFolderId.value)
    return found && found.kind === 'folder' ? found : null
  })

  const filteredEntries = computed(() => {
    const term = keyword.value.trim().toLocaleLowerCase('zh-CN')
    const entries = vault.value?.entries || []
    const view = sidebarView.value

    if (view === 'archived') {
      return collectSystemGroupEntries(entries, 'disabled').filter((entry) => entryMatchesSearchTerm(entry, term))
    }

    if (view === 'trash') {
      return collectSystemGroupEntries(entries, 'trashed').filter((entry) => entryMatchesSearchTerm(entry, term))
    }

    if (view === 'folder') {
      const folder = activeFolder.value
      if (!folder) return []
      return filterVaultEntries(folder.children || [], term, entryFilter.value, {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      })
    }

    if (view === 'favorites') {
      const base = vaultSearchIndex.value?.filter(term, 'favorites', {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      }) || filterVaultEntries(entries, term, 'favorites', {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      })
      if (entryFilter.value === 'all' || entryFilter.value === 'favorites') return base
      return filterVaultEntries(base, term, entryFilter.value, {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      })
    }

    if (view === 'recent') {
      const base = vaultSearchIndex.value?.filter(term, 'recent', {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      }) || filterVaultEntries(entries, term, 'recent', {
        favoriteIds: favoriteEntryIds.value,
        recentIds: recentEntryIds.value
      })
      if (entryFilter.value === 'all' || entryFilter.value === 'recent') return base
      return filterTreeByPredicate(base, (entry) => {
        if (entryFilter.value === 'login') return entry.kind === 'login'
        if (entryFilter.value === 'totp') return entry.kind === 'login' && Boolean(entry.totpSecret)
        if (entryFilter.value === 'other') return entry.kind !== 'login' && entry.kind !== 'folder'
        if (entryFilter.value === 'folder') return entry.kind === 'folder'
        if (entryFilter.value === 'favorites') return favoriteEntryIds.value.has(entry.id)
        return true
      })
    }

    return vaultSearchIndex.value?.filter(term, entryFilter.value, {
      favoriteIds: favoriteEntryIds.value,
      recentIds: recentEntryIds.value
    }) || filterVaultEntries(entries, term, entryFilter.value, {
      favoriteIds: favoriteEntryIds.value,
      recentIds: recentEntryIds.value
    })
  })

  const visibleBatchEntryIds = computed(() => collectEntryIds(filteredEntries.value))
  const allVisibleBatchEntriesSelected = computed(() => {
    const visibleIds = visibleBatchEntryIds.value
    return visibleIds.length > 0 && visibleIds.every((id) => batchSelectedEntryIds.value.has(id))
  })
  const allBatchEntriesFavorited = computed(() => {
    const selectedIds = [...batchSelectedEntryIds.value]
    return selectedIds.length > 0 && selectedIds.every((id) => favoriteEntryIds.value.has(id))
  })

  const passwordMask = computed(() => selectedEntry.value?.password ? '••••••••••••' : '未设置')
  const totpProgress = computed(() => Math.round((totpRemaining.value / totpPeriodSeconds.value) * 100))

  const stats = computed(() => {
    const flat = flattenEntries(vault.value?.entries || [])
    const active = flat.filter(isActiveEntry)
    return {
      items: active.filter((entry) => entry.kind !== 'folder').length,
      logins: active.filter((entry) => entry.kind === 'login').length,
      folders: active.filter((entry) => entry.kind === 'folder').length,
      totp: active.filter((entry) => entry.kind === 'login' && entry.totpSecret).length,
      archived: collectSystemGroupEntries(vault.value?.entries || [], 'disabled').length,
      trashed: collectSystemGroupEntries(vault.value?.entries || [], 'trashed').length
    }
  })

  const systemGroups = computed<SystemGroupInfo[]>(() => [
    {
      key: 'archived',
      title: '已归档',
      description: '隐藏但保留原分组位置，恢复后回到原处',
      emptyText: '没有归档条目',
      icon: 'closed-eye',
      count: stats.value.archived
    },
    {
      key: 'trashed',
      title: '回收站',
      description: '准备删除的条目，彻底删除前还能恢复',
      emptyText: '回收站为空',
      icon: 'delete-o',
      count: stats.value.trashed
    }
  ])

  const currentSystemGroup = computed(() => (
    systemGroups.value.find((group) => group.key === ui.systemGroupKey.value) || systemGroups.value[0]
  ))

  const systemGroupEntries = computed(() => {
    const status: EntryStatus = ui.systemGroupKey.value === 'archived' ? 'disabled' : 'trashed'
    return collectSystemGroupEntries(vault.value?.entries || [], status)
  })

  // Passkey projections
  const passkeyPresentationItems = computed(() => buildPasskeyPresentationItems(
    vault.value?.passkeys || [],
    vault.value?.entries || []
  ))
  const passkeyLoginOptions = computed(() => buildPasskeyLoginOptions(vault.value?.entries || []))
  const selectedEntryPasskeys = computed(() => {
    const entryId = selectedEntry.value?.kind === 'login' ? selectedEntry.value.id : ''
    return entryId
      ? passkeyPresentationItems.value.filter((item) => item.linkedEntryId === entryId)
      : []
  })

  // Password Health projections
  const passwordHealthReport = computed(() => analyzePasswordHealth(vault.value?.entries || [], {
    totpExpectedIds: expectedTotpEntryIds.value
  }))
  const passwordHealthPendingEntryCount = computed(() => new Set(
    passwordHealthReport.value.entries.flatMap((entry) => entry.issues
      .filter((issue) => !ignoredHealthFindings.value.has(healthFindingKey(entry.entryId, issue)))
      .map(() => entry.entryId))
  ).size)
  const passwordHealthSettingsLabel = computed(() => {
    const summary = passwordHealthReport.value.summary
    if (!summary.scannedEntryCount) return '暂无可检查条目'
    return passwordHealthPendingEntryCount.value
      ? `${passwordHealthPendingEntryCount.value} 项需处理`
      : `已检查 ${summary.scannedEntryCount} 项`
  })
  const passwordHealthScoreLabel = computed(() => {
    const summary = passwordHealthReport.value.summary
    return summary.analyzedCount ? `${summary.averageScore.toFixed(1)} / 4` : '-'
  })

  const sidebarCounts = computed<SidebarCounts>(() => {
    const activeItems = flattenEntries(activeEntriesTree.value).filter((entry) => entry.kind !== 'folder')
    const activeIds = new Set(activeItems.map((entry) => entry.id))
    return {
      all: activeItems.length,
      favorites: activeItems.filter((entry) => favoriteEntryIds.value.has(entry.id)).length,
      recent: recentEntryIds.value.filter((id) => activeIds.has(id)).length,
      archived: stats.value.archived,
      trash: stats.value.trashed,
      healthIssues: passwordHealthPendingEntryCount.value,
      passkeys: passkeyPresentationItems.value.length
    }
  })

  // ---- Sidebar View & Folder Expansion ----
  function selectSidebarView(view: SidebarView): void {
    sidebarView.value = view
    if (view !== 'folder') activeFolderId.value = ''
    if (view === 'archived' || view === 'trash') {
      dragMode.value = false
      exitBatchSelection()
    }
    if (!ui.isWide.value) ui.mobileNavOpen.value = false
  }

  function selectSidebarFolder(folderId: string): void {
    sidebarView.value = 'folder'
    activeFolderId.value = folderId
    if (!ui.isWide.value) ui.mobileNavOpen.value = false
  }

  function toggleFolderExpanded(folderId: string): void {
    if (!folderId) return
    const next = new Set(expandedFolderIds.value)
    if (next.has(folderId)) next.delete(folderId)
    else next.add(folderId)
    expandedFolderIds.value = next
  }

  function expandFolder(folderId: string): void {
    if (!folderId) return
    const next = new Set(expandedFolderIds.value)
    next.add(folderId)
    const ancestors = collectAncestorFolderIds(vault.value?.entries || [], folderId)
    if (ancestors) {
      for (const ancestorId of ancestors) next.add(ancestorId)
    }
    expandedFolderIds.value = next
  }

  // Restored orphaned tool entries in moreActions (QuickAccess, CredentialGenerator, ImportWizard)
  const moreActions = computed(() => [
    { text: '快速访问', icon: 'search', key: 'quick-access' },
    { text: '密码生成器', icon: 'shield-o', key: 'generator' },
    { text: '导入数据', icon: 'upgrade', key: 'import' },
    {
      text: batchSelectionMode.value ? '退出批量选择' : '批量选择',
      icon: 'passed',
      key: 'select'
    },
    {
      text: dragMode.value ? '退出拖拽模式' : '拖拽模式',
      icon: 'sort',
      key: 'drag'
    },
    { text: '锁定', icon: 'lock', key: 'lock' }
  ])

  const entryContextActions = computed(() => {
    const entry = findEntryById(vault.value?.entries || [], contextEntryId.value)
    if (!entry) return []
    if (entry.status === 'trashed') {
      return [
        { name: '恢复', key: 'restore', color: '#0f766e' },
        { name: '彻底删除', key: 'purge', color: '#ee0a24' }
      ]
    }
    const actions: Array<{ name: string; key: string; color?: string }> = []
    if (entry.kind === 'folder') {
      actions.push(
        { name: '新建登录', key: 'create-login' },
        { name: '新建分组', key: 'create-folder' },
        { name: '创建副本', key: 'duplicate' },
        { name: '编辑分组', key: 'edit' },
        { name: '移动到', key: 'move' },
        { name: '归档分组', key: 'archive', color: '#ee0a24' },
        { name: '移入回收站', key: 'trash', color: '#ee0a24' }
      )
    } else {
      const label = entryKindLabel(entry.kind)
      actions.push(
        { name: '创建副本', key: 'duplicate' },
        { name: `编辑${label}`, key: 'edit' },
        { name: '移动到', key: 'move' },
        { name: `归档${label}`, key: 'archive', color: '#ee0a24' },
        { name: '移入回收站', key: 'trash', color: '#ee0a24' }
      )
    }
    return actions
  })

  const entryContextMenuStyle = computed<CssVars>(() => ({
    left: `${entryContextMenuX.value}px`,
    top: `${entryContextMenuY.value}px`
  }))

  const moveModalMovingEntryIds = computed<string[]>(() => {
    if (ui.batchMoveSheetOpen.value) return [...batchSelectedEntryIds.value]
    if (moveEntryId.value) return [moveEntryId.value]
    return []
  })

  const moveModalSubtitle = computed<string>(() => {
    if (ui.batchMoveSheetOpen.value) {
      return `已选 ${batchSelectedEntryIds.value.size} 个条目`
    }
    if (moveEntryId.value) {
      const entry = findEntryById(vault.value?.entries || [], moveEntryId.value)
      if (entry) return `正在移动「${entry.title}」`
    }
    return ''
  })

  // ---- Watchers ----
  watch(ui.entryContextMenuOpen, (open) => {
    if (!open) contextEntryId.value = ''
  })
  watch(() => [keyword.value, entryFilter.value], ([value, filter]) => {
    if (String(value).trim() || filter !== 'all') dragMode.value = false
  })
  watch(() => [selectedEntry.value?.id, selectedEntry.value?.totpSecret], syncSelectedTotpTimer)

  // ---- Vault Publication & Persistence Helpers ----
  function cloneVault(): VaultPayload {
    return JSON.parse(JSON.stringify(vault.value))
  }

  function pruneBatchEntrySelection(entries: VaultEntry[]): void {
    if (!batchSelectionMode.value) return
    const validIds = new Set(collectEntryIds(activeTree(entries)))
    batchSelectedEntryIds.value = new Set([...batchSelectedEntryIds.value].filter((id) => validIds.has(id)))
  }

  function pruneLocalEntryPreferences(entries: VaultEntry[]): void {
    const activeEntries = flattenEntries(activeTree(entries))
    const validIds = new Set(activeEntries.map((entry) => entry.id))
    const validLoginIds = new Set(activeEntries.filter((entry) => entry.kind === 'login').map((entry) => entry.id))
    const next = pruneEntryPreferenceIds(validIds, favoriteEntryIds.value, recentEntryIds.value)
    favoriteEntryIds.value = next.favoriteIds
    recentEntryIds.value = next.recentIds
    const health = pruneHealthPreferences(
      validIds,
      validLoginIds,
      expectedTotpEntryIds.value,
      ignoredHealthFindings.value
    )
    expectedTotpEntryIds.value = health.expectedTotpIds
    ignoredHealthFindings.value = health.ignoredFindings
  }

  async function collectLocalAttachmentObjects(payload: VaultPayload): Promise<void> {
    const ids = collectAttachmentReferences(payload.entries).map((reference) => reference.id)
    await api.collectAttachmentObjects(ids)
  }

  function publishVaultPayload(next: VaultPayload): boolean {
    if (deps.isLocked()) return false
    vaultSearchIndex.value = buildVaultSearchIndex(next.entries)
    vault.value = next
    pruneLocalEntryPreferences(next.entries)
    pruneBatchEntrySelection(next.entries)
    deps.syncSettings?.(next.settings)
    void collectLocalAttachmentObjects(next).catch(() => {})
    return true
  }

  async function handleVaultWriteError(result: ApiResult<unknown>, fallback: string): Promise<void> {
    if (result.code === 'CONFLICT') {
      const selectedId = selectedEntry.value?.id || ''
      const latest = await api.getVault()
      if (latest.ok && latest.data && publishVaultPayload(latest.data)) {
        selectedEntry.value = selectedId ? findEntryById(latest.data.entries, selectedId) : null
      }
      feedback.failToast('保险库已被其他窗口或插件更新，已重新载入；当前操作未保存，请重试')
      return
    }
    feedback.failToast(result.message || fallback)
  }

  function reconcileSelectedEntryAfterVaultUpdate(payload: VaultPayload): void {
    if (!selectedEntry.value) return
    selectedEntry.value = findEntryById(payload.entries, selectedEntry.value.id)
    if (!selectedEntry.value) {
      ui.detailOpen.value = false
      stopTotpTimer()
    } else {
      syncSelectedTotpTimer()
    }
  }

  function clearSelectedEntry(): void {
    selectedEntry.value = null
    ui.detailOpen.value = false
    stopTotpTimer()
  }

  // ---- TOTP Ticker ----
  function resolveTotpSecret(entryIdOverride = ''): string {
    if (entryIdOverride && vault.value) {
      return findEntryById(vault.value.entries, entryIdOverride)?.totpSecret || ''
    }
    if (editingId.value) return form.totpSecret || ''
    return selectedEntry.value?.totpSecret || ''
  }

  async function refreshTotp(entryIdOverride = ''): Promise<void> {
    const secret = resolveTotpSecret(entryIdOverride)
    if (!secret) {
      totpCode.value = ''
      return
    }
    const requestId = ++totpRequestId.value
    try {
      const code = await generateTotp(secret)
      if (requestId !== totpRequestId.value) return
      totpCode.value = code
      if (!code) feedback.toast('无法生成验证码')
    } catch {
      if (requestId !== totpRequestId.value) return
      totpCode.value = ''
      feedback.toast('无法生成验证码')
    }
  }

  function stopTotpTimer(reset = true): void {
    if (typeof window !== 'undefined' && totpTimer) window.clearInterval(totpTimer)
    totpTimer = 0
    totpCurrentStep = -1
    if (reset) {
      totpPeriodSeconds.value = TOTP_PERIOD_SECONDS
      totpRemaining.value = TOTP_PERIOD_SECONDS
    }
  }

  function updateTotpClock(entryId: string): void {
    if (selectedEntry.value?.id !== entryId || !selectedEntry.value?.totpSecret) {
      stopTotpTimer()
      return
    }
    const period = readTotpPeriod(selectedEntry.value.totpSecret)
    totpPeriodSeconds.value = period
    const nowSeconds = Math.floor(Date.now() / 1000)
    const elapsed = nowSeconds % period
    const step = Math.floor(nowSeconds / period)
    totpRemaining.value = elapsed === 0 ? period : period - elapsed
    if (step !== totpCurrentStep || !totpCode.value) {
      totpCurrentStep = step
      void refreshTotp(entryId)
    }
  }

  function startTotpTimer(entryId: string): void {
    stopTotpTimer(false)
    updateTotpClock(entryId)
    if (typeof window !== 'undefined') {
      totpTimer = window.setInterval(() => updateTotpClock(entryId), 1000)
    }
  }

  function syncSelectedTotpTimer(): void {
    const entry = selectedEntry.value
    if (entry?.totpSecret) startTotpTimer(entry.id)
    else stopTotpTimer()
  }

  function scheduleTotpRefresh(entryId: string): void {
    if (typeof window === 'undefined') return
    const scheduledEntryId = entryId
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (selectedEntry.value?.id === scheduledEntryId || editingId.value === scheduledEntryId) {
          void refreshTotp(scheduledEntryId)
        }
      }, 80)
    })
  }

  // ---- Clipboard & External Website ----
  async function copyText(value: string): Promise<void> {
    if (!value) {
      feedback.toast('没有可复制的内容')
      return
    }
    try {
      await copySensitiveText(value)
      feedback.successToast('已复制，30 秒后清除')
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '复制失败')
    }
  }

  async function copyEntryPassword(entryId: string): Promise<void> {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry?.password) {
      feedback.toast('此条目未保存密码')
      return
    }
    await copyText(entry.password)
  }

  async function copyQuickAccessTotp(entry: VaultEntry): Promise<void> {
    if (!entry.totpSecret) {
      feedback.toast('该条目没有 TOTP')
      return
    }
    try {
      const code = await generateTotp(entry.totpSecret)
      await copyText(code)
    } catch {
      feedback.failToast('TOTP 生成失败')
    }
  }

  async function openQuickAccessWebsite(domain: string): Promise<void> {
    const target = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
    const result = await api.openExternalUrl(target)
    if (!result.ok) feedback.failToast(result.message || '打开网站失败')
  }

  // ---- Android Autofill Launch Context ----
  function applyAndroidAutofillSearch(): void {
    const context = androidAutofillLaunch.value
    if (!context?.active) return
    const term = String(context.searchTerm || context.target || '').trim()
    if (!term) return
    keyword.value = term
    ui.searchOpen.value = true
    dragMode.value = false
    ui.detailOpen.value = false
    ui.drawerOpen.value = false
  }

  async function loadAndroidAutofillLaunchContext(): Promise<void> {
    const result = await androidBridgeCall<AndroidAutofillLaunchContext>('getAutofillLaunchContext')
    if (!result.ok || !result.data?.active) {
      androidAutofillLaunch.value = null
      return
    }
    androidAutofillLaunch.value = result.data
    applyAndroidAutofillSearch()
  }

  async function completeAndroidAutofill(entry: VaultEntry): Promise<void> {
    const result = await androidBridgeCall<{ filled: boolean }>('completeAutofillWithEntry', entry.id)
    if (!result.ok) {
      androidAutofillLaunch.value = null
      feedback.failToast(result.message || '自动填充失败')
      showEntryDetail(entry)
      return
    }
    feedback.successToast('已发送到自动填充')
  }

  // ---- Detail View, Quick Access, Generator, Import ----
  function showEntryDetail(entry: VaultEntry): void {
    if (isActiveEntry(entry)) {
      recentEntryIds.value = rememberRecentEntryId(entry.id, recentEntryIds.value)
    }
    selectedEntry.value = entry
    showPassword.value = false
    totpCode.value = ''
    if (ui.isWide.value && ui.editorOpen.value) {
      ui.editorOpen.value = false
    }
    ui.detailOpen.value = !ui.isWide.value
    syncSelectedTotpTimer()
  }

  function openView(entry: VaultEntry): void {
    if (entry.kind === 'folder') return
    if (androidAutofillLaunch.value?.active && isActiveEntry(entry)) {
      if (entry.kind !== 'login') return
      void completeAndroidAutofill(entry)
      return
    }
    showEntryDetail(entry)
  }

  const openEntry = openView

  function toggleEntryFavorite(entryId: string): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || !isActiveEntry(entry)) return
    favoriteEntryIds.value = toggleFavoriteEntryId(entryId, favoriteEntryIds.value)
  }

  function openQuickAccess(): void {
    if (!deps.isUnlocked()) {
      feedback.toast('请先解锁保险库')
      return
    }
    if (deps.isBusy()) {
      feedback.toast('正在处理，请稍候')
      return
    }
    if (ui.editorOpen.value) {
      feedback.toast('请先完成或关闭当前编辑')
      return
    }
    exitBatchSelection()
    ui.detailOpen.value = false
    ui.drawerOpen.value = false
    ui.moveSheetOpen.value = false
    ui.entryContextMenuOpen.value = false
    ui.moreMenuOpen.value = false
    ui.quickAccessOpen.value = true
  }

  function openQuickAccessEntry(entry: VaultEntry): void {
    ui.quickAccessOpen.value = false
    showEntryDetail(entry)
  }

  function openCredentialGenerator(applyToPassword: boolean): void {
    generatorApplyToPassword.value = applyToPassword
    ui.generatorOpen.value = true
  }

  function copyGeneratedCredential(value: string): void {
    void copyText(value)
  }

  function applyGeneratedCredential(value: string): void {
    if (!generatorApplyToPassword.value) return copyGeneratedCredential(value)
    form.password = value
    ui.generatorOpen.value = false
    feedback.successToast('已用于当前条目')
  }

  // ---- Editor Form & CRUD ----
  function resetForm(entry: VaultEntry): void {
    Object.assign(form, emptyEntry(entry.kind), JSON.parse(JSON.stringify(entry)))
    form.status = normalizeEntryStatus(form.status)
    form.autofillMatchMode = normalizeAutofillMatchMode(form.autofillMatchMode)
    form.loginAccountSource = normalizeLoginAccountSource(form.loginAccountSource)
    domainText.value = (entry.domains || []).join('\n')
    totpCode.value = ''
  }

  function updateEditorField(field: string, value: unknown): void {
    const text = String(value ?? '')
    if (field === 'loginAccountSource') {
      form.loginAccountSource = normalizeLoginAccountSource(value)
      return
    }
    if (field === 'autofillMatchMode') {
      form.autofillMatchMode = normalizeAutofillMatchMode(value)
      return
    }
    if (field === 'title' || field === 'username' || field === 'email' || field === 'password' || field === 'phone' || field === 'totpSecret' || field === 'note') {
      form[field] = text
    }
  }

  // Bug fix #1: clear login-only fields when switching a new entry to secure-note or folder
  function switchEditorKind(kind: EntryKind): void {
    if (form.kind === kind) return
    const currentTitle = form.title
    const currentNote = form.note
    const template = emptyEntry(kind)
    form.kind = kind
    if (currentTitle) form.title = currentTitle
    if (currentNote) form.note = currentNote
    if (template.customFields) form.customFields = template.customFields
    if (!editingId.value && (kind === 'secure-note' || kind === 'folder')) {
      form.username = ''
      form.password = ''
      form.email = ''
      form.phone = ''
      form.totpSecret = ''
      form.domains = []
      domainText.value = ''
      totpCode.value = ''
    }
  }

  function normalizeForm(): VaultEntry {
    const entry: VaultEntry = JSON.parse(JSON.stringify(form))
    entry.username = entry.username?.trim() || ''
    entry.email = entry.email?.trim() || ''
    entry.phone = entry.phone?.trim() || ''
    entry.autofillMatchMode = normalizeAutofillMatchMode(entry.autofillMatchMode)
    entry.loginAccountSource = normalizeLoginAccountSource(entry.loginAccountSource)
    entry.customFields = (entry.customFields || [])
      .map((field) => ({
        ...field,
        label: String(field.label || '').trim(),
        value: String(field.value || ''),
        protected: field.type === 'secret' || field.protected === true
      }))
      .filter((field) => field.label || field.value)
    entry.domains = entry.kind === 'login'
      ? normalizeAutofillRuleValues(domainText.value, entry.autofillMatchMode)
      : []
    if (entry.kind === 'folder') {
      entry.domains = []
      entry.customFields = []
      entry.children = entry.children || []
    } else {
      entry.children = []
    }
    return entry
  }

  function openCreate(kind: EntryKind, parentId = ''): void {
    wasDetailOpenBeforeEdit.value = false
    editingId.value = ''
    editingParentId.value = parentId
    resetForm(emptyEntry(kind))
    ui.detailOpen.value = false
    ui.editorOpen.value = true
  }

  function openEdit(entry: VaultEntry): void {
    wasDetailOpenBeforeEdit.value = ui.detailOpen.value || !ui.isWide.value
    editingId.value = entry.id
    editingParentId.value = ''
    resetForm(entry)
    ui.detailOpen.value = false
    ui.editorOpen.value = true
    if (entry.kind === 'login' && entry.totpSecret) scheduleTotpRefresh(entry.id)
  }

  function closeEditor(): void {
    ui.editorOpen.value = false
    if (wasDetailOpenBeforeEdit.value && selectedEntry.value && !ui.isWide.value) {
      ui.detailOpen.value = true
    }
    wasDetailOpenBeforeEdit.value = false
  }

  function handleEditorOpenChange(open: boolean): void {
    if (!open) closeEditor()
    else ui.editorOpen.value = true
  }

  async function importTotpQrImage(file: File, targetEditingId: string, targetFormId: string): Promise<void> {
    if ((!isDesktopRuntime && !isAndroidRuntime) || qrImageBusy.value) return
    qrImageBusy.value = true
    try {
      if (!isDesktopRuntime && !isAndroidRuntime) throw new Error('当前环境不支持二维码图片识别')
      const { decodeQrImageFile } = await import('../services/desktopQrImage.ts')
      const value = await decodeQrImageFile(file)
      await applyTotpQrValue(value, targetEditingId, targetFormId)
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '二维码图片识别失败')
    } finally {
      qrImageBusy.value = false
    }
  }

  async function applyTotpQrValue(value: string, targetEditingId: string, targetFormId: string): Promise<void> {
    if (!ui.editorOpen.value || editingId.value !== targetEditingId || form.id !== targetFormId) {
      feedback.toast('编辑页面已变化，未应用二维码结果')
      return
    }
    const payload = parseQrPayload(value)
    if (payload.kind === 'passkey-hybrid') {
      feedback.failToast('已识别跨设备通行密钥二维码，但当前尚未接入 FIDO hybrid 协议')
      return
    }
    updateEditorField('totpSecret', payload.uri)
    if (editingId.value) await refreshTotp()
    const account = payload.label || payload.issuer
    feedback.successToast(account ? `已导入 ${account} 的 TOTP` : '已导入 TOTP')
  }

  // Bug fix #2: do NOT open mobile detail sheet when saving a folder
  async function saveEntry(): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const entry = normalizeForm()
      if (editingId.value) {
        const previous = findEntryById(payload.entries, editingId.value)
        appendEntryHistory(entry, 'updated', '手动编辑', previous || entry)
        replaceEntry(payload.entries, editingId.value, entry)
      } else {
        appendEntryHistory(entry, 'created', '手动创建')
        insertEntry(payload.entries, editingParentId.value, entry)
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '保存失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      if (!editingId.value && editingParentId.value) expandFolder(editingParentId.value)
      selectedEntry.value = entry.kind !== 'folder'
        ? findEntryById(vault.value.entries, entry.id)
        : null
      ignoredHealthFindings.value = clearIgnoredHealthFindingsForEntry(
        entry.id,
        ignoredHealthFindings.value
      )
      ui.editorOpen.value = false
      if (!ui.isWide.value && entry.kind !== 'folder') {
        ui.detailOpen.value = true
      }
      wasDetailOpenBeforeEdit.value = false
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('已保存')
    } catch {
      feedback.failToast('保存失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // ---- Workspace Modes & Context Menu ----
  function toggleSearch(): void {
    ui.moreMenuOpen.value = false
    if (ui.searchOpen.value || keyword.value || entryFilter.value !== 'all') {
      keyword.value = ''
      entryFilter.value = 'all'
      ui.searchOpen.value = false
      return
    }
    dragMode.value = false
    ui.searchOpen.value = true
  }

  function toggleDragMode(): void {
    if (!dragMode.value && keyword.value.trim()) {
      feedback.toast('搜索时不能拖拽')
      return
    }
    dragMode.value = !dragMode.value
    ui.moreMenuOpen.value = false
    if (dragMode.value) {
      exitBatchSelection()
      ui.searchOpen.value = false
      ui.detailOpen.value = false
      feedback.toast('拖拽模式：长按条目移动')
    }
  }

  function handleMoreAction(action: { key?: string }): void {
    ui.moreMenuOpen.value = false
    if (action.key === 'quick-access') {
      openQuickAccess()
      return
    }
    if (action.key === 'generator') {
      openCredentialGenerator(false)
      return
    }
    if (action.key === 'import') {
      ui.importOpen.value = true
      return
    }
    if (action.key === 'select') {
      if (batchSelectionMode.value) exitBatchSelection()
      else enterBatchSelection()
      return
    }
    if (action.key === 'drag') {
      toggleDragMode()
      return
    }
    if (action.key === 'lock') void deps.lockVault?.()
    if (action.key === 'safe-exit') void deps.safeExit?.()
  }

  function clampEntryContextMenuPosition(x: number, y: number): { x: number; y: number } {
    const menuWidth = 156
    const menuHeight = 280
    const margin = 8
    const width = typeof window !== 'undefined' ? window.innerWidth : 1280
    const height = typeof window !== 'undefined' ? window.innerHeight : 800
    return {
      x: Math.max(margin, Math.min(x, width - menuWidth - margin)),
      y: Math.max(margin, Math.min(y, height - menuHeight - margin))
    }
  }

  function openEntryContextMenu(payload: { entry: VaultEntry; x: number; y: number }): void {
    if (dragMode.value) return
    contextEntryId.value = payload.entry.id
    const position = clampEntryContextMenuPosition(payload.x, payload.y)
    entryContextMenuX.value = position.x
    entryContextMenuY.value = position.y
    ui.moreMenuOpen.value = false
    ui.entryContextMenuOpen.value = true
  }

  function closeEntryContextMenu(): void {
    if (ui.entryContextMenuOpen.value) ui.entryContextMenuOpen.value = false
  }

  function handleEntryContextAction(action: { key?: string }): void {
    const entry = findEntryById(vault.value?.entries || [], contextEntryId.value)
    const targetId = contextEntryId.value
    ui.entryContextMenuOpen.value = false
    contextEntryId.value = ''
    if (!entry || !action.key) return
    if (action.key === 'create-login') return openCreate('login', entry.id)
    if (action.key === 'create-folder') return openCreate('folder', entry.id)
    if (action.key === 'duplicate') { void duplicateEntry(entry.id); return }
    if (action.key === 'edit') return openEdit(entry)
    if (action.key === 'move') return openMoveSheet(targetId)
    if (action.key === 'archive') { void archiveEntry(entry.id); return }
    if (action.key === 'trash') { void trashEntry(entry.id); return }
    if (action.key === 'restore') { void restoreEntry(entry.id); return }
    if (action.key === 'purge') { void purgeEntry(entry.id); return }
  }

  // ---- Batch Selection & Batch Operations ----
  function enterBatchSelection(): void {
    batchSelectionMode.value = true
    batchSelectedEntryIds.value = new Set()
    ui.batchMoveSheetOpen.value = false
    dragMode.value = false
    ui.detailOpen.value = false
    ui.entryContextMenuOpen.value = false
    ui.moreMenuOpen.value = false
    clearSelectedEntry()
  }

  function exitBatchSelection(): void {
    batchSelectionMode.value = false
    batchSelectedEntryIds.value = new Set()
    ui.batchMoveSheetOpen.value = false
  }

  function toggleBatchEntrySelection(entryId: string): void {
    if (!batchSelectionMode.value) return
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || !isActiveEntry(entry)) return
    const next = new Set(batchSelectedEntryIds.value)
    if (next.has(entryId)) next.delete(entryId)
    else next.add(entryId)
    batchSelectedEntryIds.value = next
  }

  function toggleAllVisibleBatchEntries(): void {
    if (!batchSelectionMode.value) return
    const next = new Set(batchSelectedEntryIds.value)
    if (allVisibleBatchEntriesSelected.value) {
      for (const entryId of visibleBatchEntryIds.value) next.delete(entryId)
    } else {
      for (const entryId of visibleBatchEntryIds.value) next.add(entryId)
    }
    batchSelectedEntryIds.value = next
  }

  function validActiveSelectedIds(entryIds: Iterable<string>): string[] {
    const selectedIds = new Set(entryIds)
    return collectEntryIds(activeTree(vault.value?.entries || [])).filter((id) => selectedIds.has(id))
  }

  function selectedRootsWithStatus(entryIds: Iterable<string>, statuses: ReadonlySet<EntryStatus>): string[] {
    if (!vault.value) return []
    return normalizeSelectedRootIds(vault.value.entries, entryIds).filter((entryId) => {
      const entry = findEntryById(vault.value?.entries || [], entryId)
      return Boolean(entry && statuses.has(normalizeEntryStatus(entry.status)))
    })
  }

  function applyBatchFavorite(): void {
    const selectedIds = validActiveSelectedIds(batchSelectedEntryIds.value)
    if (selectedIds.length === 0) {
      feedback.toast('请先选择条目')
      return
    }
    const favorite = !selectedIds.every((id) => favoriteEntryIds.value.has(id))
    favoriteEntryIds.value = setFavoriteEntryIds(selectedIds, favorite, favoriteEntryIds.value)
    feedback.successToast(favorite ? `已收藏 ${selectedIds.length} 项` : `已取消收藏 ${selectedIds.length} 项`)
  }

  function openBatchMoveSheet(): void {
    if (validActiveSelectedIds(batchSelectedEntryIds.value).length === 0) {
      feedback.toast('请先选择条目')
      return
    }
    ui.batchMoveSheetOpen.value = true
  }

  async function selectBatchMoveDestination(targetParentId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const moved = moveSelectedEntries(payload.entries, batchSelectedEntryIds.value, targetParentId)
      if (moved.error === 'invalid-destination') {
        feedback.failToast('不能移动到所选分组或其子分组')
        return
      }
      if (moved.error || moved.movedIds.length === 0) {
        feedback.failToast('所选条目已变化，请重新选择')
        return
      }

      ui.batchMoveSheetOpen.value = false
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '批量移动失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      if (targetParentId) expandFolder(targetParentId)
      deps.scheduleAutoCloudUpload?.()
      exitBatchSelection()
      feedback.successToast(`已移动 ${moved.movedIds.length} 项`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function archiveSelectedEntries(): Promise<void> {
    await archiveEntries([...batchSelectedEntryIds.value], true)
  }

  async function trashSelectedEntries(): Promise<void> {
    await trashEntries([...batchSelectedEntryIds.value], true)
  }

  async function archiveEntries(entryIds: string[], exitSelection = false): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['active']))
    if (roots.length === 0) {
      feedback.toast('没有可归档的条目')
      return
    }
    try {
      await feedback.confirm({
        title: '批量归档',
        message: `归档所选 ${roots.length} 项？分组内的内容会一并归档，可在系统分组中恢复。`,
        confirmButtonText: '归档',
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      for (const entryId of roots) {
        updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'disabled', '已批量归档'))
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '批量归档失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (exitSelection) exitBatchSelection()
      if (ui.drawerOpen.value) {
        ui.drawerSection.value = 'system'
        ui.systemGroupKey.value = 'archived'
      }
      feedback.successToast(`已归档 ${roots.length} 项`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function trashEntries(entryIds: string[], exitSelection = false): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['active', 'disabled']))
    if (roots.length === 0) {
      feedback.toast('没有可移入回收站的条目')
      return
    }
    try {
      await feedback.confirm({
        title: '批量移入回收站',
        message: `将所选 ${roots.length} 项移入回收站？分组内的内容会一并处理。`,
        confirmButtonText: '移入回收站',
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      for (const entryId of roots) {
        updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已批量移入回收站'))
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '批量删除失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (exitSelection) exitBatchSelection()
      if (ui.drawerOpen.value) {
        ui.drawerSection.value = 'system'
        ui.systemGroupKey.value = 'trashed'
      }
      feedback.successToast(`已移入回收站 ${roots.length} 项`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function restoreEntries(entryIds: string[]): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['disabled', 'trashed']))
    if (roots.length === 0) {
      feedback.toast('没有可恢复的条目')
      return
    }
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      for (const entryId of roots) {
        const target = findEntryById(payload.entries, entryId)
        if (!target) continue
        const updater = target.kind === 'folder'
          ? (entry: VaultEntry) => markEntryStatus(entry, 'active', '批量恢复为正常条目')
          : (entry: VaultEntry) => markEntrySelfStatus(entry, 'active', '批量恢复为正常条目')
        updateEntryAndAncestorsById(
          payload.entries,
          entryId,
          updater,
          (entry) => markEntrySelfStatus(entry, 'active', '恢复上级分组')
        )
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '批量恢复失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(`已恢复 ${roots.length} 项`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function purgeEntries(entryIds: string[]): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['trashed']))
    if (roots.length === 0) {
      feedback.toast('没有可永久删除的条目')
      return
    }
    try {
      await feedback.confirm({
        title: '批量彻底删除',
        message: `将从加密保险库中永久移除所选 ${roots.length} 项及其分组内容，删除后无法恢复。`,
        confirmButtonText: '永久删除',
        danger: true
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const removedCount = removeSelectedEntries(payload.entries, roots)
      if (removedCount === 0) {
        feedback.toast('所选条目已变化')
        return
      }
      recordPermanentEntryDeletions(vault.value.entries, payload)
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '批量彻底删除失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(`已永久删除 ${removedCount} 个条目`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // ---- Single-Entry Lifecycle Mutations (All Busy-Guarded!) ----
  async function duplicateEntry(entryId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const source = findEntryById(vault.value.entries, entryId)
    if (!source || source.status === 'trashed') {
      feedback.failToast('该条目无法创建副本')
      return
    }

    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const duplicate = insertDuplicateEntry(payload.entries, entryId, makeEntryId)
      if (!duplicate) {
        feedback.failToast('原条目已变化，请重试')
        return
      }

      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '创建副本失败')
        return
      }
      if (!publishVaultPayload(result.data)) return

      const savedDuplicate = findEntryById(vault.value.entries, duplicate.id)
      if (savedDuplicate && savedDuplicate.kind !== 'folder') showEntryDetail(savedDuplicate)
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(`已创建「${duplicate.title}」`)
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '创建副本失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function deleteEntry(entryId: string): Promise<void> {
    await trashEntry(entryId)
  }

  async function restoreEntryHistory(entryId: string, historyId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const source = findEntryById(vault.value.entries, entryId)
    const history = source?.history?.find((item) => item.id === historyId)
    if (!source || !history?.snapshot) {
      feedback.failToast('该历史记录不包含可恢复快照')
      return
    }
    try {
      await feedback.confirm({
        title: '恢复历史版本',
        message: `恢复「${source.title || '未命名条目'}」到 ${formatUnixTime(history.at)} 的内容？当前内容会保留为新的历史快照。`,
        confirmButtonText: '恢复',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const target = findEntryById(payload.entries, entryId)
      const targetHistory = target?.history?.find((item) => item.id === historyId)
      if (!target || !targetHistory?.snapshot) {
        feedback.failToast('历史记录已变化，请重试')
        return
      }
      const current = createEntrySnapshot(target)
      restoreEntrySnapshot(target, targetHistory.snapshot)
      appendEntryHistory(target, 'updated', '恢复历史版本', current)
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '恢复历史版本失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      selectedEntry.value = findEntryById(vault.value.entries, entryId)
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('历史版本已恢复')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function clearEntryHistory(entryId: string): Promise<void> {
    if (!vault.value) return
    if (deps.isBusy()) {
      feedback.toast('请等待当前操作完成')
      return
    }
    const source = findEntryById(vault.value.entries, entryId)
    if (!source?.history?.length) {
      feedback.toast('没有可清理的历史记录')
      return
    }
    try {
      await feedback.confirm({
        title: '清空历史记录',
        message: `清空「${source.title || '未命名条目'}」的全部历史快照？当前条目内容不会改变，但清理后无法恢复到旧版本。`,
        confirmButtonText: '清空历史',
        confirmButtonColor: '#ee0a24',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const target = findEntryById(payload.entries, entryId)
      if (!target || clearEntryHistoryRecords(target) === 0) {
        feedback.toast('历史记录已变化')
        return
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '清理历史记录失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      selectedEntry.value = findEntryById(vault.value.entries, entryId)
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('历史记录已清空')
    } catch {
      feedback.failToast('清理历史记录失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function disableEntry(entryId: string): Promise<void> {
    await archiveEntry(entryId)
  }

  // Bug fix #4 (no silent drawerSection/systemGroupKey mutation when closed) & #5 (busy guard)
  async function archiveEntry(entryId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const target = findEntryById(vault.value.entries, entryId)
    if (!target) {
      feedback.toast('条目不存在')
      return
    }
    const title = target.title || '未命名'
    const childCount = target.kind === 'folder'
      ? flattenEntries(target.children || []).filter((entry) => entry.status !== 'disabled').length
      : 0
    const itemLabel = entryKindLabel(target.kind)
    const message = target.kind === 'folder'
      ? childCount > 0
        ? `分组「${title}」和其中 ${childCount} 项内容会从正常列表中隐藏，之后可以在归档里恢复。`
        : `分组「${title}」会从正常列表中隐藏，之后可以在归档里恢复。`
      : `「${title}」会从正常列表${target.kind === 'login' ? '和自动填充' : ''}中隐藏，之后可以在归档里恢复。`
    try {
      await feedback.confirm({
        title: `归档${itemLabel}`,
        message,
        confirmButtonText: `归档${itemLabel}`,
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const reason = `${itemLabel}已归档，暂不在正常列表使用`
      if (!updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'disabled', reason))) return
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '归档失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (selectedEntry.value && (selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id))) {
        clearSelectedEntry()
      }
      if (ui.drawerOpen.value) {
        ui.drawerSection.value = 'system'
        ui.systemGroupKey.value = 'archived'
      }
      feedback.successToast(`${itemLabel}已归档`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  function clearTrashUndoState(): void {
    if (trashUndoState.value?.timer && typeof window !== 'undefined') {
      window.clearTimeout(trashUndoState.value.timer)
    }
    trashUndoState.value = null
  }

  function showTrashUndoToast(id: string, title: string): void {
    clearTrashUndoState()
    const timer = typeof window !== 'undefined'
      ? window.setTimeout(() => {
        trashUndoState.value = null
      }, 5000)
      : 0
    trashUndoState.value = { id, title, timer }
  }

  // Bug fix #3: check restoreEntry return status before showing '已撤销删除' toast
  async function handleUndoTrash(): Promise<void> {
    if (!trashUndoState.value) return
    const id = trashUndoState.value.id
    clearTrashUndoState()
    const restored = await restoreEntry(id, { silentSuccess: true })
    if (restored) feedback.successToast('已撤销删除')
  }

  // Bug fix #5: busy guard; direct soft-trash with 5s Undo snackbar (no confirmation fatigue)
  async function trashEntry(entryId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const target = findEntryById(vault.value.entries, entryId)
    if (!target) {
      feedback.toast('条目不存在')
      return
    }
    const title = target.title || '未命名'
    const operationId = deps.beginBusyOperation()
    try {
      const shouldClearSelection = selectedEntry.value
        ? selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id)
        : false
      const payload = cloneVault()
      if (!updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已移入回收站'))) return
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '删除失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (shouldClearSelection) {
        selectedEntry.value = null
        ui.detailOpen.value = false
        stopTotpTimer()
      }
      showTrashUndoToast(entryId, title)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // Bug fix #3 & #5: returns Promise<boolean> and guarded with busy/beginBusyOperation
  async function restoreEntry(entryId: string, options: { silentSuccess?: boolean } = {}): Promise<boolean> {
    if (!vault.value || deps.isBusy()) return false
    const target = findEntryById(vault.value.entries, entryId)
    if (!target) {
      feedback.toast('条目不存在')
      return false
    }
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const updater = target.kind === 'folder'
        ? (entry: VaultEntry) => markEntryStatus(entry, 'active', '恢复为正常条目')
        : (entry: VaultEntry) => markEntrySelfStatus(entry, 'active', '恢复为正常条目')
      if (!updateEntryAndAncestorsById(payload.entries, entryId, updater, (entry) => markEntrySelfStatus(entry, 'active', '恢复上级分组'))) {
        feedback.toast('条目不存在')
        return false
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '恢复失败')
        return false
      }
      if (!publishVaultPayload(result.data)) return false
      deps.scheduleAutoCloudUpload?.()
      selectedEntry.value = findEntryById(vault.value.entries, entryId)
      if (selectedEntry.value && selectedEntry.value.kind !== 'folder') showEntryDetail(selectedEntry.value)
      if (!options.silentSuccess) feedback.successToast('已恢复')
      return true
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // Bug fix #5: busy guard
  async function purgeEntry(entryId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const target = findEntryById(vault.value.entries, entryId)
    if (!target) {
      feedback.toast('条目不存在')
      return
    }
    const title = target.title || '未命名'
    try {
      await feedback.confirm({
        title: '彻底删除',
        message: `将从加密保险库中永久移除「${title}」，删除后无法恢复。确定继续吗？`,
        confirmButtonText: '永久删除',
        danger: true
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const shouldClearSelection = selectedEntry.value
        ? selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id)
        : false
      const payload = cloneVault()
      removeEntry(payload.entries, entryId)
      recordPermanentEntryDeletions(vault.value.entries, payload)
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '彻底删除失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (shouldClearSelection) clearSelectedEntry()
      feedback.successToast('已彻底删除')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  async function purgeAllTrashedEntries(): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const checkPayload = cloneVault()
    const checkCount = removeTrashedEntries(checkPayload.entries)
    if (checkCount === 0) {
      feedback.toast('回收站为空')
      return
    }

    try {
      await feedback.confirm({
        title: '清空回收站',
        message: `将永久删除回收站中的 ${checkCount} 个条目，此操作无法撤销。`,
        confirmButtonText: '永久删除全部',
        danger: true
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const removedCount = removeTrashedEntries(payload.entries)
      if (removedCount === 0) {
        feedback.toast('回收站为空')
        return
      }
      const selectedId = selectedEntry.value?.id || ''
      recordPermanentEntryDeletions(vault.value.entries, payload)
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '清空回收站失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      if (selectedId && !findEntryById(vault.value.entries, selectedId)) clearSelectedEntry()
      feedback.successToast(`已永久删除 ${removedCount} 个条目`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // Bug fix #5: busy guard on moveEntry
  async function moveEntry(payload: MoveEntryPayload): Promise<void> {
    if (!vault.value || deps.isBusy() || payload.entryId === payload.targetParentId) return
    const currentEntry = findEntryById(vault.value.entries, payload.entryId)
    if (!currentEntry) return
    if (currentEntry.kind === 'folder' && isDescendant(currentEntry, payload.targetParentId)) {
      feedback.toast('不能移动到自己的子分组')
      return
    }

    const operationId = deps.beginBusyOperation()
    try {
      const nextVault = cloneVault()
      const moved = takeEntry(nextVault.entries, payload.entryId)
      if (!moved) return
      removeEntryCopies(nextVault.entries, payload.entryId)

      const targetIndex =
        moved.parentId === payload.targetParentId && moved.index < payload.targetIndex
          ? payload.targetIndex - 1
          : payload.targetIndex
      insertEntryAt(nextVault.entries, payload.targetParentId, moved.entry, targetIndex)

      const result = await deps.saveVaultForCurrentSession(nextVault)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '移动失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      if (payload.targetParentId) expandFolder(payload.targetParentId)
      deps.scheduleAutoCloudUpload?.()
      if (selectedEntry.value) selectedEntry.value = findEntryById(vault.value.entries, selectedEntry.value.id)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  function openMoveSheet(entryId: string): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || !isActiveEntry(entry)) return
    moveEntryId.value = entryId
    ui.moveSheetOpen.value = true
  }

  function selectMoveDestination(targetParentId: string): void {
    const entryId = moveEntryId.value
    if (!entryId) return
    ui.moveSheetOpen.value = false
    moveEntryId.value = ''
    void moveEntry({
      entryId,
      targetParentId,
      targetIndex: Number.MAX_SAFE_INTEGER
    })
  }

  function handleMoveModalOpenChange(open: boolean): void {
    if (!open) {
      ui.moveSheetOpen.value = false
      ui.batchMoveSheetOpen.value = false
      moveEntryId.value = ''
    }
  }

  function handleMoveModalConfirm(targetParentId: string): void {
    if (ui.batchMoveSheetOpen.value) {
      void selectBatchMoveDestination(targetParentId)
    } else if (ui.moveSheetOpen.value) {
      selectMoveDestination(targetParentId)
    }
  }

  // ---- Import ----
  async function importVaultRecords(records: ImportedVaultRecord[]): Promise<void> {
    if (!vault.value || deps.isBusy() || records.length === 0) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const importedEntries = records.map((record) => {
        const entry: VaultEntry = {
          ...emptyEntry(record.kind),
          title: record.title,
          domains: record.kind === 'login' ? record.domains : [],
          username: record.username,
          email: record.email,
          password: record.password,
          phone: record.phone,
          note: record.note,
          totpSecret: record.kind === 'login' ? record.totpSecret : '',
          customFields: [
            ...record.customFields.map((field) => ({ ...field, id: makeEntryId() })),
            ...(record.folderPath ? [{ id: makeEntryId(), label: '原分组', value: record.folderPath, type: 'text' as const, protected: false }] : [])
          ]
        }
        appendEntryHistory(entry, 'created', '外部导入')
        return entry
      })
      const stamp = new Date().toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      const folder: VaultEntry = {
        ...emptyEntry('folder'),
        title: `导入 ${stamp}`,
        children: importedEntries
      }
      appendEntryHistory(folder, 'created', '外部导入')
      payload.entries.unshift(folder)

      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '导入失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      ui.importOpen.value = false
      importResetKey.value += 1
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(`已导入 ${importedEntries.length} 项`)
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '导入失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  // ---- Attachments ----
  async function addEntryAttachment(entryId: string, file: File): Promise<void> {
    if (!vault.value || attachmentBusy.value) return
    const currentEntry = findEntryById(vault.value.entries, entryId)
    if (!currentEntry || currentEntry.kind === 'folder' || currentEntry.status === 'trashed') return
    if ((currentEntry.attachments?.length || 0) >= 100) {
      feedback.failToast('每个条目最多保存 100 个附件')
      return
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      feedback.failToast('单个附件不能超过 10 MB')
      return
    }

    attachmentBusy.value = true
    let bytes: Uint8Array | null = null
    let created: VaultAttachment | null = null
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
      const createResult = await api.createAttachmentObject(file.name, file.type || 'application/octet-stream', bytes)
      if (!createResult.ok || !createResult.data) {
        feedback.failToast(createResult.message || '附件加密保存失败')
        return
      }
      created = createResult.data.reference

      const payload = JSON.parse(JSON.stringify(createResult.data.vault)) as VaultPayload
      const entry = findEntryById(payload.entries, entryId)
      if (!entry || entry.status === 'trashed') throw new Error('条目已发生变化')
      const before = JSON.parse(JSON.stringify(entry)) as VaultEntry
      entry.attachments = [...(entry.attachments || []), created]
      appendEntryHistory(entry, 'updated', '添加附件', before)
      const saveResult = await deps.saveVaultForCurrentSession(payload)
      if (!saveResult.ok || !saveResult.data) {
        await api.retainAttachmentObject(created.id)
        await handleVaultWriteError(saveResult, '附件引用保存失败')
        return
      }
      if (!publishVaultPayload(saveResult.data)) return
      selectedEntry.value = findEntryById(vault.value.entries, entryId)
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('附件已添加')
    } catch (error) {
      if (created) await api.retainAttachmentObject(created.id)
      feedback.failToast(error instanceof Error ? error.message : '附件添加失败')
    } finally {
      bytes?.fill(0)
      attachmentBusy.value = false
    }
  }

  async function saveEntryAttachment(entryId: string, attachmentId: string): Promise<void> {
    if (!vault.value || attachmentBusy.value) return
    const entry = findEntryById(vault.value.entries, entryId)
    const attachment = entry?.attachments?.find((item) => item.id === attachmentId)
    if (!attachment) {
      feedback.failToast('附件引用不存在')
      return
    }

    attachmentBusy.value = true
    try {
      const result = await api.saveAttachmentToFile(attachment)
      if (!result.ok || !result.data) {
        feedback.failToast(result.message || '附件保存失败')
        return
      }
      if (result.data.saved) feedback.successToast('附件已保存')
    } finally {
      attachmentBusy.value = false
    }
  }

  async function removeEntryAttachment(entryId: string, attachmentId: string): Promise<void> {
    if (!vault.value || attachmentBusy.value) return
    const currentEntry = findEntryById(vault.value.entries, entryId)
    const attachment = currentEntry?.attachments?.find((item) => item.id === attachmentId)
    if (!currentEntry || !attachment || currentEntry.status === 'trashed') return
    try {
      await feedback.confirm({
        title: '删除附件',
        message: `从“${currentEntry.title}”移除 ${attachment.name}？`,
        confirmButtonText: '删除',
        confirmButtonColor: '#dc2626'
      })
    } catch {
      return
    }

    attachmentBusy.value = true
    try {
      const payload = cloneVault()
      const entry = findEntryById(payload.entries, entryId)
      if (!entry) throw new Error('条目已发生变化')
      const before = JSON.parse(JSON.stringify(entry)) as VaultEntry
      entry.attachments = (entry.attachments || []).filter((item) => item.id !== attachmentId)
      appendEntryHistory(entry, 'updated', '删除附件', before)
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '删除附件失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      selectedEntry.value = findEntryById(vault.value.entries, entryId)
      if (!vaultReferencesAttachment(result.data.entries, attachmentId)) {
        const retained = await api.retainAttachmentObject(attachmentId)
        if (!retained.ok) feedback.toast('附件引用已删除，本地密文将在后续清理')
      }
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('附件已删除')
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '删除附件失败')
    } finally {
      attachmentBusy.value = false
    }
  }

  async function loadAttachmentStorageState(): Promise<void> {
    const result = await api.getAttachmentStorageState()
    if (result.ok && result.data) attachmentStorageState.value = result.data
  }

  async function collectAttachmentStorage(): Promise<void> {
    if (!vault.value || attachmentStorageBusy.value) return
    try {
      await feedback.confirm({
        title: '整理附件存储',
        message: '未被当前保险库引用的附件会先进入可恢复区；超过保留期限的对象将被永久删除。',
        confirmButtonText: '整理'
      })
    } catch {
      return
    }
    if (!vault.value) return
    attachmentStorageBusy.value = true
    try {
      const ids = collectAttachmentReferences(vault.value.entries).map((reference) => reference.id)
      const result = await api.collectAttachmentObjects(ids)
      if (!result.ok || !result.data) {
        feedback.failToast(result.message || '附件存储整理失败')
        return
      }
      await loadAttachmentStorageState()
      const changed = result.data.retained + result.data.deleted
      if (!changed) feedback.toast('附件存储已是最新状态')
      else feedback.successToast(`已保留 ${result.data.retained} 个，清理 ${result.data.deleted} 个`)
    } catch {
      feedback.failToast('附件存储整理失败')
    } finally {
      attachmentStorageBusy.value = false
    }
  }

  // ---- Passkey Mutations ----
  function openPasskeyManager(passkeyId = ''): void {
    passkeyManagerInitialId.value = passkeyId
    ui.drawerOpen.value = false
    ui.passkeyManagerOpen.value = true
  }

  async function saveManagedPasskey(
    update: { id: string; label: string; entryId: string },
    successMessage = '通行密钥已更新'
  ): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      const validLoginIds = new Set(buildPasskeyLoginOptions(payload.entries).map((option) => option.id))
      const changed = updatePasskeyMetadata(
        payload,
        update.id,
        { label: update.label, entryId: update.entryId },
        Math.floor(Date.now() / 1000),
        validLoginIds
      )
      if (!changed) {
        feedback.toast('没有需要保存的更改')
        return
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '更新通行密钥失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      passkeyManagerInitialId.value = update.id
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(successMessage)
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '更新通行密钥失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  function unlinkPasskeyFromEntry(passkeyId: string): void {
    const item = passkeyPresentationItems.value.find((candidate) => candidate.id === passkeyId)
    if (!item || !item.linkedEntryId) {
      feedback.toast('关联已变化')
      return
    }
    void saveManagedPasskey({ id: item.id, label: item.userLabel, entryId: '' }, '已解除通行密钥关联')
  }

  async function deleteManagedPasskey(passkeyId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const item = passkeyPresentationItems.value.find((candidate) => candidate.id === passkeyId)
    if (!item) {
      feedback.toast('通行密钥不存在')
      return
    }
    try {
      await feedback.confirm({
        title: '删除通行密钥',
        message: `将删除「${item.displayLabel}」。删除后无法再用它登录 ${item.rpId}。`,
        confirmButtonText: '删除',
        confirmButtonColor: '#dc2626'
      })
    } catch {
      return
    }
    if (!vault.value || deps.isBusy()) return
    const operationId = deps.beginBusyOperation()
    try {
      const result = await api.deletePasskey(passkeyId)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '删除通行密钥失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      if (passkeyManagerInitialId.value === passkeyId) passkeyManagerInitialId.value = ''
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast('通行密钥已删除')
    } catch (error) {
      feedback.failToast(error instanceof Error ? error.message : '删除通行密钥失败，请重试')
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  function openPasskeyLinkedEntry(entryId: string): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || entry.kind !== 'login' || !isActiveEntry(entry)) {
      feedback.failToast('关联登录项不存在或已失效')
      return
    }
    ui.passkeyManagerOpen.value = false
    showEntryDetail(entry)
  }

  // ---- Password Health Mutations ----
  function openPasswordHealth(): void {
    ui.passwordHealthOpen.value = true
  }

  function openPasswordHealthEntry(entryId: string): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || entry.kind === 'folder' || !isActiveEntry(entry)) {
      feedback.failToast('条目不存在或已失效')
      return
    }
    ui.passwordHealthOpen.value = false
    ui.drawerOpen.value = false
    showEntryDetail(entry)
  }

  function handleIgnoreHealthFinding(entryId: string, issue: PasswordHealthIssue, reason: string): void {
    const findingExists = passwordHealthReport.value.entries.some((entry) =>
      entry.entryId === entryId && entry.issues.includes(issue)
    )
    if (!findingExists) {
      feedback.toast('该风险已变化')
      return
    }
    ignoredHealthFindings.value = ignoreHealthFinding(
      entryId,
      issue,
      reason,
      ignoredHealthFindings.value
    )
    feedback.successToast('已在此设备忽略')
  }

  function handleRestoreHealthFinding(entryId: string, issue: PasswordHealthIssue): void {
    ignoredHealthFindings.value = restoreHealthFinding(
      entryId,
      issue,
      ignoredHealthFindings.value
    )
    feedback.successToast('已恢复检查')
  }

  function handleToggleExpectedTotp(entryId: string, expected: boolean): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || entry.kind !== 'login' || !isActiveEntry(entry)) return
    expectedTotpEntryIds.value = setExpectedTotpEntryId(
      entryId,
      expected,
      expectedTotpEntryIds.value
    )
  }

  function remediatePasswordHealthFinding(entryId: string, issue: PasswordHealthIssue): void {
    const entry = findEntryById(vault.value?.entries || [], entryId)
    if (!entry || entry.kind === 'folder' || !isActiveEntry(entry)) {
      feedback.failToast('条目不存在或已失效')
      return
    }
    if (issue === 'duplicate') {
      void mergePasswordHealthDuplicates(entryId)
      return
    }

    ui.passwordHealthOpen.value = false
    ui.drawerOpen.value = false
    openEdit(entry)
    if (issue === 'missing-totp') {
      feedback.toast('请填写 TOTP 密钥')
      return
    }
    if (['missing', 'weak', 'reused', 'stale'].includes(issue)) {
      void nextTick(() => openCredentialGenerator(true))
    }
  }

  async function mergePasswordHealthDuplicates(keepEntryId: string): Promise<void> {
    if (!vault.value || deps.isBusy()) return
    const keepResult = passwordHealthReport.value.entries.find((entry) => entry.entryId === keepEntryId)
    const group = keepResult?.duplicateGroupId
      ? passwordHealthReport.value.duplicateGroups.find((item) => item.id === keepResult.duplicateGroupId)
      : undefined
    const keepEntry = findEntryById(vault.value.entries, keepEntryId)
    const removeIds = (group?.entries || [])
      .map((entry) => entry.entryId)
      .filter((entryId) => {
        const entry = findEntryById(vault.value?.entries || [], entryId)
        return entryId !== keepEntryId && Boolean(entry && isActiveEntry(entry))
      })
    if (!keepEntry || removeIds.length === 0) {
      feedback.toast('重复项已变化')
      return
    }

    try {
      await feedback.confirm({
        title: '合并精确重复项',
        message: `保留“${keepEntry.title || '未命名条目'}”，并将其余 ${removeIds.length} 项移入回收站？`,
        confirmButtonText: '合并',
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }

    if (!vault.value || deps.isBusy()) return
    const currentKeepResult = passwordHealthReport.value.entries.find((entry) => entry.entryId === keepEntryId)
    const currentGroup = currentKeepResult?.duplicateGroupId
      ? passwordHealthReport.value.duplicateGroups.find((item) => item.id === currentKeepResult.duplicateGroupId)
      : undefined
    const currentRemoveIds = (currentGroup?.entries || [])
      .map((entry) => entry.entryId)
      .filter((entryId) => entryId !== keepEntryId)
    if (
      currentRemoveIds.length !== removeIds.length ||
      currentRemoveIds.some((entryId) => !removeIds.includes(entryId))
    ) {
      feedback.toast('重复项已变化，请重新检查')
      return
    }

    const operationId = deps.beginBusyOperation()
    try {
      const payload = cloneVault()
      let removedCount = 0
      for (const entryId of currentRemoveIds) {
        if (updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已合并精确重复项'))) {
          removedCount += 1
        }
      }
      if (!removedCount) {
        feedback.toast('重复项已变化')
        return
      }
      const result = await deps.saveVaultForCurrentSession(payload)
      if (!result.ok || !result.data) {
        await handleVaultWriteError(result, '合并重复项失败')
        return
      }
      if (!publishVaultPayload(result.data)) return
      deps.scheduleAutoCloudUpload?.()
      feedback.successToast(`已合并 ${removedCount} 个重复项`)
    } finally {
      deps.finishBusyOperation(operationId)
    }
  }

  function archiveEntryMeta(entry: VaultEntry): string {
    if (entry.kind === 'folder') {
      const count = flattenEntries(entry.children || []).length
      const time = entry.statusUpdatedAt ? formatUnixTime(entry.statusUpdatedAt) : ''
      return ['分组', `${count} 项`, time].filter(Boolean).join(' · ')
    }
    const account = entry.username || entry.email || entry.phone || '未设置账号'
    const domain = entry.domains?.[0] || '未设置域名'
    const time = entry.statusUpdatedAt ? formatUnixTime(entry.statusUpdatedAt) : ''
    return [account, domain, time].filter(Boolean).join(' · ')
  }

  // ---- Lock Reset ----
  function resetOnLock(): void {
    if (vault.value) pruneLocalEntryPreferences(vault.value.entries)
    vault.value = null
    vaultSearchIndex.value = null
    clearTrashUndoState()
    exitBatchSelection()
    selectedEntry.value = null
    stopTotpTimer()
    totpRequestId.value += 1
    totpCode.value = ''
    showPassword.value = false
    generatorApplyToPassword.value = false
    generatorResetKey.value += 1
    importResetKey.value += 1
    passkeyManagerInitialId.value = ''
    Object.assign(form, emptyEntry('login'))
    domainText.value = ''
    editingId.value = ''
    editingParentId.value = ''
    wasDetailOpenBeforeEdit.value = false
    contextEntryId.value = ''
    moveEntryId.value = ''
    keyword.value = ''
    entryFilter.value = 'all'
    sidebarView.value = 'all'
    activeFolderId.value = ''
    expandedFolderIds.value = new Set()
    dragMode.value = false
    attachmentStorageState.value = null
    androidAutofillLaunch.value = null
  }

  return {
    // Core Vault & Search State
    vault,
    vaultSearchIndex,
    sidebarView,
    activeFolderId,
    activeFolder,
    sidebarFolders,
    sidebarCounts,
    expandedFolderIds,
    selectSidebarView,
    selectSidebarFolder,
    toggleFolderExpanded,
    expandFolder,
    keyword,
    entryFilter,
    selectedEntry,
    selectedEntryId,
    filteredEntries,
    stats,
    favoriteEntryIds,
    recentEntryIds,
    expectedTotpEntryIds,
    ignoredHealthFindings,
    systemGroups,
    currentSystemGroup,
    systemGroupEntries,
    showPassword,
    passwordMask,
    dragMode,
    // Batch State
    batchSelectionMode,
    batchSelectedEntryIds,
    allVisibleBatchEntriesSelected,
    allBatchEntriesFavorited,
    // Editor State & Options
    form,
    domainText,
    editingId,
    editingParentId,
    qrImageBusy,
    loginAccountSourceOptions,
    autofillMatchModeOptions,
    // Context Menu & Move Modal State
    entryContextActions,
    entryContextMenuStyle,
    moveEntryId,
    moveModalMovingEntryIds,
    moveModalSubtitle,
    // Tools & Chrome State
    moreActions,
    generatorApplyToPassword,
    generatorResetKey,
    importResetKey,
    passkeyManagerInitialId,
    passkeyPresentationItems,
    passkeyLoginOptions,
    selectedEntryPasskeys,
    passwordHealthReport,
    passwordHealthSettingsLabel,
    passwordHealthScoreLabel,
    attachmentBusy,
    attachmentStorageBusy,
    attachmentStorageState,
    trashUndoState,
    // Live TOTP
    totpCode,
    totpRemaining,
    totpProgress,
    refreshTotp,
    stopTotpTimer,
    // Core Vault Actions
    publishVaultPayload,
    handleVaultWriteError,
    reconcileSelectedEntryAfterVaultUpdate,
    collectLocalAttachmentObjects,
    loadAttachmentStorageState,
    collectAttachmentStorage,
    // Entry View / Editor / CRUD
    openView,
    openEntry,
    showEntryDetail,
    clearSelectedEntry,
    toggleEntryFavorite,
    openCreate,
    openEdit,
    closeEditor,
    handleEditorOpenChange,
    switchEditorKind,
    updateEditorField,
    importTotpQrImage,
    saveEntry,
    duplicateEntry,
    deleteEntry,
    archiveEntry,
    disableEntry,
    trashEntry,
    handleUndoTrash,
    restoreEntry,
    purgeEntry,
    purgeAllTrashedEntries,
    restoreEntryHistory,
    clearEntryHistory,
    moveEntry,
    openMoveSheet,
    handleMoveModalOpenChange,
    handleMoveModalConfirm,
    // Batch Actions
    enterBatchSelection,
    exitBatchSelection,
    toggleBatchEntrySelection,
    toggleAllVisibleBatchEntries,
    applyBatchFavorite,
    openBatchMoveSheet,
    archiveSelectedEntries,
    trashSelectedEntries,
    archiveEntries,
    trashEntries,
    restoreEntries,
    purgeEntries,
    // Workspace / Context Menu / Tools
    toggleSearch,
    toggleDragMode,
    handleMoreAction,
    openEntryContextMenu,
    closeEntryContextMenu,
    handleEntryContextAction,
    openQuickAccess,
    openQuickAccessEntry,
    copyQuickAccessTotp,
    openQuickAccessWebsite,
    openCredentialGenerator,
    copyGeneratedCredential,
    applyGeneratedCredential,
    importVaultRecords,
    copyText,
    copyEntryPassword,
    archiveEntryMeta,
    // Attachments
    addEntryAttachment,
    saveEntryAttachment,
    removeEntryAttachment,
    // Passkeys
    openPasskeyManager,
    saveManagedPasskey,
    unlinkPasskeyFromEntry,
    deleteManagedPasskey,
    openPasskeyLinkedEntry,
    // Password Health
    openPasswordHealth,
    openPasswordHealthEntry,
    handleIgnoreHealthFinding,
    handleRestoreHealthFinding,
    handleToggleExpectedTotp,
    remediatePasswordHealthFinding,
    // Android Autofill
    loadAndroidAutofillLaunchContext,
    applyAndroidAutofillSearch,
    // Lock Reset
    resetOnLock
  }
}

export type VaultStore = ReturnType<typeof createVaultStore>
export const useVaultStore = createVaultStore
