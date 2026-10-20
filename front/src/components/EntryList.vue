<template>
  <div class="entry-list" :style="{ '--depth': `${depth}` }">
    <van-empty v-if="entries.length === 0 && depth === 0" image="search" description="没有匹配的条目" />

    <template v-for="(entry, index) in entries" :key="entry.id">
      <div
        v-if="draggableEnabled"
        class="entry-drop-zone"
        :data-drop-parent-id="parentId"
        :data-drop-index="index"
        data-drop-kind="line"
        @dragover.prevent
        @drop.stop="dropEntry($event, parentId, index)"
      ></div>
      <div
        class="entry-block"
        :class="{
          'is-folder': entry.kind === 'folder',
          'is-login': entry.kind !== 'folder',
          'is-selected': entry.id === selectedId,
          'is-batch-selected': selectionMode && selectedIds.has(entry.id),
          'is-draggable': draggableEnabled,
          'is-dragging': draggingId === entry.id
        }"
        :data-drop-parent-id="entry.kind === 'folder' && draggableEnabled ? entry.id : undefined"
        :data-drop-index="entry.kind === 'folder' && draggableEnabled ? 0 : undefined"
        data-drop-kind="folder"
        @pointerdown.stop="preparePointerDrag($event, entry.id)"
        @dragover.prevent="entry.kind === 'folder' && draggableEnabled"
        @drop.stop="entry.kind === 'folder' && dropEntry($event, entry.id, 0)"
      >
      <van-swipe-cell :disabled="draggableEnabled || selectionMode">
        <van-cell
          class="entry-cell"
          clickable
          center
          @contextmenu.stop.prevent="handleContextMenu($event, entry)"
          @click="handlePrimary(entry)"
        >
          <template #icon>
            <span
              class="entry-kind-mark"
              :class="entry.kind"
              :draggable="false"
            >
              <span v-if="entry.kind === 'folder'" class="folder-glyph" aria-hidden="true"></span>
              <van-icon v-else :name="entryKindIcon(entry.kind)" />
            </span>
          </template>
          <template #title>
            <div class="entry-title-row">
              <span class="entry-title">{{ entry.title }}</span>
              <van-tag v-if="entry.status === 'disabled'" plain type="warning">归档</van-tag>
              <van-tag v-if="entry.status === 'trashed'" plain type="danger">回收站</van-tag>
              <van-tag v-if="entry.kind === 'login' && entry.totpSecret" plain type="success">TOTP</van-tag>
              <van-tag v-if="entry.kind !== 'login' && entry.kind !== 'folder'" plain>{{ entryKindLabel(entry.kind) }}</van-tag>
              <van-tag v-if="entry.kind === 'folder'" plain>{{ entry.children?.length || 0 }} 项</van-tag>
            </div>
          </template>
          <template v-if="entry.kind === 'login'" #label>
            <div class="entry-meta">
              <span>{{ entry.username || entry.email || entry.phone || '未设置账号' }}</span>
              <span>{{ entry.domains?.[0] || '未设置域名' }}</span>
            </div>
          </template>
          <template v-else-if="entry.kind !== 'folder'" #label>
            <div class="entry-meta">
              <span>{{ entry.note || customFieldSummary(entry) || entryKindLabel(entry.kind) }}</span>
            </div>
          </template>
          <template #right-icon>
            <div v-if="selectionMode" class="entry-right is-selection">
              <van-icon :name="selectedIds.has(entry.id) ? 'checked' : 'circle'" />
            </div>
            <div v-else class="entry-right">
              <div v-if="entry.kind === 'login'" class="entry-quick-actions" @click.stop>
                <button
                  v-if="entry.username"
                  class="entry-quick-btn"
                  type="button"
                  title="复制账号"
                  aria-label="复制账号"
                  @click="emit('copy', entry.username)"
                >
                  <van-icon name="user-o" />
                </button>
                <button
                  v-if="entry.password"
                  class="entry-quick-btn"
                  type="button"
                  title="复制密码"
                  aria-label="复制密码"
                  @click="emit('copy-password', entry.id)"
                >
                  <van-icon name="shield-o" />
                </button>
                <button
                  v-if="entry.domains?.[0]"
                  class="entry-quick-btn"
                  type="button"
                  title="打开网站"
                  aria-label="打开网站"
                  @click="emit('open-website', entry.domains[0])"
                >
                  <van-icon name="link-o" />
                </button>
              </div>
              <button
                class="entry-favorite-toggle"
                type="button"
                :class="{ 'is-active': favoriteIds.has(entry.id) }"
                :aria-label="favoriteIds.has(entry.id) ? '取消收藏' : '收藏'"
                :aria-pressed="favoriteIds.has(entry.id)"
                @click.stop="emit('toggle-favorite', entry.id)"
              >
                <van-icon :name="favoriteIds.has(entry.id) ? 'star' : 'star-o'" />
              </button>
              <van-icon :name="entry.kind === 'folder' ? (isOpen(entry.id) ? 'arrow-up' : 'arrow-down') : 'arrow'" />
            </div>
          </template>
        </van-cell>
        <template #right>
          <div class="swipe-actions">
            <button
              v-if="entry.kind === 'login' && entry.domains?.[0]"
              class="swipe-icon-action"
              type="button"
              aria-label="打开网站"
              title="打开网站"
              @click="$emit('open-website', entry.domains[0])"
            >
              <van-icon name="link-o" />
            </button>
            <button
              v-if="entry.kind === 'login' && entry.username"
              class="swipe-icon-action"
              type="button"
              aria-label="复制账号"
              title="复制账号"
              @click="$emit('copy', entry.username)"
            >
              <van-icon name="user-o" />
            </button>
            <button
              v-if="entry.kind === 'login' && entry.password"
              class="swipe-icon-action"
              type="button"
              aria-label="复制密码"
              title="复制密码"
              @click="$emit('copy-password', entry.id)"
            >
              <van-icon name="shield-o" />
            </button>
            <button class="swipe-icon-action" type="button" aria-label="创建副本" @click="$emit('duplicate', entry.id)">
              <van-icon name="description-o" />
            </button>
            <button v-if="entry.kind !== 'folder'" class="swipe-icon-action is-danger" type="button" aria-label="删除" @click="$emit('delete', entry.id)">
              <van-icon name="delete-o" />
            </button>
          </div>
        </template>
      </van-swipe-cell>

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
          :depth="depth + 1"
          @view="$emit('view', $event)"
          @edit="$emit('edit', $event)"
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
      @dragover.prevent
      @drop.stop="dropEntry($event, parentId, entries.length)"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { entryKindIcon, entryKindLabel } from '../services/entryKinds.ts'
