<template>
  <div
    class="workbench-shell"
    :class="[
      { 'is-desktop': isDesktop },
      isDesktop ? `is-layout-${layoutMode}` : 'is-layout-mobile'
    ]"
  >
    <div v-if="isDesktop && layoutMode === 'top-nav-split'" class="workbench-topnav-slot">
      <slot name="topnav" />
    </div>

    <div class="workbench-body">
      <div
        v-if="isDesktop && layoutMode !== 'top-nav-split'"
        class="workbench-sidebar-slot"
        :class="{ 'is-rail': layoutMode === 'compact-cards' }"
      >
        <slot name="sidebar" />
      </div>

      <div
        ref="workspaceGrid"
        class="workbench-split"
        :class="[
          { 'is-desktop': isDesktop },
          isDesktop ? `is-mode-${layoutMode}` : '',
          { 'is-inspector-open': isDesktop && layoutMode === 'compact-cards' && (editorOpen || Boolean(selectedEntry)) }
        ]"
        :style="isDesktop && layoutMode !== 'compact-cards' ? gridStyle : undefined"
      >
        <section class="list-pane" aria-label="条目列表区">
          <slot name="header" />

          <div v-if="viewBanner" class="view-context-bar">
            <div class="view-context-bar__left">
              <UiIcon :name="viewBanner.icon" :size="15" />
              <strong class="view-context-bar__title">{{ viewBanner.title }}</strong>
              <UiBadge :tone="viewBanner.tone" size="sm">{{ entries.length }}</UiBadge>
            </div>
            <div class="view-context-bar__actions">
              <UiButton
                v-if="sidebarView === 'folder' && activeFolderId"
                variant="subtle"
                size="xs"
                @click="emit('create', activeFolderId)"
              >
                <UiIcon name="plus" :size="13" />
                <span>新建子项</span>
              </UiButton>
              <UiButton
                v-if="sidebarView === 'trash' && entries.length > 0"
                variant="danger"
                size="xs"
                @click="emit('purge-all-trashed')"
              >
                <UiIcon name="trash" :size="13" />
                <span>清空回收站</span>
              </UiButton>
              <UiButton
                variant="ghost"
                size="xs"
                @click="emit('reset-view')"
              >
                全部
              </UiButton>
            </div>
          </div>

          <div class="list-pane__scroll">
            <EntryList
              :entries="entries"
              :selected-id="selectedEntry?.id || ''"
              :auto-expand="autoExpand"
              :draggable-enabled="draggableEnabled"
              :favorite-ids="favoriteIds"
              :selection-mode="selectionMode"
              :selected-ids="selectedIds"
              :expanded-ids="expandedIds"
              :list-style="isDesktop ? listStyle : 'rows'"
              :density="density"
              :depth="0"
              @view="emit('view', $event)"
              @edit="emit('edit', $event)"
              @move="emit('move', $event)"
              @duplicate="emit('duplicate', $event)"
              @delete="emit('delete', $event)"
              @create="emit('create', $event)"
              @move-entry="emit('move-entry', $event)"
              @context-menu="emit('context-menu', $event)"
              @toggle-favorite="emit('toggle-favorite', $event)"
              @toggle-selection="emit('toggle-selection', $event)"
              @open-website="emit('open-website', $event)"
              @copy="emit('copy', $event)"
              @copy-password="emit('copy-password', $event)"
              @toggle-expand="emit('toggle-expand', $event)"
              @folder-action="emit('folder-action', $event)"
            />
          </div>
        </section>

        <div
          v-if="isDesktop && layoutMode !== 'compact-cards'"
          class="pane-resizer"
          role="separator"
          aria-label="调整列表宽度"
          aria-orientation="vertical"
          :aria-valuemin="paneWidthMin"
          :aria-valuemax="paneWidthMax"
          :aria-valuenow="paneWidth"
          tabindex="0"
          @keydown="emit('resize-keyboard', $event)"
          @pointerdown="emit('resize-pointer', $event)"
        />

        <aside
          v-if="isDesktop && (layoutMode !== 'compact-cards' || editorOpen || Boolean(selectedEntry))"
          class="detail-pane"
          :class="{ 'is-inspector-drawer': layoutMode === 'compact-cards' }"
          aria-label="条目详情与编辑区"
        >
          <div v-if="layoutMode === 'compact-cards' && !editorOpen && selectedEntry" class="inspector-drawer-bar">
            <span class="inspector-drawer-bar__title">条目详情</span>
            <button
              type="button"
              class="inspector-drawer-bar__close"
              aria-label="收起详情抽屉"
              title="收起详情抽屉"
              @click="emit('close-detail')"
            >
              <UiIcon name="close" :size="15" />
            </button>
          </div>

          <slot v-if="editorOpen" name="editor" />

          <div v-else-if="selectedEntry" class="detail-pane__scroll">
            <DetailContent
              :entry="selectedEntry"
              :show-password="showPassword"
              :password-mask="passwordMask"
              :totp-code="totpCode"
              :totp-remaining="totpRemaining"
              :totp-progress="totpProgress"
              :linked-passkeys="linkedPasskeys"
              :attachment-busy="attachmentBusy"
              :attachment-actions-supported="attachmentActionsSupported"
              @edit="emit('edit', $event)"
              @move="emit('move', $event)"
              @duplicate="emit('duplicate', $event)"
              @delete="emit('delete', $event)"
              @disable="emit('disable', $event)"
              @restore="emit('restore', $event)"
              @purge="emit('purge', $event)"
              @restore-history="(entryId, historyId) => emit('restore-history', entryId, historyId)"
              @clear-history="emit('clear-history', $event)"
              @copy="emit('copy', $event)"
              @open-website="emit('open-website', $event)"
              @toggle-password="emit('toggle-password')"
              @refresh-totp="emit('refresh-totp')"
              @open-passkey="emit('open-passkey', $event)"
              @unlink-passkey="emit('unlink-passkey', $event)"
              @add-attachment="(entryId, file) => emit('add-attachment', entryId, file)"
              @save-attachment="(entryId, attachmentId) => emit('save-attachment', entryId, attachmentId)"
              @remove-attachment="(entryId, attachmentId) => emit('remove-attachment', entryId, attachmentId)"
            />
          </div>

          <div v-else class="detail-pane__empty">
            <UiEmpty
              icon="vault"
              title="选择一个条目查看详情"
              description="在左侧列表中点击条目进行查看，或使用快捷键快速新建与检索凭据。"
            >
              <UiButton variant="primary" size="sm" @click="emit('create-login')">
                <UiIcon name="plus" :size="14" />
                <span>新建登录</span>
              </UiButton>
              <UiButton variant="secondary" size="sm" @click="emit('open-quick-access')">
                <UiIcon name="search" :size="14" />
                <span>命令面板 Ctrl+K</span>
              </UiButton>
            </UiEmpty>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DetailContent from '../DetailContent.vue'
