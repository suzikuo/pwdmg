<template>
  <UiModal
    :open="open"
    :title="title || '移动到'"
    :subtitle="subtitle || undefined"
    size="md"
    @close="emit('update:open', false)"
  >
    <template #header-extra>
      <UiButton
        v-if="hasFolders"
        variant="subtle"
        size="xs"
        :title="isAllExpanded ? '折叠全部' : '展开全部'"
        @click="toggleAllExpanded"
      >
        <UiIcon :name="isAllExpanded ? 'chevron-down' : 'chevron-right'" :size="13" />
        <span>{{ isAllExpanded ? '折叠' : '展开' }}</span>
      </UiButton>
    </template>

    <div class="move-tree-body">
      <div class="move-tree-target-bar">
        <span class="preview-label">目标位置：</span>
        <span class="preview-path" :class="{ 'is-selected': selectedTargetId !== null }">
          {{ targetPathText }}
        </span>
      </div>

      <div v-if="totalFolderCount > 4" class="move-tree-search-bar">
        <UiInput
          v-model="searchKeyword"
          type="search"
          clearable
          placeholder="搜索分组名称…"
        >
          <template #prefix>
            <UiIcon name="search" :size="15" />
          </template>
        </UiInput>
      </div>

      <div class="move-tree-container" role="tree" aria-label="目标分组列表">
        <div
          class="tree-node tree-root-node"
          :class="{
            'is-selected': selectedTargetId === '',
            'is-current': isRootCurrent
          }"
          role="treeitem"
          tabindex="0"
          :aria-selected="selectedTargetId === ''"
          @click="handleNodeClick('')"
          @keydown.enter.prevent="handleNodeClick('')"
          @keydown.space.prevent="handleNodeClick('')"
        >
          <span class="tree-chevron-placeholder" aria-hidden="true" />
          <span class="tree-node-icon" aria-hidden="true">
            <UiIcon name="folder-open" :size="16" />
          </span>
          <div class="tree-node-content">
            <div class="tree-node-title-row">
              <span class="tree-node-title">根目录</span>
              <small class="tree-node-subtitle">（顶层位置）</small>
            </div>
          </div>
          <div class="tree-node-badges">
            <UiBadge v-if="isRootCurrent" tone="brand" size="sm">当前位置</UiBadge>
            <span class="tree-radio-dot" :class="{ 'is-checked': selectedTargetId === '' }" aria-hidden="true">
              <UiIcon v-if="selectedTargetId === ''" name="check" :size="12" />
            </span>
          </div>
        </div>

        <div class="tree-divider" role="separator" />

        <UiEmpty
          v-if="flatVisibleNodes.length === 0"
          icon="folder"
          :title="searchKeyword ? '没有匹配的分组' : '暂无其他子分组'"
          :description="searchKeyword ? '尝试更换关键词' : '可直接移入根目录'"
        />

        <div
          v-for="node in flatVisibleNodes"
          :key="node.id"
          class="tree-node"
          :class="{
            'is-selected': selectedTargetId === node.id,
            'is-current': node.isCurrentLocation,
            'is-disabled': node.disabled
          }"
          :style="{ paddingLeft: `${node.depth * 20 + 8}px` }"
          role="treeitem"
          tabindex="0"
          :aria-selected="selectedTargetId === node.id"
          :aria-disabled="node.disabled"
          @click="handleNodeClick(node.id, node.disabled)"
          @keydown.enter.prevent="handleNodeClick(node.id, node.disabled)"
          @keydown.space.prevent="handleNodeClick(node.id, node.disabled)"
        >
          <span
            v-for="d in node.depth"
            :key="d"
            class="tree-guide-line"
            :style="{ left: `${(d - 1) * 20 + 17}px` }"
            aria-hidden="true"
          />

          <button
            v-if="node.hasChildren"
            type="button"
            class="tree-chevron-btn"
            :aria-label="isExpanded(node.id) ? '折叠' : '展开'"
            @click.stop="toggleExpand(node.id)"
            @keydown.enter.stop.prevent="toggleExpand(node.id)"
            @keydown.space.stop.prevent="toggleExpand(node.id)"
          >
            <UiIcon :name="isExpanded(node.id) ? 'chevron-down' : 'chevron-right'" :size="14" />
          </button>
          <span v-else class="tree-chevron-placeholder" aria-hidden="true" />

          <span class="tree-node-icon" aria-hidden="true">
            <UiIcon :name="isExpanded(node.id) ? 'folder-open' : 'folder'" :size="16" />
          </span>

          <div class="tree-node-content">
            <div class="tree-node-title-row">
              <span class="tree-node-title">{{ node.title }}</span>
              <span v-if="node.hasChildren" class="tree-child-count">({{ node.children.length }})</span>
            </div>
            <small v-if="node.parentTitle && searchKeyword" class="tree-node-parent-hint">
              所属：{{ node.parentTitle }}
            </small>
          </div>

          <div class="tree-node-badges">
            <UiBadge v-if="node.isCurrentLocation" tone="brand" size="sm">当前位置</UiBadge>
            <UiBadge v-else-if="node.disabled" tone="neutral" size="sm">
              {{ node.disabledReason || '不可选' }}
            </UiBadge>
            <span
              v-if="!node.disabled"
              class="tree-radio-dot"
              :class="{ 'is-checked': selectedTargetId === node.id }"
              aria-hidden="true"
            >
              <UiIcon v-if="selectedTargetId === node.id" name="check" :size="12" />
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="secondary" @click="emit('update:open', false)">
        取消
      </UiButton>
      <UiButton
        variant="primary"
        :disabled="isConfirmDisabled"
        @click="handleConfirm"
      >
        <UiIcon name="move" :size="15" />
        <span>{{ confirmButtonText }}</span>
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiInput, UiModal } from '../ui'
import type { VaultEntry } from '../../types'
import { isEntryInsideAny } from '../../services/entryBatchOperations'

