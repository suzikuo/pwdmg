<template>
  <aside
    class="workspace-sidebar"
    :class="{ 'is-collapsed': collapsed }"
    aria-label="保险库导航"
  >
    <div class="sidebar-brand">
      <button
        type="button"
        class="sidebar-brand__toggle"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :aria-expanded="!collapsed"
        @click="emit('toggle-collapse')"
      >
        <span class="sidebar-brand__logo" aria-hidden="true">
          <UiIcon name="shield" :size="17" />
        </span>
        <span v-if="!collapsed" class="sidebar-brand__title">我的密码库</span>
      </button>
    </div>

    <nav class="sidebar-scroll" aria-label="视图与分组">
      <section class="sidebar-section">
        <div v-if="!collapsed" class="sidebar-section__head">
          <span>保险库</span>
        </div>
        <ul class="sidebar-nav-list">
          <li v-for="view in primaryViews" :key="view.key">
            <button
              type="button"
              class="sidebar-nav-item"
              :class="{
                'is-active': activeView === view.key,
                'is-danger-tone': view.key === 'trash',
                'is-muted-empty': (view.key === 'archived' || view.key === 'trash') && view.count === 0
              }"
              :aria-current="activeView === view.key ? 'page' : undefined"
              :title="collapsed ? `${view.label} (${view.count})` : undefined"
              @click="emit('select-view', view.key)"
            >
              <span class="sidebar-nav-item__icon">
                <UiIcon :name="view.icon" :size="16" />
              </span>
              <span v-if="!collapsed" class="sidebar-nav-item__label">{{ view.label }}</span>
              <span
                v-if="!collapsed"
                class="sidebar-count"
                :class="{ 'is-empty': view.count === 0 }"
              >
                {{ view.count }}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="!collapsed" class="sidebar-section">
        <div class="sidebar-section__head">
          <span>分组</span>
          <button
            type="button"
            class="sidebar-section__add"
            aria-label="新建分组"
            title="新建分组"
            @click="emit('create-folder', '')"
          >
            <UiIcon name="plus" :size="14" />
          </button>
        </div>

        <ul v-if="visibleFolderRows.length" class="sidebar-nav-list sidebar-folder-list">
          <li
            v-for="row in visibleFolderRows"
            :key="row.folder.id"
            class="sidebar-folder-row"
            :class="{
              'is-active': activeView === 'folder' && activeFolderId === row.folder.id,
              'is-menu-open': openFolderMenuId === row.folder.id
            }"
            :style="{ '--folder-depth': `${row.depth}` }"
          >
            <button
              v-if="row.hasChildFolders"
              type="button"
              class="folder-chevron"
              :aria-label="row.expanded ? '收起子分组' : '展开子分组'"
              :aria-expanded="row.expanded"
              @click.stop="toggleFolderExpand(row.folder.id)"
            >
              <UiIcon :name="row.expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
            </button>
            <span v-else class="folder-chevron-spacer" aria-hidden="true" />

            <button
              type="button"
              class="sidebar-folder-main"
              :aria-current="activeView === 'folder' && activeFolderId === row.folder.id ? 'page' : undefined"
              :title="row.folder.title"
              @click="emit('select-folder', row.folder.id)"
            >
              <UiIcon
                :name="row.expanded || (activeView === 'folder' && activeFolderId === row.folder.id) ? 'folder-open' : 'folder'"
                :size="15"
                class="sidebar-folder-icon"
              />
              <span class="sidebar-nav-item__label">{{ row.folder.title || '未命名分组' }}</span>
              <span class="sidebar-count sidebar-folder-count">{{ row.itemCount }}</span>
            </button>

            <div class="sidebar-folder-menu" @click.stop>
              <UiDropdown
                :open="openFolderMenuId === row.folder.id"
                align="right"
                :items="folderMenuItems"
                @update:open="handleFolderMenuToggle(row.folder.id, $event)"
                @select="handleFolderMenuSelect($event, row.folder)"
              >
                <template #trigger>
                  <button
                    type="button"
                    class="folder-more-btn"
                    :aria-label="`分组 ${row.folder.title} 更多操作`"
                    title="分组操作"
                  >
                    <UiIcon name="more" :size="14" />
                  </button>
                </template>
              </UiDropdown>
            </div>
          </li>
        </ul>

        <button
          v-else
          type="button"
          class="sidebar-folder-empty"
          @click="emit('create-folder', '')"
        >
          <UiIcon name="plus" :size="14" />
          <span>新建第一个分组</span>
        </button>
      </section>
    </nav>

    <footer class="sidebar-footer">
      <button
        type="button"
        class="sidebar-sync-btn"
        :class="{ 'is-syncing': cloudSyncing }"
        :disabled="cloudSyncing"
        :title="cloudStatusText || '云同步'"
        @click="emit('trigger-sync')"
      >
        <span class="sidebar-sync-icon">
          <UiIcon :name="cloudSyncing ? 'refresh' : 'cloud'" :size="15" :class="{ 'is-spinning': cloudSyncing }" />
        </span>
        <template v-if="!collapsed">
          <span class="sidebar-sync-label">{{ cloudStatusText || '云同步' }}</span>
          <span class="sidebar-sync-dot" :class="{ 'is-active': cloudSyncing }" aria-hidden="true" />
        </template>
      </button>

      <div class="sidebar-footer-actions" :class="{ 'is-stacked': collapsed }">
        <div class="sidebar-tools-dropdown">
          <UiDropdown
            :open="toolsMenuOpen"
            align="left"
            :items="toolsMenuItems"
            @update:open="toolsMenuOpen = $event"
            @select="handleToolsMenuSelect"
          >
            <template #trigger>
              <button
                type="button"
                class="sidebar-footer-btn"
                aria-label="工具与安全"
                title="工具与安全"
              >
                <UiIcon name="wand" :size="15" />
                <span v-if="!collapsed">工具</span>
              </button>
            </template>
          </UiDropdown>
        </div>
        <button
          type="button"
          class="sidebar-footer-btn"
          aria-label="设置"
          title="设置"
          @click="emit('open-settings')"
        >
          <UiIcon name="settings" :size="15" />
          <span v-if="!collapsed">设置</span>
        </button>
        <button
          type="button"
          class="sidebar-footer-btn is-lock"
          aria-label="锁定保险库 (Ctrl+L)"
          title="锁定保险库 (Ctrl+L)"
          @click="emit('lock')"
        >
          <UiIcon name="lock" :size="15" />
          <span v-if="!collapsed">锁定</span>
        </button>
      </div>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { UiDropdown, UiIcon } from '../ui'
