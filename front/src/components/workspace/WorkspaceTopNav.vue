<template>
  <nav class="workspace-topnav" aria-label="顶栏导航">
    <div class="topnav-left">
      <div class="topnav-brand" title="我的密码库">
        <span class="topnav-brand__logo" aria-hidden="true">
          <UiIcon name="shield" :size="15" />
        </span>
        <span class="topnav-brand__title">密码库</span>
      </div>

      <div class="topnav-divider" aria-hidden="true" />

      <div class="topnav-views no-scrollbar" role="tablist" aria-label="保险库视图">
        <button
          v-for="view in primaryViews"
          :key="view.key"
          type="button"
          role="tab"
          class="topnav-tab"
          :class="{
            'is-active': activeView === view.key,
            'is-danger-tone': view.key === 'trash'
          }"
          :aria-selected="activeView === view.key"
          @click="emit('select-view', view.key)"
        >
          <UiIcon :name="view.icon" :size="14" />
          <span>{{ view.label }}</span>
          <span class="topnav-count" :class="{ 'is-empty': view.count === 0 }">{{ view.count }}</span>
        </button>
      </div>

      <UiDropdown
        :open="folderDropdownOpen"
        align="left"
        :items="folderDropdownItems"
        @update:open="folderDropdownOpen = $event"
        @select="handleFolderDropdownSelect"
      >
        <template #trigger>
          <button
            type="button"
            class="topnav-tab"
            :class="{ 'is-active': activeView === 'folder' }"
            aria-label="选择分组"
          >
            <UiIcon :name="activeView === 'folder' ? 'folder-open' : 'folder'" :size="14" />
            <span>{{ activeView === 'folder' && activeFolderTitle ? activeFolderTitle : '分组' }}</span>
            <UiIcon name="chevron-down" :size="12" />
          </button>
        </template>
      </UiDropdown>
    </div>

    <div class="topnav-right">
      <button
        type="button"
        class="topnav-quick-btn"
        title="快速访问 (Ctrl+K)"
        aria-label="打开快速访问命令面板"
        @click="emit('open-quick-access')"
      >
        <UiIcon name="search" :size="13" />
        <kbd>Ctrl+K</kbd>
      </button>

      <UiDropdown
        :open="toolsDropdownOpen"
        align="right"
        :items="toolsDropdownItems"
        @update:open="toolsDropdownOpen = $event"
        @select="handleToolsSelect"
      >
        <template #trigger>
          <button
            type="button"
            class="topnav-action-btn"
            aria-label="工具与安全"
            title="工具与安全"
          >
            <UiIcon name="wand" :size="14" />
            <span>工具</span>
            <span v-if="(counts.healthIssues ?? 0) > 0" class="topnav-alert-dot" aria-hidden="true" />
            <UiIcon name="chevron-down" :size="12" />
          </button>
        </template>
      </UiDropdown>

      <button
        type="button"
        class="topnav-icon-btn"
        :class="{ 'is-syncing': cloudSyncing }"
        :disabled="cloudSyncing"
        :title="cloudStatusText || '云同步'"
        :aria-label="cloudStatusText || '云同步'"
        @click="emit('trigger-sync')"
      >
        <UiIcon :name="cloudSyncing ? 'refresh' : 'cloud'" :size="15" :class="{ 'is-spinning': cloudSyncing }" />
      </button>

      <button
        type="button"
        class="topnav-icon-btn"
        title="设置"
        aria-label="设置"
        @click="emit('open-settings')"
      >
        <UiIcon name="settings" :size="15" />
      </button>

      <button
        type="button"
        class="topnav-icon-btn is-lock"
        title="锁定保险库 (Ctrl+L)"
        aria-label="锁定保险库 (Ctrl+L)"
        @click="emit('lock')"
      >
        <UiIcon name="lock" :size="15" />
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { UiDropdown, UiIcon } from '../ui'
import type { UiDropdownItem, UiIconName } from '../ui'
import type { VaultEntry } from '../../types'
import type { WorkspaceSidebarCounts, WorkspaceSidebarView } from './WorkspaceSidebar.vue'

const props = withDefaults(defineProps<{
  activeView: WorkspaceSidebarView
  activeFolderId?: string
  activeFolderTitle?: string
  folders: VaultEntry[]
  counts: WorkspaceSidebarCounts
  cloudStatusText?: string
  cloudSyncing?: boolean
}>(), {
  activeFolderId: '',
  activeFolderTitle: '',
  cloudStatusText: '',
  cloudSyncing: false
})

