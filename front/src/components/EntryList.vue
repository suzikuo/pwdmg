<template>
  <div
    class="entry-list"
    :class="[
      { 'is-root': depth === 0 },
      `is-style-${listStyle}`,
      `is-density-${density}`
    ]"
    :style="{ '--depth': `${depth}` }"
    :role="depth === 0 ? 'tree' : 'group'"
    :aria-label="depth === 0 ? '条目列表' : undefined"
  >
    <UiEmpty
      v-if="entries.length === 0 && depth === 0"
      icon="search"
      title="没有匹配的条目"
      description="尝试调整搜索关键词、切换筛选条件，或新建一条记录。"
    />

    <div
      v-if="listStyle === 'table' && depth === 0 && entries.length > 0"
      class="entry-table-head"
      aria-hidden="true"
    >
      <span class="entry-table-head__col is-title">标题</span>
      <span class="entry-table-head__col is-account">账号</span>
      <span class="entry-table-head__col is-domain">域名</span>
      <span class="entry-table-head__col is-actions">操作</span>
    </div>

    <template v-for="(entry, index) in entries" :key="entry.id">
      <div
        v-if="draggableEnabled"
        class="entry-drop-zone"
        :data-drop-parent-id="parentId"
        :data-drop-index="index"
        data-drop-kind="line"
      />

      <div
        class="entry-block"
        :class="{
          'is-folder': entry.kind === 'folder',
          'is-login': entry.kind !== 'folder',
          'is-selected': entry.id === selectedId,
          'is-batch-selected': selectionMode && selectedIds.has(entry.id),
          'is-draggable': draggableEnabled,
          'is-dragging': draggingId === entry.id,
          'is-menu-open': openFolderMenuId === entry.id
        }"
        :data-drop-parent-id="entry.kind === 'folder' && draggableEnabled ? entry.id : undefined"
        :data-drop-index="entry.kind === 'folder' && draggableEnabled ? 0 : undefined"
        data-drop-kind="folder"
        @pointerdown.stop="preparePointerDrag($event, entry.id)"
      >
        <!-- Card Gallery Layout for non-folder entries -->
        <div
          v-if="listStyle === 'cards' && entry.kind !== 'folder'"
          class="entry-row entry-card"
          role="treeitem"
          tabindex="0"
          :aria-selected="selectionMode ? selectedIds.has(entry.id) : entry.id === selectedId"
          @contextmenu.stop.prevent="handleContextMenu($event, entry)"
          @click="handlePrimary(entry)"
          @keydown="handleRowKeydown($event, entry)"
        >
          <div class="entry-card__top">
            <span
              v-if="selectionMode"
              class="entry-checkbox"
              :class="{ 'is-checked': selectedIds.has(entry.id) }"
              aria-hidden="true"
            >
              <UiIcon v-if="selectedIds.has(entry.id)" name="check" :size="12" :stroke-width="2.5" />
            </span>

            <span class="entry-avatar" :class="`is-${entry.kind}`" aria-hidden="true">
              <UiIcon :name="resolveKindIcon(entry)" :size="16" />
            </span>

            <div class="entry-card__head-text">
              <div class="entry-title-row">
                <span class="entry-title">{{ entry.title || '未命名条目' }}</span>
                <UiBadge v-if="entry.status === 'disabled'" tone="warning" size="sm">归档</UiBadge>
                <UiBadge v-if="entry.status === 'trashed'" tone="danger" size="sm">回收站</UiBadge>
              </div>
              <span v-if="entry.kind === 'login'" class="entry-card__account">
                {{ primaryAccount(entry) || '未设置账号' }}
              </span>
              <span v-else class="entry-card__account">
                {{ entry.note || customFieldSummary(entry) || entryKindLabel(entry.kind) }}
              </span>
            </div>

            <button
              v-if="!selectionMode"
              class="entry-fav-btn"
              type="button"
              :class="{ 'is-active': favoriteIds.has(entry.id) }"
              :aria-label="favoriteIds.has(entry.id) ? '取消收藏' : '收藏'"
              :aria-pressed="favoriteIds.has(entry.id)"
              :title="favoriteIds.has(entry.id) ? '取消收藏' : '收藏'"
              @click.stop="emit('toggle-favorite', entry.id)"
            >
              <UiIcon :name="favoriteIds.has(entry.id) ? 'star-filled' : 'star'" :size="14" />
            </button>
          </div>

          <div v-if="entry.domains?.[0]" class="entry-card__pills">
            <span class="entry-card__domain-pill">{{ entry.domains[0] }}</span>
          </div>

          <div v-if="!selectionMode && entry.kind === 'login'" class="entry-card__footer" @click.stop>
            <button
              v-if="primaryAccount(entry)"
              type="button"
              class="entry-card__action"
              title="复制账号"
              @click="emit('copy', primaryAccount(entry))"
            >
              <UiIcon name="copy" :size="12" />
              <span>复制账号</span>
            </button>
            <button
              v-if="entry.password"
              type="button"
              class="entry-card__action"
              title="复制密码"
              @click="emit('copy-password', entry.id)"
            >
              <UiIcon name="key" :size="12" />
              <span>复制密码</span>
            </button>
            <button
              v-if="entry.domains?.[0]"
              type="button"
              class="entry-card__action is-icon-only"
              title="打开网站"
              aria-label="打开网站"
              @click="emit('open-website', entry.domains[0])"
            >
              <UiIcon name="external-link" :size="12" />
            </button>
          </div>
        </div>

        <!-- Standard Rows / Table / Folder Row -->
        <div
          v-else
          class="entry-row"
          :class="{ 'is-table-row': listStyle === 'table' && entry.kind !== 'folder' }"
          role="treeitem"
          tabindex="0"
          :aria-selected="selectionMode ? selectedIds.has(entry.id) : entry.id === selectedId"
          :aria-expanded="entry.kind === 'folder' ? isOpen(entry.id) : undefined"
          @contextmenu.stop.prevent="handleContextMenu($event, entry)"
          @click="handlePrimary(entry)"
          @keydown="handleRowKeydown($event, entry)"
        >
          <span
            v-if="selectionMode"
            class="entry-checkbox"
            :class="{ 'is-checked': selectedIds.has(entry.id) }"
            aria-hidden="true"
          >
            <UiIcon v-if="selectedIds.has(entry.id)" name="check" :size="12" :stroke-width="2.5" />
          </span>

          <span
            class="entry-avatar"
            :class="`is-${entry.kind}`"
            aria-hidden="true"
          >
            <UiIcon :name="resolveKindIcon(entry)" :size="listStyle === 'table' ? 14 : 16" />
          </span>

          <div class="entry-body">
            <div class="entry-title-row">
              <span class="entry-title">{{ entry.title || '未命名条目' }}</span>
              <UiBadge v-if="entry.status === 'disabled'" tone="warning" size="sm">归档</UiBadge>
              <UiBadge v-if="entry.status === 'trashed'" tone="danger" size="sm">回收站</UiBadge>
              <UiBadge v-if="entry.kind === 'folder'" tone="neutral" size="sm">
                {{ entry.children?.length || 0 }} 项
              </UiBadge>
            </div>

            <template v-if="listStyle !== 'table'">
              <div v-if="entry.kind === 'login'" class="entry-subtitle">
                <span class="entry-subtitle-primary">{{ primaryAccount(entry) || '未设置账号' }}</span>
                <span v-if="entry.domains?.[0]" class="entry-subtitle-dot" aria-hidden="true">·</span>
                <span v-if="entry.domains?.[0]" class="entry-subtitle-domain">{{ entry.domains[0] }}</span>
              </div>
              <div v-else-if="entry.kind !== 'folder'" class="entry-subtitle">
                <span class="entry-subtitle-primary">{{ entry.note || customFieldSummary(entry) || entryKindLabel(entry.kind) }}</span>
              </div>
            </template>
          </div>

          <template v-if="listStyle === 'table' && entry.kind !== 'folder'">
            <span class="entry-table-cell is-account">
              {{ entry.kind === 'login' ? (primaryAccount(entry) || '—') : (entry.note || customFieldSummary(entry) || entryKindLabel(entry.kind)) }}
            </span>
            <span class="entry-table-cell is-domain">
              {{ entry.domains?.[0] || '—' }}
            </span>
          </template>

          <div v-if="!selectionMode" class="entry-trailing" @click.stop>
            <div v-if="entry.kind === 'login'" class="entry-quick-actions">
              <button
                v-if="primaryAccount(entry)"
                class="entry-action-btn"
                type="button"
                title="复制账号"
                aria-label="复制账号"
                @click="emit('copy', primaryAccount(entry))"
              >
                <UiIcon name="copy" :size="14" />
              </button>
              <button
                v-if="entry.password"
                class="entry-action-btn"
                type="button"
                title="复制密码"
                aria-label="复制密码"
                @click="emit('copy-password', entry.id)"
              >
                <UiIcon name="key" :size="14" />
              </button>
              <button
                v-if="entry.domains?.[0]"
                class="entry-action-btn"
                type="button"
                title="打开网站"
                aria-label="打开网站"
                @click="emit('open-website', entry.domains[0])"
              >
                <UiIcon name="external-link" :size="14" />
              </button>
            </div>

            <UiDropdown
              v-if="entry.kind === 'folder'"
              :open="openFolderMenuId === entry.id"
              align="right"
              :items="folderDropdownItems"
              @update:open="handleFolderMenuToggle(entry.id, $event)"
              @select="handleFolderAction($event, entry)"
            >
              <template #trigger>
                <button
                  class="entry-action-btn entry-folder-more"
                  type="button"
                  :aria-label="`分组 ${entry.title || '未命名'} 操作`"
                  title="分组操作"
                >
                  <UiIcon name="more" :size="15" />
                </button>
              </template>
            </UiDropdown>

            <button
              v-if="entry.kind !== 'folder'"
              class="entry-fav-btn"
              type="button"
              :class="{ 'is-active': favoriteIds.has(entry.id) }"
              :aria-label="favoriteIds.has(entry.id) ? '取消收藏' : '收藏'"
              :aria-pressed="favoriteIds.has(entry.id)"
              :title="favoriteIds.has(entry.id) ? '取消收藏' : '收藏'"
              @click="emit('toggle-favorite', entry.id)"
            >
              <UiIcon :name="favoriteIds.has(entry.id) ? 'star-filled' : 'star'" :size="14" />
            </button>

            <span v-if="entry.kind === 'folder'" class="entry-chevron" aria-hidden="true">
              <UiIcon :name="isOpen(entry.id) ? 'chevron-down' : 'chevron-right'" :size="15" />
            </span>
          </div>
        </div>

        <div v-if="entry.kind === 'folder' && isOpen(entry.id)" class="folder-children">
          <EntryList
            :entries="entry.children || []"
            :selected-id="selectedId"
            :parent-id="entry.id"
            :auto-expand="autoExpand"
            :draggable-enabled="draggableEnabled"
            :favorite-ids="favoriteIds"
            :selection-mode="selectionMode"
            :selected-ids="selectedIds"
            :expanded-ids="expandedIds"
            :list-style="listStyle"
            :density="density"
            :depth="depth + 1"
            @view="$emit('view', $event)"
            @edit="$emit('edit', $event)"
            @move="$emit('move', $event)"
            @duplicate="$emit('duplicate', $event)"
            @delete="$emit('delete', $event)"
            @create="$emit('create', $event)"
            @move-entry="$emit('move-entry', $event)"
            @context-menu="$emit('context-menu', $event)"
            @toggle-favorite="$emit('toggle-favorite', $event)"
            @toggle-selection="$emit('toggle-selection', $event)"
            @open-website="$emit('open-website', $event)"
            @copy="$emit('copy', $event)"
            @copy-password="$emit('copy-password', $event)"
            @toggle-expand="$emit('toggle-expand', $event)"
            @folder-action="$emit('folder-action', $event)"
          />
        </div>
      </div>
    </template>

    <div
      v-if="draggableEnabled"
      class="entry-drop-zone is-tail"
      :data-drop-parent-id="parentId"
      :data-drop-index="entries.length"
      data-drop-kind="line"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { UiBadge, UiDropdown, UiEmpty, UiIcon } from './ui'