interface Props {
  open: boolean
  title?: string
  subtitle?: string
  entries: VaultEntry[]
  movingEntryIds: string[]
}

const props = withDefaults(defineProps<Props>(), {
  title: '移动到',
  subtitle: '',
  movingEntryIds: () => []
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [targetParentId: string]
}>()

interface TreeNode {
  id: string
  title: string
  depth: number
  path: string[]
  parentTitle?: string
  hasChildren: boolean
  children: TreeNode[]
  disabled: boolean
  disabledReason?: string
  isCurrentLocation: boolean
}

const expandedSet = ref<Set<string>>(new Set())
const searchKeyword = ref('')
const selectedTargetId = ref<string | null>(null)
let lastClickTime = 0
let lastClickId = ''

function isActiveEntry(entry: VaultEntry): boolean {
  return !entry.status || entry.status === 'active'
}

function findEntryParentId(entries: VaultEntry[], targetId: string, currentParentId = ''): string | null {
  for (const entry of entries) {
    if (entry.id === targetId) return currentParentId
    if (entry.children?.length) {
      const res = findEntryParentId(entry.children, targetId, entry.id)
      if (res !== null) return res
    }
  }
  return null
}

const currentParentId = computed<string | null>(() => {
  if (props.movingEntryIds.length === 0) return null
  const parentIds = new Set<string>()
  for (const id of props.movingEntryIds) {
    const parentId = findEntryParentId(props.entries, id)
    if (parentId !== null) parentIds.add(parentId)
  }
  if (parentIds.size === 1) return [...parentIds][0]
  return null
})

const forbiddenFolderIds = computed<Set<string>>(() => {
  const set = new Set<string>()
  if (props.movingEntryIds.length === 0) return set

  function checkForbidden(entry: VaultEntry) {
    if (entry.kind === 'folder') {
      if (isEntryInsideAny(props.entries, props.movingEntryIds, entry.id)) {
        set.add(entry.id)
      }
    }
    for (const child of entry.children || []) {
      checkForbidden(child)
    }
  }

  for (const entry of props.entries) {
    checkForbidden(entry)
  }
  return set
})

function buildFolderTree(
  entries: VaultEntry[],
  parentPath: string[] = [],
  depth = 1,
  parentTitle = ''
): TreeNode[] {
  const result: TreeNode[] = []
  for (const entry of entries) {
    if (!isActiveEntry(entry) || entry.kind !== 'folder') continue
    const title = entry.title.trim() || '未命名分组'
    const path = [...parentPath, title]
    const disabled = forbiddenFolderIds.value.has(entry.id)
    const isCurrentLocation = currentParentId.value === entry.id
    const children = buildFolderTree(entry.children || [], path, depth + 1, title)
    result.push({
      id: entry.id,
      title,
      depth,
      path,
      parentTitle: parentTitle || undefined,
      hasChildren: children.length > 0,
      children,
      disabled,
      disabledReason: disabled ? '不可选' : undefined,
      isCurrentLocation
    })
  }
  return result
}

const folderTree = computed<TreeNode[]>(() => buildFolderTree(props.entries))
const hasFolders = computed(() => folderTree.value.length > 0)

const totalFolderCount = computed(() => {
  let count = 0
  function countNodes(nodes: TreeNode[]) {
    count += nodes.length
    nodes.forEach((n) => countNodes(n.children))
  }
  countNodes(folderTree.value)
  return count
})

const isAllExpanded = computed(
  () => totalFolderCount.value > 0 && expandedSet.value.size >= totalFolderCount.value
)

function toggleAllExpanded() {
  if (isAllExpanded.value) {
    expandedSet.value = new Set()
  } else {
    const all = new Set<string>()
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) {
        all.add(n.id)
        collect(n.children)
      }
    }
    collect(folderTree.value)
    expandedSet.value = all
  }
}

function isExpanded(folderId: string): boolean {
  return expandedSet.value.has(folderId)
}

