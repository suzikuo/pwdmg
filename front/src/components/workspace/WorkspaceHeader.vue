<template>
  <div class="workspace-header">
    <header class="app-topbar">
      <div class="topbar-left">
        <UiButton
          v-if="showMenuButton"
          variant="ghost"
          size="sm"
          icon-only
          aria-label="打开菜单"
          title="打开菜单"
          @click="emit('open-drawer')"
        >
          <UiIcon name="menu" :size="18" />
        </UiButton>

        <div v-if="resolvedIsDesktop" class="topbar-search">
          <UiInput
            ref="searchInput"
            :model-value="keyword"
            type="search"
            clearable
            autocomplete="off"
            :placeholder="searchPlaceholder"
            @update:model-value="emit('update:keyword', $event)"
            @keydown="handleSearchKeydown"
          >
            <template #prefix>
              <UiIcon name="search" :size="15" />
            </template>
            <template #suffix>
              <button
                v-if="!keyword"
                type="button"
                class="search-kbd-btn"
                title="快速访问 (Ctrl+K)"
                aria-label="打开快速访问"
                @click="emit('open-quick-access')"
              >
                <kbd>Ctrl+K</kbd>
              </button>
            </template>
          </UiInput>
        </div>
        <span v-else class="topbar-mobile-title">我的密码库</span>
      </div>

      <div class="topbar-actions">
        <UiButton
          v-if="!resolvedIsDesktop"
          variant="ghost"
          size="sm"
          icon-only
          :aria-label="searchActive ? '关闭搜索' : '搜索'"
          :title="searchActive ? '关闭搜索' : '搜索'"
          @click="emit('toggle-search')"
        >
          <UiIcon :name="searchActive ? 'close' : 'search'" :size="17" />
        </UiButton>

        <UiButton
          variant="primary"
          size="sm"
          :icon-only="!resolvedIsDesktop"
          aria-label="新建条目"
          title="新建条目"
          @click="emit('create-entry')"
        >
          <UiIcon name="plus" :size="15" />
          <span v-if="resolvedIsDesktop">新建</span>
        </UiButton>

        <UiDropdown
          :open="moreMenuOpen"
          align="right"
          :items="dropdownMoreItems"
          @update:open="handleMoreMenuOpen"
          @select="handleMoreMenuSelect"
        >
          <template #trigger>
            <UiButton
              variant="ghost"
              size="sm"
              icon-only
              aria-label="更多操作"
              title="更多操作"
            >
              <UiIcon name="more" :size="17" />
            </UiButton>
          </template>
        </UiDropdown>
      </div>
    </header>

    <div v-if="selectionMode" class="batch-mode-strip" role="toolbar" aria-label="批量操作">
      <div class="batch-mode-left">
        <UiButton
          variant="ghost"
          size="xs"
          icon-only
          aria-label="退出选择"
          title="退出选择"
          @click="emit('exit-selection')"
        >
          <UiIcon name="close" :size="15" />
        </UiButton>
        <strong class="batch-mode-count">已选 {{ selectionCount }}</strong>
      </div>
      <div class="batch-mode-actions no-scrollbar">
        <UiButton variant="subtle" size="xs" @click="emit('toggle-select-all')">
          <UiIcon :name="allVisibleSelected ? 'close' : 'check-square'" :size="13" />
          <span>{{ allVisibleSelected ? '全不选' : '全选' }}</span>
        </UiButton>
        <UiButton variant="subtle" size="xs" :disabled="selectionCount === 0" @click="emit('batch-move')">
          <UiIcon name="move" :size="13" />
          <span>移动</span>
        </UiButton>
        <UiButton variant="subtle" size="xs" :disabled="selectionCount === 0" @click="emit('batch-favorite')">
          <UiIcon :name="allSelectedFavorite ? 'star-filled' : 'star'" :size="13" />
          <span>{{ allSelectedFavorite ? '取消收藏' : '收藏' }}</span>
        </UiButton>
        <UiButton variant="subtle" size="xs" :disabled="selectionCount === 0" @click="emit('batch-archive')">
          <UiIcon name="archive" :size="13" />
          <span>归档</span>
        </UiButton>
        <UiButton variant="danger" size="xs" :disabled="selectionCount === 0" @click="emit('batch-trash')">
          <UiIcon name="trash" :size="13" />
          <span>回收站</span>
        </UiButton>
      </div>
    </div>

    <div v-else-if="dragMode" class="drag-mode-strip" role="status">
      <div class="drag-mode-info">
        <UiIcon name="move" :size="15" />
        <span>排序模式：长按条目拖拽调整顺序或移入分组</span>
      </div>
      <UiButton variant="secondary" size="xs" @click="emit('exit-drag')">退出排序</UiButton>
    </div>

    <div v-else-if="!resolvedIsDesktop && searchActive" class="mobile-search-strip">
      <div class="mobile-search-box">
        <UiInput
          ref="searchInput"
          :model-value="keyword"
          type="search"
          clearable
          autocomplete="off"
          :placeholder="searchPlaceholder"
          @update:model-value="emit('update:keyword', $event)"
          @keydown="handleSearchKeydown"
        >
          <template #prefix>
            <UiIcon name="search" :size="15" />
          </template>
        </UiInput>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UiButton, UiDropdown, UiIcon, UiInput } from '../ui'