import type { UiDropdownItem, UiIconName } from './ui'
import { entryKindLabel } from '../services/entryKinds.ts'
import type { SkinDensity, SkinListStyle } from '../services/skins/index.ts'
import type { VaultEntry } from '../types'

defineOptions({ name: 'EntryList' })

const LONG_PRESS_MS = 320
const LONG_PRESS_MOVE_LIMIT = 14

export type EntryFolderActionPayload = {
  action: 'edit' | 'create-child' | 'move' | 'delete'
  entry: VaultEntry
}

const props = withDefaults(defineProps<{
  entries: VaultEntry[]
  selectedId?: string
  parentId?: string
  autoExpand?: boolean
  draggableEnabled?: boolean
  favoriteIds?: ReadonlySet<string>
  selectionMode?: boolean
  selectedIds?: ReadonlySet<string>
  expandedIds?: ReadonlySet<string>
  listStyle?: SkinListStyle | 'compact'
  density?: SkinDensity
  depth?: number
}>(), {
  selectedId: '',
  parentId: '',
  autoExpand: false,
  draggableEnabled: true,
  favoriteIds: () => new Set<string>(),
  selectionMode: false,
  selectedIds: () => new Set<string>(),
  expandedIds: undefined,
  listStyle: 'rows',
  density: 'comfortable',
  depth: 0
})