import EntryList, { type EntryFolderActionPayload } from '../EntryList.vue'
import { UiBadge, UiButton, UiEmpty, UiIcon } from '../ui'
import type { UiIconName } from '../ui'
import { useAppStores, type SidebarView } from '../../stores'
import type { VaultEntry } from '../../types'
import type { PasskeyPresentationItem } from '../../services/passkeyPresentation.ts'
import type { SkinDensity, SkinLayoutMode, SkinListStyle } from '../../services/skins/index.ts'

const props = withDefaults(defineProps<{
  isDesktop: boolean
  editorOpen: boolean
  layoutMode?: SkinLayoutMode
  listStyle?: SkinListStyle
  density?: SkinDensity
  sidebarView: SidebarView
  activeFolderId: string
  activeFolderTitle: string
  entries: VaultEntry[]
  selectedEntry: VaultEntry | null
  autoExpand: boolean
  draggableEnabled: boolean
  favoriteIds: ReadonlySet<string>
  selectionMode: boolean
  selectedIds: ReadonlySet<string>
  expandedIds: ReadonlySet<string>
  gridStyle: Record<string, string>
  paneWidth: number
  paneWidthMin: number
  paneWidthMax: number
  showPassword: boolean
  passwordMask: string
  totpCode: string
  totpRemaining: number
  totpProgress: number
  linkedPasskeys: PasskeyPresentationItem[]
  attachmentBusy: boolean
  attachmentActionsSupported: boolean
}>(), {
  layoutMode: 'three-pane',
  listStyle: 'rows',
  density: 'comfortable'
})