import type { UiDropdownItem, UiIconName } from '../ui'
import type { VaultEntry } from '../../types'

export type WorkspaceSidebarView = 'all' | 'favorites' | 'recent' | 'archived' | 'trash' | 'folder'

export type WorkspaceSidebarCounts = {
  all: number
  favorites: number
  recent: number
  archived: number
  trash: number
  healthIssues?: number
  passkeys?: number
}

export type WorkspaceSidebarFolderAction = {
  action: 'edit' | 'add-child' | 'move' | 'delete'
  folder: VaultEntry
}

const props = withDefaults(defineProps<{
  activeView: WorkspaceSidebarView
  activeFolderId?: string
  folders: VaultEntry[]
  counts: WorkspaceSidebarCounts
  expandedIds?: ReadonlySet<string>
  cloudStatusText?: string
  cloudSyncing?: boolean
  collapsed?: boolean
}>(), {
  activeFolderId: '',
  expandedIds: undefined,
  cloudStatusText: '',
  cloudSyncing: false,
  collapsed: false
})

const emit = defineEmits<{
  'select-view': [view: WorkspaceSidebarView]
  'select-folder': [folderId: string]
  'create-folder': [parentId: string]
  'folder-action': [payload: WorkspaceSidebarFolderAction]
  'toggle-expand': [folderId: string]
  'open-health': []
  'open-passkeys': []
  'open-generator': []
  'open-import': []
  'open-quick-access': []
  'trigger-sync': []
  'open-settings': []
  lock: []
  'toggle-collapse': []
}>()

const localExpandedFolderIds = ref(new Set<string>())
const openFolderMenuId = ref('')
const toolsMenuOpen = ref(false)

const toolsMenuItems: UiDropdownItem[] = [
  { key: 'health', label: '密码健康', icon: 'shield' },
  { key: 'passkeys', label: '通行密钥', icon: 'key' },
  { key: 'generator', label: '密码生成器', icon: 'wand' },
  { key: 'import', label: '导入数据', icon: 'upload' }
]