import type { UiDropdownItem, UiIconName } from '../ui'
import type { EntryFilterMode } from '../../services/entryWorkspace.ts'
import type { EntryKind } from '../../types'

type WorkspaceAction = {
  text: string
  icon?: string
  key?: string
  color?: string
  kind?: EntryKind
}

const props = withDefaults(defineProps<{
  searchOpen: boolean
  keyword: string
  entryFilter?: EntryFilterMode
  dragMode: boolean
  selectionMode: boolean
  selectionCount: number
  allVisibleSelected: boolean
  allSelectedFavorite: boolean
  moreMenuOpen: boolean
  moreActions: WorkspaceAction[]
  showSidebarToggle?: boolean
  isDesktop?: boolean
}>(), {
  entryFilter: 'all',
  showSidebarToggle: true,
  isDesktop: undefined
})

const emit = defineEmits<{
  'create-entry': []
  'open-drawer': []
  'open-quick-access': []
  'toggle-search': []
  'update:keyword': [value: string]
  'update:entry-filter': [value: EntryFilterMode]
  'update:more-menu-open': [value: boolean]
  'select-more': [action: WorkspaceAction]
  'close-more-menu': []
  'exit-drag': []
  'exit-selection': []
  'toggle-select-all': []
  'batch-move': []
  'batch-favorite': []
  'batch-archive': []
  'batch-trash': []
}>()

const viewportDesktop = ref(typeof window !== 'undefined' ? window.innerWidth >= 768 : false)
const resolvedIsDesktop = computed(() =>
  typeof props.isDesktop === 'boolean' ? props.isDesktop : viewportDesktop.value
)
const showMenuButton = computed(() => props.showSidebarToggle)

function handleResize() {
  viewportDesktop.value = window.innerWidth >= 768
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})

const searchInput = ref<{ focus: () => void; select: () => void; inputEl: HTMLInputElement | HTMLTextAreaElement | null } | null>(null)
const searchActive = computed(() => props.searchOpen || Boolean(props.keyword))
const searchPlaceholder = computed(() =>
  resolvedIsDesktop.value ? '搜索标题、账号、域名、自定义字段 (Ctrl+F)' : '搜索标题、账号、域名、自定义字段'
)