function toggleExpand(folderId: string) {
  const next = new Set(expandedSet.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  expandedSet.value = next
}

const flatVisibleNodes = computed<TreeNode[]>(() => {
  const list: TreeNode[] = []
  const kw = searchKeyword.value.trim().toLowerCase()

  function hasMatchingDescendant(node: TreeNode, query: string): boolean {
    return node.children.some(
      (child) => child.title.toLowerCase().includes(query) || hasMatchingDescendant(child, query)
    )
  }

  function flatten(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (kw) {
        const matchesSelf = node.title.toLowerCase().includes(kw)
        const matchesChild = hasMatchingDescendant(node, kw)
        if (matchesSelf || matchesChild) {
          list.push(node)
          flatten(node.children)
        }
      } else {
        list.push(node)
        if (expandedSet.value.has(node.id)) {
          flatten(node.children)
        }
      }
    }
  }

  flatten(folderTree.value)
  return list
})

const isRootCurrent = computed(() => currentParentId.value === '')

function findTreeNode(nodes: TreeNode[], targetId: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === targetId) return n
    const nested = findTreeNode(n.children, targetId)
    if (nested) return nested
  }
  return undefined
}

const selectedTargetNode = computed(() => {
  if (selectedTargetId.value === null || selectedTargetId.value === '') return null
  return findTreeNode(folderTree.value, selectedTargetId.value)
})

const targetPathText = computed<string>(() => {
  if (selectedTargetId.value === null) return '请在下方选择目标分组'
  if (selectedTargetId.value === '') return '根目录'
  if (!selectedTargetNode.value) return ''
  return ['根目录', ...selectedTargetNode.value.path].join(' / ')
})

const isConfirmDisabled = computed<boolean>(() => {
  if (selectedTargetId.value === null) return true
  if (selectedTargetId.value === currentParentId.value) return true
  if (selectedTargetId.value !== '' && forbiddenFolderIds.value.has(selectedTargetId.value)) return true
  return false
})

const confirmButtonText = computed<string>(() => {
  if (selectedTargetId.value === null) return '请选择目标位置'
  if (selectedTargetId.value === currentParentId.value) return '已在当前位置'
  if (selectedTargetId.value === '') return '移动到「根目录」'
  return `移动到「${selectedTargetNode.value?.title || '目标分组'}」`
})

function handleNodeClick(targetId: string, disabled = false) {
  if (disabled) return
  const now = Date.now()
  if (
    selectedTargetId.value === targetId &&
    lastClickId === targetId &&
    now - lastClickTime < 350 &&
    targetId !== currentParentId.value
  ) {
    handleConfirm()
    return
  }
  lastClickTime = now
  lastClickId = targetId
  selectedTargetId.value = targetId
}

function handleConfirm() {
  if (isConfirmDisabled.value || selectedTargetId.value === null) return
  emit('confirm', selectedTargetId.value)
  emit('update:open', false)
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      searchKeyword.value = ''
      selectedTargetId.value = null
      lastClickTime = 0
      lastClickId = ''
      const all = new Set<string>()
      function collect(nodes: TreeNode[]) {
        for (const n of nodes) {
          all.add(n.id)
          collect(n.children)
        }
      }
      collect(folderTree.value)
      expandedSet.value = all
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.move-tree-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.move-tree-target-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
  font-size: var(--app-font-xs);
  min-width: 0;
}

.preview-label {
  color: var(--text-muted);
  flex-shrink: 0;
}

.preview-path {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-path.is-selected {
  color: var(--brand);
  font-weight: 600;
}

.move-tree-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 380px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 2px;
}

.tree-divider {
  height: 1px;
  background-color: var(--border-soft);
  margin: 6px 4px;
}

.tree-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.tree-root-node {
  padding-left: 10px;
  font-weight: 500;
}

.tree-node:hover:not(.is-disabled) {
  background-color: var(--surface-container-low);
}

.tree-node:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.tree-node.is-selected {
  background-color: var(--brand-soft);
  border-color: var(--brand);
}

.tree-node.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tree-guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: var(--border-soft);
  pointer-events: none;
}

.tree-chevron-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.tree-chevron-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--brand);
}

.tree-chevron-placeholder {
  width: 22px;
  min-width: 22px;
  flex-shrink: 0;
}

.tree-node-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  flex-shrink: 0;
}

.tree-node-content {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.tree-node-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.tree-node-title {
  font-size: var(--app-font-base);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node.is-selected .tree-node-title {
  font-weight: 600;
  color: var(--brand);
}

.tree-node-subtitle,
.tree-child-count,
.tree-node-parent-hint {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.tree-node-parent-hint {
  margin-top: 2px;
}

.tree-node-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.tree-radio-dot {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--panel-bg);
  color: var(--on-brand);
  flex-shrink: 0;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.tree-radio-dot.is-checked {
  background-color: var(--brand);
  border-color: var(--brand);
}
</style>