const emit = defineEmits<{
  view: [entry: VaultEntry]
  edit: [entry: VaultEntry]
  move: [entryId: string]
  duplicate: [entryId: string]
  delete: [entryId: string]
  create: [parentId: string]
  'move-entry': [payload: { entryId: string; targetParentId: string; targetIndex: number }]
  'context-menu': [payload: { entry: VaultEntry; x: number; y: number }]
  'toggle-favorite': [entryId: string]
  'toggle-selection': [entryId: string]
  'open-website': [domain: string]
  copy: [value: string]
  'copy-password': [entryId: string]
  'toggle-expand': [folderId: string]
  'folder-action': [payload: EntryFolderActionPayload]
}>()

const localExpanded = ref(new Set<string>())
const openFolderMenuId = ref('')
const draggingId = ref('')
let dragGhostEl: HTMLElement | null = null
let grabOffsetX = 0
let grabOffsetY = 0

let pointerDrag: {
  entryId: string
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  active: boolean
  target: HTMLElement | null
  source: HTMLElement | null
  timer: number
} | null = null
let suppressNextClick = false

const folderDropdownItems: UiDropdownItem[] = [
  { key: 'create-child', label: '新建子项', icon: 'plus' },
  { key: 'edit', label: '重命名分组', icon: 'edit' },
  { key: 'move', label: '移动分组', icon: 'move' },
  { key: 'delete', label: '删除分组', icon: 'trash', danger: true, divider: true }
]

