import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { VaultEntry } from '../types'

type EntryTreeTransform = (entries: VaultEntry[]) => VaultEntry[]
type EntryFilter = (entries: VaultEntry[], term: string) => VaultEntry[]

export type EntryWorkspaceState = {
  keyword: Ref<string>
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
  activeTree: EntryTreeTransform,
  filterEntries: EntryFilter
): EntryWorkspaceState {
  const keyword = ref('')
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
    return filterEntries(activeTree(getEntries()), term)
  })

  function clearSelection() {
    selectedEntry.value = null
    detailOpen.value = false
  }

  return {
    keyword,
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
