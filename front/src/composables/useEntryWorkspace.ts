import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { EntryFilterMode } from '../services/entryWorkspace.ts'
import type { VaultEntry } from '../types'

type EntryFilter = (entries: VaultEntry[], term: string, mode: EntryFilterMode) => VaultEntry[]

export type EntryWorkspaceState = {
  keyword: Ref<string>
  entryFilter: Ref<EntryFilterMode>
  editorOpen: Ref<boolean>
  detailOpen: Ref<boolean>
  createSheetOpen: Ref<boolean>
  createMenuOpen: Ref<boolean>
  moreMenuOpen: Ref<boolean>
  dragMode: Ref<boolean>
  editingId: Ref<string>
  editingParentId: Ref<string>
  selectedEntry: Ref<VaultEntry | null>
  filteredEntries: ComputedRef<VaultEntry[]>
  clearSelection: () => void
}

export function useEntryWorkspace(
  getEntries: () => VaultEntry[],
  filterEntries: EntryFilter
): EntryWorkspaceState {
  const keyword = ref('')
  const entryFilter = ref<EntryFilterMode>('all')
  const editorOpen = ref(false)
  const detailOpen = ref(false)
  const createSheetOpen = ref(false)
  const createMenuOpen = ref(false)
  const moreMenuOpen = ref(false)
  const dragMode = ref(false)
  const editingId = ref('')
  const editingParentId = ref('')
  const selectedEntry = ref<VaultEntry | null>(null)

  const filteredEntries = computed(() => {
    const term = keyword.value.trim().toLowerCase()
    return filterEntries(getEntries(), term, entryFilter.value)
  })

  function clearSelection() {
    selectedEntry.value = null
    detailOpen.value = false
  }

  return {
    keyword,
    entryFilter,
    editorOpen,
    detailOpen,
    createSheetOpen,
    createMenuOpen,
    moreMenuOpen,
    dragMode,
    editingId,
    editingParentId,
    selectedEntry,
    filteredEntries,
    clearSelection
  }
}