onBeforeUnmount(() => {
  cleanupPointerDrag()
})

function primaryAccount(entry: VaultEntry): string {
  return entry.username || entry.email || entry.phone || ''
}

function resolveKindIcon(entry: VaultEntry): UiIconName {
  if (entry.kind === 'folder') return isOpen(entry.id) ? 'folder-open' : 'folder'
  if (entry.kind === 'login') return 'key'
  if (entry.kind === 'secure-note') return 'edit'
  if (entry.kind === 'card') return 'lock'
  if (entry.kind === 'identity') return 'info'
  if (entry.kind === 'api-key') return 'command'
  return 'key'
}

function isOpen(entryId: string): boolean {
  if (props.autoExpand) return true
  if (props.expandedIds) return props.expandedIds.has(entryId)
  return localExpanded.value.has(entryId)
}

function toggleFolder(entryId: string) {
  emit('toggle-expand', entryId)
  if (!props.expandedIds) {
    const next = new Set(localExpanded.value)
    if (next.has(entryId)) next.delete(entryId)
    else next.add(entryId)
    localExpanded.value = next
  }
}

function ensureFolderExpanded(entryId: string) {
  if (!entryId || isOpen(entryId)) return
  toggleFolder(entryId)
}

function handleFolderMenuToggle(folderId: string, open: boolean) {
  openFolderMenuId.value = open ? folderId : (openFolderMenuId.value === folderId ? '' : openFolderMenuId.value)
}

function handleFolderAction(item: UiDropdownItem, entry: VaultEntry) {
  openFolderMenuId.value = ''
  const action = item.key as EntryFolderActionPayload['action']
  emit('folder-action', { action, entry })
}

function handlePrimary(entry: VaultEntry) {
  if (suppressNextClick) return
  if (props.selectionMode) {
    emit('toggle-selection', entry.id)
    return
  }
  if (entry.kind === 'folder') {
    toggleFolder(entry.id)
    return
  }
  emit('view', entry)
}

function handleRowKeydown(event: KeyboardEvent, entry: VaultEntry) {
  const rowEl = event.currentTarget as HTMLElement | null
  if (!rowEl || event.target !== rowEl) return

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handlePrimary(entry)
    return
  }

  if (event.key === 'ArrowRight' && entry.kind === 'folder' && !isOpen(entry.id)) {
    event.preventDefault()
    toggleFolder(entry.id)
    return
  }

  if (event.key === 'ArrowLeft' && entry.kind === 'folder' && isOpen(entry.id)) {
    event.preventDefault()
    toggleFolder(entry.id)
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const rootList = rowEl.closest<HTMLElement>('.entry-list.is-root') || rowEl.closest<HTMLElement>('.entry-list')
    if (!rootList) return
    const rows = Array.from(rootList.querySelectorAll<HTMLElement>('.entry-row'))
    const idx = rows.indexOf(rowEl)
    if (idx < 0 || rows.length <= 1) return
    event.preventDefault()
    const nextIdx = event.key === 'ArrowDown'
      ? Math.min(rows.length - 1, idx + 1)
      : Math.max(0, idx - 1)
    const target = rows[nextIdx]
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  }
}