import type { VaultEntry } from '../types'

defineOptions({ name: 'EntryList' })

const LONG_PRESS_MS = 320
const LONG_PRESS_MOVE_LIMIT = 14

const props = withDefaults(defineProps<{
  entries: VaultEntry[]
  selectedId?: string
  parentId?: string
  autoExpand?: boolean
  draggableEnabled?: boolean
  favoriteIds?: ReadonlySet<string>
  selectionMode?: boolean
  selectedIds?: ReadonlySet<string>
  depth?: number
}>(), {
  selectedId: '',
  parentId: '',
  autoExpand: false,
  draggableEnabled: true,
  favoriteIds: () => new Set<string>(),
  selectionMode: false,
  selectedIds: () => new Set<string>(),
  depth: 0
})

const emit = defineEmits<{
  view: [entry: VaultEntry]
  edit: [entry: VaultEntry]
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
}>()

const expanded = ref(new Set<string>())
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

onBeforeUnmount(() => {
  cleanupPointerDrag()
})

function isOpen(entryId: string) {
  return props.autoExpand || expanded.value.has(entryId)
}

function toggleFolder(entryId: string) {
  const next = new Set(expanded.value)
  if (next.has(entryId)) next.delete(entryId)
  else next.add(entryId)
  expanded.value = next
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

function handleContextMenu(event: MouseEvent, entry: VaultEntry) {
  if (pointerDrag?.active || props.selectionMode) return
  emit('context-menu', { entry, x: event.clientX, y: event.clientY })
}

function customFieldSummary(entry: VaultEntry) {
  return (entry.customFields || []).find((field) => !field.protected && field.value)?.value || ''
}

function createDragGhost(source: HTMLElement, clientX: number, clientY: number) {
  removeDragGhost()
  const cell = source.querySelector<HTMLElement>('.entry-cell') || source
  const rect = cell.getBoundingClientRect()
  grabOffsetX = clientX - rect.left
  grabOffsetY = clientY - rect.top

  const ghost = cell.cloneNode(true) as HTMLElement
  ghost.classList.add('entry-drag-ghost')
  ghost.style.position = 'fixed'
  ghost.style.left = '0'
  ghost.style.top = '0'
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.transform = `translate3d(${clientX - grabOffsetX}px, ${clientY - grabOffsetY}px, 0) scale(1.03)`
  ghost.style.pointerEvents = 'none'
  ghost.style.zIndex = '99999'
  ghost.style.opacity = '0.94'
  ghost.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.12)'
  ghost.style.borderRadius = '12px'
  ghost.style.overflow = 'hidden'
  ghost.style.transition = 'transform 0.04s ease-out, box-shadow 0.2s ease'
  ghost.style.willChange = 'transform'

  document.body.appendChild(ghost)
  dragGhostEl = ghost
}

function updateDragGhost(clientX: number, clientY: number) {
  if (!dragGhostEl) return
  const x = clientX - grabOffsetX
  const y = clientY - grabOffsetY
  dragGhostEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.03)`
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
    const next = new Set(expanded.value)
    next.add(targetParentId)
    expanded.value = next
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
  return Boolean(element?.closest('button, input, textarea, select, a, .entry-right, .van-swipe-cell__right'))
}

function findPointerDropTarget(clientX: number, clientY: number): HTMLElement | null {
  if (!pointerDrag) return null
  const currentDragId = pointerDrag.entryId

  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : []

  // 1. Direct hit on an entry-drop-zone line
  for (const element of elements) {
    if (element instanceof HTMLElement && element.classList.contains('entry-drop-zone')) {
      return element
    }
  }

  // 2. Direct hit on an entry-block
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

  // 3. If no direct hit, find nearest entry-block horizontally close to cursor
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

  // 4. Resolve drop target relative to the target block
  if (targetBlock) {
    const isFolder = targetBlock.classList.contains('is-folder')
    const isSelf = targetBlock.classList.contains('is-dragging') || targetBlock.dataset.dropParentId === currentDragId
    const rect = targetBlock.getBoundingClientRect()
    const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5

    // If folder and pointer is in the middle half, drop into folder
    if (isFolder && !isSelf && relY >= 0.25 && relY <= 0.75) {
      return targetBlock
    }

    // Otherwise drop before or after this block
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

  // 5. Fallback: check if hovering over tail drop zone or within list
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

function dropEntry(event: DragEvent, targetParentId: string, targetIndex: number) {
  const entryId = event.dataTransfer?.getData('text/plain')
  draggingId.value = ''
  if (!entryId || entryId === targetParentId) return
  if (targetParentId) {
    const next = new Set(expanded.value)
    next.add(targetParentId)
    expanded.value = next
  }
  emit('move-entry', { entryId, targetParentId, targetIndex })
}
</script>