const emit = defineEmits<{
  view: [entry: VaultEntry]
  edit: [entry: VaultEntry]
  move: [entryId: string]
  duplicate: [entryId: string]
  delete: [entryId: string]
  create: [parentId: string]
  'create-login': []
  'open-quick-access': []
  'reset-view': []
  'purge-all-trashed': []
  'close-detail': []
  'move-entry': [payload: { entryId: string; targetParentId: string; targetIndex: number }]
  'context-menu': [payload: { entry: VaultEntry; x: number; y: number }]
  'toggle-favorite': [entryId: string]
  'toggle-selection': [entryId: string]
  'toggle-expand': [folderId: string]
  'folder-action': [payload: EntryFolderActionPayload]
  disable: [entryId: string]
  restore: [entryId: string]
  purge: [entryId: string]
  'restore-history': [entryId: string, historyId: string]
  'clear-history': [entryId: string]
  copy: [value: string]
  'copy-password': [entryId: string]
  'open-website': [domain: string]
  'toggle-password': []
  'refresh-totp': []
  'open-passkey': [passkeyId: string]
  'unlink-passkey': [passkeyId: string]
  'add-attachment': [entryId: string, file: File]
  'save-attachment': [entryId: string, attachmentId: string]
  'remove-attachment': [entryId: string, attachmentId: string]
  'resize-keyboard': [event: KeyboardEvent]
  'resize-pointer': [event: PointerEvent]
}>()

const { ui } = useAppStores()
const workspaceGrid = ui.workspaceGrid

const viewBanner = computed<{
  title: string
  icon: UiIconName
  tone: 'neutral' | 'warning' | 'danger' | 'brand'
} | null>(() => {
  if (props.sidebarView === 'archived') {
    return { title: '已归档', icon: 'archive', tone: 'warning' }
  }
  if (props.sidebarView === 'trash') {
    return { title: '回收站', icon: 'trash', tone: 'danger' }
  }
  if (props.sidebarView === 'favorites') {
    return { title: '收藏夹', icon: 'star', tone: 'brand' }
  }
  if (props.sidebarView === 'recent') {
    return { title: '最近使用', icon: 'clock', tone: 'brand' }
  }
  if (props.sidebarView === 'folder' && props.activeFolderId) {
    return { title: props.activeFolderTitle || '分组', icon: 'folder-open', tone: 'brand' }
  }
  return null
})
</script>

<style scoped>
.workbench-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--app-bg);
}

.workbench-topnav-slot {
  flex-shrink: 0;
  width: 100%;
}

.workbench-body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

.workbench-sidebar-slot {
  flex-shrink: 0;
  height: 100%;
  display: flex;
}

.workbench-sidebar-slot.is-rail :deep(.workspace-sidebar.is-collapsed) {
  width: 56px;
  min-width: 56px;
}

.workbench-split {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workbench-split.is-desktop {
  display: grid;
  grid-template-columns: var(--vault-pane-width, 340px) 6px minmax(340px, 1fr);
}

.workbench-split.is-desktop.is-mode-top-nav-split {
  grid-template-columns: var(--vault-pane-width, 380px) 6px minmax(360px, 1fr);
}

.workbench-split.is-desktop.is-mode-compact-cards {
  display: flex;
  flex-direction: row;
}

.workbench-split.is-desktop.is-mode-compact-cards .list-pane {
  flex: 1 1 auto;
  border-right: 0;
  background-color: var(--app-bg);
}

.detail-pane.is-inspector-drawer {
  width: 420px;
  min-width: 360px;
  max-width: 46vw;
  flex-shrink: 0;
  border-left: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  box-shadow: var(--shadow-md);
}

.inspector-drawer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
  flex-shrink: 0;
}

.inspector-drawer-bar__title {
  font-size: var(--app-font-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}

.inspector-drawer-bar__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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

.inspector-drawer-bar__close:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.list-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background-color: var(--panel-bg);
  border-right: 1px solid var(--border-soft);
}

.workbench-split:not(.is-desktop) .list-pane {
  border-right: 0;
  flex: 1 1 auto;
}

.view-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  background-color: var(--surface-container-low);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.view-context-bar__left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-main);
}

.view-context-bar__title {
  font-size: var(--app-font-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-context-bar__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.list-pane__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.pane-resizer {
  position: relative;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  background-color: var(--app-bg);
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.pane-resizer::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 2px;
  width: 2px;
  height: 36px;
  transform: translateY(-50%);
  border-radius: var(--radius-full);
  background-color: var(--border-strong);
  opacity: 0.45;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.pane-resizer:hover,
.pane-resizer:focus-visible {
  background-color: var(--brand-soft);
  outline: none;
}

.pane-resizer:hover::after,
.pane-resizer:focus-visible::after {
  opacity: 1;
  background-color: var(--brand);
}

.detail-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background-color: var(--app-bg);
  overflow: hidden;
}

.detail-pane__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.detail-pane__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
</style>