function handleContextMenu(event: MouseEvent, entry: VaultEntry) {
  if (pointerDrag?.active || props.selectionMode) return
  emit('context-menu', { entry, x: event.clientX, y: event.clientY })
}

function customFieldSummary(entry: VaultEntry) {
  return (entry.customFields || []).find((field) => !field.protected && field.value)?.value || ''
}

function createDragGhost(source: HTMLElement, clientX: number, clientY: number) {
  removeDragGhost()
  const row = source.querySelector<HTMLElement>('.entry-row') || source
  const rect = row.getBoundingClientRect()
  grabOffsetX = clientX - rect.left
  grabOffsetY = clientY - rect.top

  const ghost = row.cloneNode(true) as HTMLElement
  ghost.classList.add('entry-drag-ghost')
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.transform = `translate3d(${clientX - grabOffsetX}px, ${clientY - grabOffsetY}px, 0) scale(1.02)`

  document.body.appendChild(ghost)
  dragGhostEl = ghost
}

function updateDragGhost(clientX: number, clientY: number) {
  if (!dragGhostEl) return
  const x = clientX - grabOffsetX
  const y = clientY - grabOffsetY
  dragGhostEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.02)`
}

function removeDragGhost() {
  if (dragGhostEl) {
    dragGhostEl.remove()
    dragGhostEl = null
  }
}

function preparePointerDrag(event: PointerEvent, entryId: string) {
  if (!props.draggableEnabled || event.button > 0) return
  if (isInteractiveTarget(event.target)) return
  cleanupPointerDrag()
  const source = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  pointerDrag = {
    entryId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    active: false,
    target: null,
    source,
    timer: window.setTimeout(activatePointerDrag, LONG_PRESS_MS)
  }
  window.addEventListener('pointermove', movePointerDrag, { passive: false })
  window.addEventListener('pointerup', finishPointerDrag, { once: true })
  window.addEventListener('pointercancel', cancelPointerDrag, { once: true })
}

function activatePointerDrag() {
  if (!pointerDrag) return
  pointerDrag.active = true
  draggingId.value = pointerDrag.entryId
  document.body.classList.add('is-entry-pointer-drag')
  try {
    navigator.vibrate?.(25)
  } catch {}

  if (pointerDrag.source) {
    try {
      pointerDrag.source.setPointerCapture?.(pointerDrag.pointerId)
    } catch {}
    createDragGhost(pointerDrag.source, pointerDrag.lastX, pointerDrag.lastY)
  }
  setPointerDropTarget(findPointerDropTarget(pointerDrag.lastX, pointerDrag.lastY))
}

function movePointerDrag(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
  pointerDrag.lastX = event.clientX
  pointerDrag.lastY = event.clientY
  const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY)
  if (!pointerDrag.active) {
    if (distance > LONG_PRESS_MOVE_LIMIT) cleanupPointerDrag()
    return
  }

  event.preventDefault()
  updateDragGhost(event.clientX, event.clientY)
  maybeAutoScroll(event.clientY)
  setPointerDropTarget(findPointerDropTarget(event.clientX, event.clientY))
}

function finishPointerDrag(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
  const wasActive = pointerDrag.active
  const entryId = pointerDrag.entryId
  const target = pointerDrag.target || findPointerDropTarget(event.clientX, event.clientY)
  cleanupPointerDrag()
  if (wasActive) {
    suppressNextClick = true
    window.setTimeout(() => {
      suppressNextClick = false
    }, 50)
  }
  if (!wasActive || !target) return

  const targetParentId = target.dataset.dropParentId || ''
  const targetIndex = Number(target.dataset.dropIndex || 0)
  if (entryId === targetParentId) return
  if (targetParentId) {
    ensureFolderExpanded(targetParentId)
  }
  emit('move-entry', { entryId, targetParentId, targetIndex })
}

function cancelPointerDrag() {
  cleanupPointerDrag()
}

function cleanupPointerDrag() {
  removeDragGhost()
  if (pointerDrag?.source?.hasPointerCapture?.(pointerDrag.pointerId)) {
    try {
      pointerDrag.source.releasePointerCapture(pointerDrag.pointerId)
    } catch {}
  }
  if (pointerDrag?.target) pointerDrag.target.classList.remove('is-pointer-target')
  if (pointerDrag?.timer) window.clearTimeout(pointerDrag.timer)
  window.removeEventListener('pointermove', movePointerDrag)
  window.removeEventListener('pointerup', finishPointerDrag)
  window.removeEventListener('pointercancel', cancelPointerDrag)
  document.body.classList.remove('is-entry-pointer-drag')
  draggingId.value = ''
  pointerDrag = null
}

function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  return Boolean(element?.closest('button, input, textarea, select, a, .entry-trailing'))
}

function findPointerDropTarget(clientX: number, clientY: number): HTMLElement | null {
  if (!pointerDrag) return null
  const currentDragId = pointerDrag.entryId

  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : []

  for (const element of elements) {
    if (element instanceof HTMLElement && element.classList.contains('entry-drop-zone')) {
      return element
    }
  }

  let targetBlock: HTMLElement | null = null
  for (const element of elements) {
    if (element instanceof HTMLElement) {
      const block = element.closest<HTMLElement>('.entry-block')
      if (block) {
        targetBlock = block
        break
      }
    }
  }

  if (!targetBlock) {
    let closestBlock: HTMLElement | null = null
    let closestDist = Number.POSITIVE_INFINITY
    const allBlocks = document.querySelectorAll<HTMLElement>('.entry-block')
    for (const block of allBlocks) {
      const rect = block.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (clientX < rect.left - 48 || clientX > rect.right + 48) continue
      const dist = Math.abs(clientY - (rect.top + rect.height / 2))
      if (dist < closestDist) {
        closestDist = dist
        closestBlock = block
      }
    }
    if (closestDist <= 80) {
      targetBlock = closestBlock
    }
  }

  if (targetBlock) {
    const isFolder = targetBlock.classList.contains('is-folder')
    const isSelf = targetBlock.classList.contains('is-dragging') || targetBlock.dataset.dropParentId === currentDragId
    const rect = targetBlock.getBoundingClientRect()
    const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5

    if (isFolder && !isSelf && relY >= 0.25 && relY <= 0.75) {
      return targetBlock
    }

    const dropAbove = isFolder ? relY < 0.25 : relY < 0.5
    if (dropAbove) {
      let prev = targetBlock.previousElementSibling
      while (prev && !prev.classList.contains('entry-drop-zone')) {
        prev = prev.previousElementSibling
      }
      if (prev instanceof HTMLElement) return prev
    } else {
      let next = targetBlock.nextElementSibling
      while (next && !next.classList.contains('entry-drop-zone')) {
        next = next.nextElementSibling
      }
      if (next instanceof HTMLElement) return next
    }
  }

  for (const element of elements) {
    if (element instanceof HTMLElement) {
      const list = element.closest<HTMLElement>('.entry-list')
      if (list) {
        const tail = list.querySelector<HTMLElement>(':scope > .entry-drop-zone.is-tail')
        if (tail) return tail
      }
    }
  }

  return null
}

function setPointerDropTarget(target: HTMLElement | null) {
  if (!pointerDrag || pointerDrag.target === target) return
  pointerDrag.target?.classList.remove('is-pointer-target')
  pointerDrag.target = target
  pointerDrag.target?.classList.add('is-pointer-target')
}

function maybeAutoScroll(clientY: number) {
  const margin = 72
  const maxSpeed = 16
  let delta = 0
  if (clientY < margin) {
    delta = -Math.round(maxSpeed * (1 - Math.max(0, clientY) / margin))
  } else if (clientY > window.innerHeight - margin) {
    delta = Math.round(maxSpeed * (1 - Math.max(0, window.innerHeight - clientY) / margin))
  }
  if (delta === 0) return

  window.scrollBy({ top: delta })
  const workspaceGrid = document.querySelector('.workspace-grid-host, .vault-pane, .workspace')
  if (workspaceGrid && workspaceGrid.scrollHeight > workspaceGrid.clientHeight) {
    workspaceGrid.scrollBy({ top: delta })
  }
}
</script>

<style scoped>
.entry-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.entry-list.is-root {
  padding: 6px 8px 18px;
}

.entry-block {
  position: relative;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background-color: transparent;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.entry-block.is-menu-open {
  z-index: 20;
}

.entry-block.is-selected {
  background-color: var(--brand-soft);
  border-color: var(--border-strong);
}

.entry-block.is-batch-selected {
  background-color: var(--brand-soft);
  border-color: var(--brand);
}

.entry-block.is-dragging {
  opacity: 0.42;
}

.entry-block.is-pointer-target {
  border-color: var(--brand);
  background-color: var(--brand-soft-hover);
  box-shadow: var(--focus-ring);
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 7px 10px;
  padding-left: calc(10px + var(--depth, 0) * 16px);
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.entry-row:hover {
  background-color: var(--surface-container-low);
}

.entry-block.is-selected > .entry-row:hover,
.entry-block.is-batch-selected > .entry-row:hover {
  background-color: transparent;
}

.entry-row:focus-visible {
  box-shadow: var(--focus-ring);
}

/* Selection checkbox */
.entry-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: var(--radius-xs);
  border: 1.5px solid var(--border-strong);
  background-color: var(--panel-bg);
  color: var(--on-brand);
  flex-shrink: 0;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.entry-checkbox.is-checked {
  background-color: var(--brand);
  border-color: var(--brand);
}

/* Restrained geometric kind badge */
.entry-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  flex-shrink: 0;
  background-color: var(--surface-container);
  color: var(--text-secondary);
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.entry-block.is-selected > .entry-row .entry-avatar {
  background-color: var(--panel-bg);
  border-color: var(--border-strong);
  color: var(--brand);
}

.entry-avatar.is-folder {
  background-color: var(--surface-container-low);
  color: var(--text-secondary);
}

.entry-avatar.is-secure-note,
.entry-avatar.is-card,
.entry-avatar.is-identity,
.entry-avatar.is-api-key {
  background-color: var(--surface-container);
  color: var(--text-secondary);
}

/* Main text body */
.entry-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entry-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.entry-title {
  font-size: var(--app-font-base);
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-block.is-selected > .entry-row .entry-title {
  color: var(--brand);
}

.entry-subtitle {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.35;
}

.entry-subtitle-primary,
.entry-subtitle-domain {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-subtitle-primary {
  min-width: 0;
  flex: 0 1 auto;
}

.entry-subtitle-domain {
  min-width: 0;
  flex: 0 1 auto;
  color: var(--text-muted);
}

.entry-subtitle-dot {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Trailing quick actions & indicators */
.entry-trailing {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.entry-quick-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.entry-row:hover .entry-quick-actions,
.entry-row:focus-within .entry-quick-actions,
.entry-block.is-selected > .entry-row .entry-quick-actions {
  opacity: 1;
}

.entry-action-btn,
.entry-fav-btn {
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

.entry-action-btn:hover,
.entry-fav-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.entry-fav-btn {
  color: var(--text-muted);
  opacity: 0.45;
}

.entry-row:hover .entry-fav-btn,
.entry-row:focus-within .entry-fav-btn,
.entry-fav-btn.is-active {
  opacity: 1;
}

.entry-fav-btn.is-active {
  color: var(--warning);
}

.entry-folder-more {
  color: var(--text-secondary);
}

.entry-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-muted);
}

/* Folder nested children */
.folder-children {
  position: relative;
  margin-top: 2px;
}

/* Pointer drag drop zones */
.entry-drop-zone {
  position: relative;
  height: 6px;
  margin: -1px 10px;
  border-radius: var(--radius-full);
  transition: height var(--duration-fast) var(--ease-standard);
}

.entry-drop-zone::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 0;
  border-radius: var(--radius-full);
  background-color: var(--brand);
  transform: translateY(-50%);
  transition: height var(--duration-fast) var(--ease-standard);
}

.entry-drop-zone.is-pointer-target::before {
  height: 3px;
}

.entry-drop-zone.is-tail {
  height: 14px;
}

/* Touch / small viewports: always show compact actions */
@media (hover: none), (max-width: 767px) {
  .entry-quick-actions {
    opacity: 1;
  }

  .entry-fav-btn {
    opacity: 0.8;
  }
}

/* Density modifiers */
.entry-list.is-density-compact .entry-row {
  min-height: 36px;
  padding-top: 4px;
  padding-bottom: 4px;
}

.entry-list.is-density-airy .entry-row {
  min-height: 52px;
  padding-top: 9px;
  padding-bottom: 9px;
}

/* ==========================================================================
   Table List Style (Compact Dense Tabular Rows)
   ========================================================================== */
.entry-list.is-style-table.is-root {
  padding: 0 0 18px;
  gap: 0;
}

.entry-list.is-style-table {
  gap: 0;
  padding: 0;
}

.entry-table-head {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(120px, 1.35fr) minmax(90px, 1fr) minmax(72px, 0.85fr) 92px;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  background-color: var(--surface-container-low);
  border-bottom: 1px solid var(--border-soft);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  user-select: none;
}

.entry-table-head__col.is-actions {
  text-align: right;
}

.entry-list.is-style-table .entry-block {
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid var(--border-soft);
}

.entry-list.is-style-table .entry-block.is-selected {
  border-color: var(--border-soft);
}

.entry-list.is-style-table .entry-row.is-table-row {
  display: grid;
  grid-template-columns: auto minmax(100px, 1.35fr) minmax(80px, 1fr) minmax(64px, 0.85fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 10px;
  padding-left: calc(10px + var(--depth, 0) * 14px);
  border-radius: 0;
}

.entry-list.is-style-table .entry-row:not(.is-table-row) {
  min-height: 34px;
  padding: 4px 10px;
  padding-left: calc(10px + var(--depth, 0) * 14px);
  border-radius: 0;
  background-color: var(--surface-container-low);
}

.entry-list.is-style-table .entry-avatar {
  width: 24px;
  height: 24px;
}

.entry-list.is-style-table .entry-title {
  font-size: var(--app-font-sm);
}

.entry-table-cell {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-table-cell.is-domain {
  color: var(--text-muted);
}

/* ==========================================================================
   Cards List Style (Bento Multi-Column Card Gallery)
   ========================================================================== */
.entry-list.is-style-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  align-content: start;
  padding: 6px 0;
}

.entry-list.is-style-cards.is-root {
  padding: 14px 16px 28px;
}

.entry-list.is-style-cards > .entry-drop-zone,
.entry-list.is-style-cards > .entry-block.is-folder,
.entry-list.is-style-cards > :deep(.ui-empty) {
  grid-column: 1 / -1;
}

.entry-list.is-style-cards > .entry-block.is-folder {
  border-radius: var(--radius-md);
  background-color: transparent;
}

.entry-list.is-style-cards > .entry-block.is-folder > .entry-row {
  min-height: 36px;
  padding: 6px 10px;
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.entry-list.is-style-cards > .entry-block.is-folder > .folder-children {
  margin-top: 8px;
}

.entry-list.is-style-cards > .entry-block.is-login {
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.entry-list.is-style-cards > .entry-block.is-login:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.entry-list.is-style-cards > .entry-block.is-login.is-selected {
  border-color: var(--brand);
  background-color: var(--panel-bg);
  box-shadow: var(--focus-ring);
}

.entry-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  min-height: 112px;
  padding: 12px 13px;
  border-radius: inherit;
}

.entry-card:hover {
  background-color: transparent;
}

.entry-card__top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.entry-card__head-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.entry-card__account {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-card__pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.entry-card__domain-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-card__footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  gap: 6px;
}

.entry-card__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.entry-card__action:hover {
  background-color: var(--brand-soft);
  border-color: var(--border-strong);
  color: var(--brand);
}

.entry-card__action.is-icon-only {
  margin-left: auto;
  width: 26px;
  padding: 0;
}

/* Mobile Compact Single-Line List Style */
.entry-list.is-style-compact {
  gap: 1px;
}

.entry-list.is-style-compact .entry-row {
  min-height: 40px;
  padding: 5px 10px;
  gap: 8px;
}

.entry-list.is-style-compact .entry-avatar {
  width: 26px;
  height: 26px;
}

.entry-list.is-style-compact .entry-sub {
  display: none;
}

@media (max-width: 767px) {
  .entry-list.is-style-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .entry-list.is-style-cards.is-root {
    padding: 10px 10px 24px;
  }

  .entry-list.is-style-cards .entry-card {
    min-height: 98px;
    padding: 10px;
    gap: 8px;
  }

  .entry-list.is-style-cards .entry-card__top {
    gap: 7px;
  }

  .entry-list.is-style-cards .entry-avatar {
    width: 26px;
    height: 26px;
  }

  .entry-list.is-style-cards .entry-card__footer {
    padding-top: 6px;
    gap: 4px;
    flex-wrap: wrap;
  }

  .entry-list.is-style-cards .entry-card__action {
    height: 24px;
    padding: 0 6px;
    font-size: 10.5px;
  }

  .entry-list.is-style-cards .entry-card__action span {
    display: none;
  }
}

/* Drag ghost cloned to body */
:global(.entry-drag-ghost) {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--z-confirm);
  pointer-events: none;
  opacity: 0.94;
  background-color: var(--surface-elevated);
  border: 1px solid var(--brand);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  will-change: transform;
  transition: transform 40ms ease-out;
}
</style>