const emit = defineEmits<{
  'select-view': [view: WorkspaceSidebarView]
  'select-folder': [folderId: string]
  'create-folder': [parentId: string]
  'open-health': []
  'open-passkeys': []
  'open-generator': []
  'open-import': []
  'open-quick-access': []
  'trigger-sync': []
  'open-settings': []
  lock: []
}>()

const folderDropdownOpen = ref(false)
const toolsDropdownOpen = ref(false)

const primaryViews = computed<Array<{
  key: Exclude<WorkspaceSidebarView, 'folder'>
  label: string
  icon: UiIconName
  count: number
}>>(() => [
  { key: 'all', label: '全部', icon: 'shield', count: props.counts.all },
  { key: 'favorites', label: '收藏', icon: 'star', count: props.counts.favorites },
  { key: 'recent', label: '最近', icon: 'clock', count: props.counts.recent },
  { key: 'archived', label: '已归档', icon: 'archive', count: props.counts.archived },
  { key: 'trash', label: '回收站', icon: 'trash', count: props.counts.trash }
])

const folderDropdownItems = computed<UiDropdownItem[]>(() => {
  const items: UiDropdownItem[] = []
  const walk = (nodes: VaultEntry[], depth: number) => {
    for (const node of nodes) {
      if (node.kind !== 'folder' || node.status === 'trashed' || node.status === 'disabled') continue
      const prefix = depth > 0 ? `${'  '.repeat(depth)}└ ` : ''
      items.push({
        key: `folder:${node.id}`,
        label: `${prefix}${node.title || '未命名分组'}`,
        icon: node.id === props.activeFolderId && props.activeView === 'folder' ? 'folder-open' : 'folder'
      })
      if (node.children?.length) {
        walk(node.children, Math.min(depth + 1, 3))
      }
    }
  }
  walk(props.folders, 0)
  items.push({
    key: 'create-folder',
    label: '新建分组',
    icon: 'plus',
    divider: items.length > 0
  })
  return items
})

const toolsDropdownItems = computed<UiDropdownItem[]>(() => [
  {
    key: 'health',
    label: (props.counts.healthIssues ?? 0) > 0
      ? `密码健康 (${props.counts.healthIssues} 项待处理)`
      : '密码健康检查',
    icon: 'shield'
  },
  {
    key: 'passkeys',
    label: (props.counts.passkeys ?? 0) > 0
      ? `通行密钥 (${props.counts.passkeys})`
      : '通行密钥管理',
    icon: 'key'
  },
  { key: 'generator', label: '密码生成器', icon: 'wand' },
  { key: 'import', label: '导入数据', icon: 'upload', divider: true }
])

function handleFolderDropdownSelect(item: UiDropdownItem): void {
  folderDropdownOpen.value = false
  if (item.key === 'create-folder') {
    emit('create-folder', '')
    return
  }
  if (item.key.startsWith('folder:')) {
    emit('select-folder', item.key.slice('folder:'.length))
  }
}

function handleToolsSelect(item: UiDropdownItem): void {
  toolsDropdownOpen.value = false
  if (item.key === 'health') emit('open-health')
  else if (item.key === 'passkeys') emit('open-passkeys')
  else if (item.key === 'generator') emit('open-generator')
  else if (item.key === 'import') emit('open-import')
}
</script>

<style scoped>
.workspace-topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: var(--topbar-height);
  padding: 0 14px;
  background-color: var(--surface-sidebar);
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-main);
  flex-shrink: 0;
  user-select: none;
}

.topnav-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.topnav-brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.topnav-brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--panel-bg);
  color: var(--brand);
}

.topnav-brand__title {
  font-size: var(--app-font-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-main);
}

.topnav-divider {
  width: 1px;
  height: 18px;
  background-color: var(--border-soft);
  flex-shrink: 0;
}

.topnav-views {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow-x: auto;
}

.topnav-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 29px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.topnav-tab:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.topnav-tab.is-active {
  background-color: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}

.topnav-tab.is-active.is-danger-tone {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.topnav-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.topnav-tab.is-active .topnav-count {
  color: inherit;
}

.topnav-count.is-empty {
  opacity: 0.5;
}

.topnav-right {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.topnav-quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.topnav-quick-btn:hover {
  border-color: var(--brand);
  color: var(--text-main);
}

.topnav-quick-btn kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.topnav-action-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.topnav-action-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.topnav-alert-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--warning);
}

.topnav-icon-btn {
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
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.topnav-icon-btn:hover:not(:disabled) {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.topnav-icon-btn.is-lock:hover:not(:disabled) {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.topnav-icon-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.is-spinning {
  animation: topnav-spin 0.9s linear infinite;
}

@keyframes topnav-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