function mapMoreActionIcon(action: WorkspaceAction): UiIconName {
  if (action.key === 'quick-access' || action.icon === 'search') return 'search'
  if (action.key === 'generator' || action.icon === 'shield-o') return 'wand'
  if (action.key === 'import' || action.icon === 'upgrade') return 'upload'
  if (action.key === 'select' || action.icon === 'passed') return 'check-square'
  if (action.key === 'drag' || action.icon === 'sort') return 'move'
  if (action.key === 'lock' || action.icon === 'lock') return 'lock'
  if (action.key === 'health') return 'shield'
  if (action.key === 'passkeys') return 'key'
  if (action.key === 'settings') return 'settings'
  return 'info'
}

const dropdownMoreItems = computed<UiDropdownItem[]>(() =>
  props.moreActions.map((action, index) => ({
    key: action.key || `${action.text}-${index}`,
    label: action.text,
    icon: mapMoreActionIcon(action),
    danger: Boolean(action.color && /dc2626|ee0a24/i.test(action.color)),
    divider: action.key === 'lock' && index > 0
  }))
)

function handleMoreMenuOpen(open: boolean) {
  emit('update:more-menu-open', open)
  if (!open) emit('close-more-menu')
}

function handleMoreMenuSelect(item: UiDropdownItem) {
  const index = dropdownMoreItems.value.findIndex((entry) => entry.key === item.key)
  const original = index >= 0 ? props.moreActions[index] : undefined
  if (original) {
    emit('select-more', original)
  }
  emit('close-more-menu')
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.keyword) {
    event.preventDefault()
    emit('update:keyword', '')
  }
}

async function focusSearch() {
  if (!resolvedIsDesktop.value && !searchActive.value) {
    emit('toggle-search')
  }
  await nextTick()
  searchInput.value?.focus()
  searchInput.value?.select()
}

watch(() => props.searchOpen, async (open) => {
  if (!open) return
  await nextTick()
  searchInput.value?.focus()
  searchInput.value?.select()
})

defineExpose({
  focusSearch
})
</script>

<style scoped>
.workspace-header {
  display: flex;
  flex-direction: column;
  background-color: var(--panel-bg);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: var(--topbar-height);
  padding: 6px 12px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}

.topbar-search {
  flex: 1 1 auto;
  max-width: 440px;
  min-width: 0;
}

.topbar-search :deep(.ui-field__control-wrap) {
  min-height: 32px;
  padding: 0 9px;
  background-color: var(--surface-container-low);
  border-color: var(--border-soft);
  border-radius: var(--radius-md);
}

.topbar-search :deep(.ui-field__control-wrap:focus-within) {
  background-color: var(--panel-bg);
  border-color: var(--brand);
}

.topbar-search :deep(.ui-field__control) {
  padding: 4px 0;
  font-size: var(--app-font-sm);
}

.search-kbd-btn {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.search-kbd-btn kbd {
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.4;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.search-kbd-btn:hover kbd {
  border-color: var(--brand);
  color: var(--brand);
}

.topbar-mobile-title {
  font-size: var(--app-font-md);
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Mobile search strip */
.mobile-search-strip {
  display: flex;
  flex-direction: column;
  padding: 2px 12px 9px;
}

.mobile-search-box :deep(.ui-field__control-wrap) {
  min-height: 34px;
  background-color: var(--surface-container-low);
  border-color: var(--border-soft);
  border-radius: var(--radius-md);
}

/* Batch selection bar */
.batch-mode-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  background-color: var(--brand-soft);
  border-top: 1px solid color-mix(in srgb, var(--brand) 22%, transparent);
}

.batch-mode-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.batch-mode-count {
  font-size: var(--app-font-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-main);
  white-space: nowrap;
}

.batch-mode-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}

/* Drag reorder banner */
.drag-mode-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  background-color: var(--warning-soft);
  border-top: 1px solid color-mix(in srgb, var(--warning) 28%, transparent);
  color: var(--text-main);
  font-size: var(--app-font-xs);
}

.drag-mode-info {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--warning);
  font-weight: 500;
}
</style>