const primaryViews = computed<Array<{
  key: Exclude<WorkspaceSidebarView, 'folder'>
  label: string
  icon: UiIconName
  count: number
}>>(() => [
  { key: 'all', label: '全部条目', icon: 'shield', count: props.counts.all },
  { key: 'favorites', label: '收藏夹', icon: 'star', count: props.counts.favorites },
  { key: 'recent', label: '最近使用', icon: 'clock', count: props.counts.recent },
  { key: 'archived', label: '已归档', icon: 'archive', count: props.counts.archived },
  { key: 'trash', label: '回收站', icon: 'trash', count: props.counts.trash }
])

const folderMenuItems: UiDropdownItem[] = [
  { key: 'add-child', label: '新建子项', icon: 'plus' },
  { key: 'edit', label: '重命名分组', icon: 'edit' },
  { key: 'move', label: '移动分组', icon: 'move' },
  { key: 'delete', label: '删除分组', icon: 'trash', danger: true, divider: true }
]

type FlattenedFolderRow = {
  folder: VaultEntry
  depth: number
  hasChildFolders: boolean
  expanded: boolean
  itemCount: number
}

function countNonFolderItems(node: VaultEntry): number {
  let count = 0
  for (const child of node.children || []) {
    if (child.status === 'trashed' || child.status === 'disabled') continue
    if (child.kind === 'folder') {
      count += countNonFolderItems(child)
    } else {
      count += 1
    }
  }
  return count
}

const visibleFolderRows = computed<FlattenedFolderRow[]>(() => {
  const rows: FlattenedFolderRow[] = []

  const walk = (nodes: VaultEntry[], depth: number) => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue
      if (node.status === 'trashed' || node.status === 'disabled') continue
      const childFolders = (node.children || []).filter(
        (child) => child.kind === 'folder' && child.status !== 'trashed' && child.status !== 'disabled'
      )
      const expanded = props.expandedIds
        ? props.expandedIds.has(node.id)
        : localExpandedFolderIds.value.has(node.id)
      rows.push({
        folder: node,
        depth,
        hasChildFolders: childFolders.length > 0,
        expanded,
        itemCount: countNonFolderItems(node)
      })
      if (childFolders.length > 0 && expanded) {
        walk(childFolders, Math.min(depth + 1, 4))
      }
    }
  }

  walk(props.folders, 0)
  return rows
})

function toggleFolderExpand(folderId: string) {
  emit('toggle-expand', folderId)
  if (!props.expandedIds) {
    const next = new Set(localExpandedFolderIds.value)
    if (next.has(folderId)) next.delete(folderId)
    else next.add(folderId)
    localExpandedFolderIds.value = next
  }
}

function handleFolderMenuToggle(folderId: string, open: boolean) {
  openFolderMenuId.value = open ? folderId : (openFolderMenuId.value === folderId ? '' : openFolderMenuId.value)
}

function handleFolderMenuSelect(item: UiDropdownItem, folder: VaultEntry) {
  const action = item.key as WorkspaceSidebarFolderAction['action']
  emit('folder-action', { action, folder })
  openFolderMenuId.value = ''
}

function handleToolsMenuSelect(item: UiDropdownItem) {
  toolsMenuOpen.value = false
  if (item.key === 'health') emit('open-health')
  else if (item.key === 'passkeys') emit('open-passkeys')
  else if (item.key === 'generator') emit('open-generator')
  else if (item.key === 'import') emit('open-import')
}
</script>

<style scoped>
.workspace-sidebar {
  display: flex;
  flex-direction: column;
  width: 224px;
  min-width: 224px;
  height: 100%;
  background-color: var(--surface-sidebar);
  border-right: 1px solid var(--border-soft);
  color: var(--text-main);
  transition: width var(--duration-normal) var(--ease-standard),
    min-width var(--duration-normal) var(--ease-standard);
  user-select: none;
}

.workspace-sidebar.is-collapsed {
  width: 60px;
  min-width: 60px;
}

/* Top brand strip */
.sidebar-brand {
  display: flex;
  align-items: center;
  height: var(--topbar-height);
  padding: 0 10px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.workspace-sidebar.is-collapsed .sidebar-brand {
  justify-content: center;
  padding: 0 6px;
}

.sidebar-brand__toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  width: 100%;
  height: 32px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.workspace-sidebar.is-collapsed .sidebar-brand__toggle {
  justify-content: center;
  width: 34px;
  padding: 0;
}

.sidebar-brand__toggle:hover {
  background-color: var(--surface-container-high);
}

.sidebar-brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--panel-bg);
  color: var(--text-main);
  flex-shrink: 0;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.sidebar-brand__toggle:hover .sidebar-brand__logo {
  border-color: var(--brand);
  color: var(--brand);
}

