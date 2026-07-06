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
          'is-login': entry.kind === 'login',
          'is-selected': entry.id === selectedId,
          'is-draggable': draggableEnabled,
          'is-dragging': draggingId === entry.id
        }"
        :data-drop-parent-id="entry.kind === 'folder' && draggableEnabled ? entry.id : undefined"
        :data-drop-index="entry.kind === 'folder' && draggableEnabled ? 0 : undefined"
        data-drop-kind="folder"
        @pointerdown.stop="preparePointerDrag($event, entry.id)"
        @contextmenu="handleContextMenu"
        @dragover.prevent="entry.kind === 'folder' && draggableEnabled"
        @drop.stop="entry.kind === 'folder' && dropEntry($event, entry.id, 0)"
      >
      <van-swipe-cell :disabled="draggableEnabled">
        <van-cell
          class="entry-cell"
          clickable
          center
          @click="handlePrimary(entry)"
        >
          <template #icon>
            <span
              class="entry-kind-mark"
              :class="entry.kind"
              :draggable="false"
            >
              <span v-if="entry.kind === 'folder'" class="folder-glyph" aria-hidden="true"></span>
              <van-icon v-else name="contact-o" />
            </span>
          </template>
          <template #title>
            <div class="entry-title-row">
              <span class="entry-title">{{ entry.title }}</span>
              <van-tag v-if="entry.kind === 'login' && entry.totpSecret" plain type="success">TOTP</van-tag>
              <van-tag v-if="entry.kind === 'folder'" plain>{{ entry.children?.length || 0 }} 项</van-tag>
            </div>
          </template>
          <template v-if="entry.kind === 'login'" #label>
            <div class="entry-meta">
              <span>{{ entry.username || entry.email || entry.phone || '未设置账号' }}</span>
              <span>{{ entry.domains?.[0] || '未设置域名' }}</span>
            </div>
          </template>
          <template #right-icon>
            <div class="entry-right">
              <van-button
                v-if="entry.kind === 'folder' && isOpen(entry.id)"
                class="mini-icon-action"
                size="mini"
                icon="plus"
                plain
                aria-label="新建"
                @click.stop="$emit('create', entry.id)"
              />
              <van-button
                v-if="entry.kind === 'folder' && isOpen(entry.id)"
                class="mini-icon-action"
                size="mini"
                icon="edit"
                plain
                @click.stop="$emit('edit', entry)"
              />
              <button
                v-if="entry.kind === 'folder' && isOpen(entry.id)"
                class="mini-delete-action"
                type="button"
                aria-label="删除"
                @click.stop="$emit('delete', entry.id)"
              >
                <van-icon name="delete-o" />
              </button>
              <van-icon :name="entry.kind === 'folder' ? (isOpen(entry.id) ? 'arrow-up' : 'arrow-down') : 'arrow'" />
            </div>
          </template>
        </van-cell>
        <template #right>
          <div v-if="entry.kind === 'folder'" class="swipe-actions">
            <button class="swipe-icon-action" type="button" aria-label="新建" @click="$emit('create', entry.id)">
              <van-icon name="plus" />
            </button>
            <button class="swipe-icon-action" type="button" aria-label="编辑" @click="$emit('edit', entry)">
              <van-icon name="edit" />
            </button>
            <button class="swipe-icon-action is-danger" type="button" aria-label="删除" @click="$emit('delete', entry.id)">
              <van-icon name="delete-o" />
            </button>
          </div>
          <div v-else class="swipe-actions">
            <button class="swipe-icon-action is-danger" type="button" aria-label="删除" @click="$emit('delete', entry.id)">
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
          :depth="depth + 1"
          @view="$emit('view', $event)"
          @edit="$emit('edit', $event)"
          @delete="$emit('delete', $event)"
          @create="$emit('create', $event)"
          @move-entry="$emit('move-entry', $event)"
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
import type { VaultEntry } from '../types'

defineOptions({ name: 'EntryList' })

const LONG_PRESS_MS = 420
const LONG_PRESS_MOVE_LIMIT = 18

const props = withDefaults(defineProps<{
  entries: VaultEntry[]
  selectedId?: string
  parentId?: string
  autoExpand?: boolean
  draggableEnabled?: boolean
  depth?: number
}>(), {
  selectedId: '',
  parentId: '',
  autoExpand: false,
  draggableEnabled: true,
  depth: 0
})

const emit = defineEmits<{
  view: [entry: VaultEntry]
  edit: [entry: VaultEntry]
  delete: [entryId: string]
  create: [parentId: string]
  'move-entry': [payload: { entryId: string; targetParentId: string; targetIndex: number }]
}>()

const expanded = ref(new Set<string>())
const draggingId = ref('')
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
  if (entry.kind === 'folder') {
    toggleFolder(entry.id)
    return
  }
  emit('view', entry)
}

function handleContextMenu(event: MouseEvent) {
  if (props.draggableEnabled) event.preventDefault()
}

function preparePointerDrag(event: PointerEvent, entryId: string) {
  if (!props.draggableEnabled || event.button > 0) return
  if (isInteractiveTarget(event.target)) return
  cleanupPointerDrag()
  const source = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  source?.setPointerCapture?.(event.pointerId)
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
    }, 0)
  }
  if (!wasActive || !target) return

  const targetParentId = target.dataset.dropParentId || ''
  const targetIndex = Number(target.dataset.dropIndex || 0)
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
  if (pointerDrag?.source?.hasPointerCapture?.(pointerDrag.pointerId)) {
    pointerDrag.source.releasePointerCapture(pointerDrag.pointerId)
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

function findPointerDropTarget(clientX: number, clientY: number) {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const target = element.closest<HTMLElement>('[data-drop-parent-id][data-drop-index]')
    if (target) return target
  }

  let closest: HTMLElement | null = null
  let closestDistance = Number.POSITIVE_INFINITY
  for (const target of document.querySelectorAll<HTMLElement>('[data-drop-parent-id][data-drop-index]')) {
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    const centerY = rect.top + rect.height / 2
    const distance = Math.abs(clientY - centerY)
    if (distance < closestDistance) {
      closestDistance = distance
      closest = target
    }
  }
  return closestDistance <= 72 ? closest : null
}

function setPointerDropTarget(target: HTMLElement | null) {
  if (!pointerDrag || pointerDrag.target === target) return
  pointerDrag.target?.classList.remove('is-pointer-target')
  pointerDrag.target = target
  pointerDrag.target?.classList.add('is-pointer-target')
}

function maybeAutoScroll(clientY: number) {
  const margin = 72
  if (clientY < margin) window.scrollBy({ top: -14 })
  else if (clientY > window.innerHeight - margin) window.scrollBy({ top: 14 })
}

function dropEntry(event: DragEvent, targetParentId: string, targetIndex: number) {
  const entryId = event.dataTransfer?.getData('text/plain')
  draggingId.value = ''
  if (!entryId) return
  if (targetParentId) {
    const next = new Set(expanded.value)
    next.add(targetParentId)
    expanded.value = next
  }
  emit('move-entry', { entryId, targetParentId, targetIndex })
}
</script>