.sidebar-brand__title {
  font-size: var(--app-font-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.sidebar-icon-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

/* Scrollable nav area */
.sidebar-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sidebar-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 3px;
  font-size: var(--app-font-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.sidebar-section__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.sidebar-section__add:hover {
  background-color: var(--brand-soft);
  color: var(--brand);
}

.sidebar-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 32px;
  padding: 5px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.sidebar-nav-item.is-muted-empty {
  opacity: 0.62;
}

.sidebar-nav-item.is-muted-empty:hover,
.sidebar-nav-item.is-muted-empty.is-active {
  opacity: 1;
}

.workspace-sidebar.is-collapsed .sidebar-nav-item {
  justify-content: center;
  padding: 6px;
}

.sidebar-nav-item:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.sidebar-nav-item.is-active {
  background-color: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}

.sidebar-nav-item.is-active.is-danger-tone {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.sidebar-nav-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar-nav-item__label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-count {
  flex-shrink: 0;
  font-size: var(--app-font-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  padding: 0 5px;
  min-width: 20px;
  text-align: right;
}

.sidebar-nav-item.is-active .sidebar-count {
  color: inherit;
}

.sidebar-count.is-empty {
  opacity: 0.55;
}

/* Folder tree rows */
.sidebar-folder-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 30px;
  padding-left: calc(4px + var(--folder-depth, 0) * 14px);
  padding-right: 4px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.sidebar-folder-row:hover,
.sidebar-folder-row.is-menu-open {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.sidebar-folder-row.is-active {
  background-color: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}

.folder-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.folder-chevron:hover {
  color: var(--text-main);
  background-color: var(--surface-container-highest);
}

.folder-chevron-spacer {
  width: 18px;
  flex-shrink: 0;
}

.sidebar-folder-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--app-font-sm);
  font-weight: inherit;
  text-align: left;
  cursor: pointer;
}

.sidebar-folder-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.sidebar-folder-row.is-active .sidebar-folder-icon {
  color: var(--brand);
}

.sidebar-folder-menu {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.sidebar-folder-row:hover .sidebar-folder-menu,
.sidebar-folder-row:focus-within .sidebar-folder-menu,
.sidebar-folder-row.is-menu-open .sidebar-folder-menu {
  opacity: 1;
}

.sidebar-folder-row:hover .sidebar-folder-count,
.sidebar-folder-row.is-menu-open .sidebar-folder-count {
  display: none;
}

.folder-more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.folder-more-btn:hover {
  background-color: var(--surface-container-highest);
  color: var(--text-main);
}

.sidebar-folder-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-xs);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.sidebar-folder-empty:hover {
  border-color: var(--brand);
  color: var(--brand);
  background-color: var(--brand-soft);
}

/* Sticky footer */
.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 8px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-sidebar);
  flex-shrink: 0;
}

.sidebar-sync-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.workspace-sidebar.is-collapsed .sidebar-sync-btn {
  justify-content: center;
  padding: 0;
}

.sidebar-sync-btn:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--text-main);
}

.sidebar-sync-btn:disabled {
  opacity: 0.72;
  cursor: wait;
}

.sidebar-sync-icon {
  display: inline-flex;
  align-items: center;
  color: var(--brand);
  flex-shrink: 0;
}

.sidebar-sync-label {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-sync-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background-color: var(--success);
  flex-shrink: 0;
}

.sidebar-sync-dot.is-active {
  background-color: var(--brand);
  animation: sidebar-pulse 1.1s ease-in-out infinite;
}

.sidebar-footer-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}

.sidebar-footer-actions.is-stacked {
  grid-template-columns: 1fr;
}

.sidebar-tools-dropdown {
  min-width: 0;
}

.sidebar-tools-dropdown :deep(.ui-dropdown),
.sidebar-tools-dropdown :deep(.ui-dropdown__trigger) {
  display: flex;
  width: 100%;
}

.sidebar-footer .sidebar-tools-dropdown :deep(.ui-dropdown__menu) {
  top: auto;
  bottom: calc(100% + 6px);
  left: 0;
  right: auto;
  transform-origin: bottom left;
}

.sidebar-footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 32px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.sidebar-footer-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.sidebar-footer-btn.is-lock:hover {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.is-spinning {
  animation: sidebar-spin 0.9s linear infinite;
}

@keyframes sidebar-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes sidebar-pulse {
  0%, 100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}
</style>
