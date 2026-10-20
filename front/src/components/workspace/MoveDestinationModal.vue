<template>
  <van-popup
    :show="open"
    position="bottom"
    round
    class="move-destination-popup"
    :duration="0.14"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <div class="move-tree-shell">
      <!-- Header -->
      <div class="move-tree-header">
        <div class="move-tree-title-group">
          <div class="move-tree-title-row">
            <h3 class="move-tree-title">{{ title || '移动到' }}</h3>
            <span v-if="subtitle" class="move-tree-subtitle">{{ subtitle }}</span>
          </div>
          <div class="move-tree-target-bar">
            <span class="preview-label">目标位置：</span>
            <span class="preview-path" :class="{ 'is-selected': selectedTargetId !== null }">
              {{ targetPathText }}
            </span>
          </div>
        </div>
        <div class="move-tree-header-actions">
          <button
            v-if="hasFolders"
            type="button"
            class="tree-expand-toggle-btn"
            :title="isAllExpanded ? '折叠全部' : '展开全部'"
            @click="toggleAllExpanded"
          >
            <van-icon :name="isAllExpanded ? 'arrow-up' : 'arrow-down'" />
            <span>{{ isAllExpanded ? '折叠' : '展开' }}</span>
          </button>
          <button
            type="button"
            class="inline-icon-button move-tree-close-btn"
            aria-label="关闭"
            @click="emit('update:open', false)"
          >
            <van-icon name="cross" />
          </button>
        </div>
      </div>

      <!-- Search filter -->
      <div v-if="totalFolderCount > 4" class="move-tree-search-bar">
        <van-search
          v-model="searchKeyword"
          placeholder="搜索分组名称..."
          clearable
          shape="round"
        />
      </div>

      <!-- Tree content area -->
      <div class="move-tree-container">
        <!-- Root node (根目录) -->
        <div
          class="tree-node tree-root-node"
          :class="{
            'is-selected': selectedTargetId === '',
            'is-current': isRootCurrent
          }"
          role="button"
          tabindex="0"
          @click="handleNodeClick('')"
        >
          <div class="tree-chevron-placeholder"></div>
          <span class="tree-node-icon root-icon">
            <van-icon name="wap-home-o" />
          </span>
          <div class="tree-node-content">
            <div class="tree-node-title-row">
              <span class="tree-node-title">根目录</span>
              <small class="tree-node-subtitle">（顶层位置）</small>
            </div>
          </div>
          <div class="tree-node-badges">
            <van-tag v-if="isRootCurrent" plain type="primary">当前位置</van-tag>
            <van-icon
              class="tree-select-radio"
              :name="selectedTargetId === '' ? 'checked' : 'circle'"
              :class="{ 'is-checked': selectedTargetId === '' }"
            />
          </div>
        </div>

        <div class="tree-divider" role="separator"></div>

        <!-- Empty state -->
        <div v-if="flatVisibleNodes.length === 0" class="move-tree-empty">
          <span v-if="searchKeyword">没有匹配的分组</span>
          <span v-else>暂无其他子分组，可直接移入根目录</span>
        </div>

        <!-- Folder tree nodes -->
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
          role="button"
          tabindex="0"
          :aria-disabled="node.disabled"
          @click="handleNodeClick(node.id, node.disabled)"
        >
          <!-- Tree vertical guide lines based on depth -->
          <span
            v-for="d in node.depth"
            :key="d"
            class="tree-guide-line"
            :style="{ left: `${(d - 1) * 20 + 17}px` }"
          ></span>

          <!-- Expand/collapse chevron -->
          <button
            v-if="node.hasChildren"
            type="button"
            class="tree-chevron-btn"
            :aria-label="isExpanded(node.id) ? '折叠' : '展开'"
            @click.stop="toggleExpand(node.id)"
          >
            <van-icon :name="isExpanded(node.id) ? 'arrow-down' : 'arrow'" />
          </button>
          <span v-else class="tree-chevron-placeholder"></span>

          <!-- Folder Icon -->
          <span class="tree-node-icon folder-icon">
            <van-icon :name="isExpanded(node.id) ? 'folder-open-o' : 'folder-o'" />
          </span>

          <!-- Title & subtitle -->
          <div class="tree-node-content">
            <div class="tree-node-title-row">
              <span class="tree-node-title">{{ node.title }}</span>
              <span v-if="node.hasChildren" class="tree-child-count">({{ node.children.length }})</span>
            </div>
            <small v-if="node.parentTitle && searchKeyword" class="tree-node-parent-hint">
              所属：{{ node.parentTitle }}
            </small>
          </div>

          <!-- Badges & Selection radio -->
          <div class="tree-node-badges">
            <van-tag v-if="node.isCurrentLocation" plain type="primary">当前位置</van-tag>
            <van-tag v-else-if="node.disabled" plain type="default">{{ node.disabledReason || '不可选' }}</van-tag>
            <van-icon
              v-if="!node.disabled"
              class="tree-select-radio"
              :name="selectedTargetId === node.id ? 'checked' : 'circle'"
              :class="{ 'is-checked': selectedTargetId === node.id }"
            />
          </div>
        </div>
      </div>

      <!-- Footer action bar -->
      <div class="move-tree-footer">
        <van-button
          plain
          class="move-tree-cancel-btn"
          @click="emit('update:open', false)"
        >
          取消
        </van-button>
        <van-button
          type="primary"
          class="move-tree-confirm-btn"
          :disabled="isConfirmDisabled"
          @click="handleConfirm"
        >
          {{ confirmButtonText }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const folderTree = computed<TreeNode[]>(() => {
  return buildFolderTree(props.entries)
})

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

const isAllExpanded = computed(() => {
  return totalFolderCount.value > 0 && expandedSet.value.size >= totalFolderCount.value
})

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
    return node.children.some((child) => child.title.toLowerCase().includes(query) || hasMatchingDescendant(child, query))
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
  return ['根目录', ...selectedTargetNode.value.path].join('  /  ')
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
  if (selectedTargetId.value === targetId && lastClickId === targetId && now - lastClickTime < 350 && targetId !== currentParentId.value) {
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
      // Expand all folders by default
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
.move-tree-shell {
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 700px);
  max-height: min(80dvh, 700px);
  background: var(--panel-bg);
  color: var(--text-main);
}

.move-tree-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.move-tree-title-group {
  flex: 1;
  min-width: 0;
}

.move-tree-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.move-tree-title {
  margin: 0;
  font-size: var(--app-font-lg, 17px);
  font-weight: 600;
  line-height: 1.25;
}

.move-tree-subtitle {
  font-size: var(--app-font-xs, 12px);
  color: var(--text-muted);
}

.move-tree-target-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: var(--shape-xs, 6px);
  background: var(--panel-bg-muted);
  font-size: var(--app-font-xs, 12px);
  min-width: 0;
}

.preview-label {
  color: var(--text-muted);
  flex-shrink: 0;
}

.preview-path {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-path.is-selected {
  color: var(--brand-strong, var(--brand));
  font-weight: 600;
}

.move-tree-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tree-expand-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--shape-xs, 6px);
  background: var(--panel-bg);
  color: var(--text-muted);
  font-size: var(--app-font-xs, 12px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.tree-expand-toggle-btn:hover {
  color: var(--brand);
  border-color: var(--brand);
}

.move-tree-close-btn {
  color: var(--text-muted);
}

.move-tree-search-bar {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--panel-bg-muted);
}

.move-tree-container {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 180px;
  max-height: calc(80vh - 170px);
}

.tree-divider {
  height: 1px;
  background: var(--border-soft);
  margin: 6px 4px;
}

.tree-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: var(--shape-sm, 8px);
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.tree-node:hover:not(.is-disabled) {
  background: var(--panel-bg-muted);
}

.tree-node.is-selected {
  background: color-mix(in srgb, var(--brand), transparent 88%);
  border-color: var(--brand);
}

:root[data-theme='dark'] .tree-node.is-selected {
  background: color-mix(in srgb, var(--brand), transparent 80%);
}

.tree-node.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tree-root-node {
  padding-left: 10px !important;
  font-weight: 500;
}

.tree-guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border-soft);
  pointer-events: none;
}

.tree-chevron-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: transform 0.15s ease, color 0.15s ease;
}

.tree-chevron-btn:hover {
  color: var(--brand);
  background: color-mix(in srgb, var(--brand), transparent 90%);
}

.tree-chevron-placeholder {
  width: 22px;
  min-width: 22px;
}

.tree-node-icon {
  display: grid;
  place-items: center;
  font-size: 18px;
  flex-shrink: 0;
}

.tree-node-icon.root-icon {
  color: var(--brand);
}

.tree-node-icon.folder-icon {
  color: var(--brand);
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
  font-size: var(--app-font-md, 14px);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node.is-selected .tree-node-title {
  font-weight: 600;
  color: var(--brand-strong, var(--brand));
}

.tree-node-subtitle {
  font-size: var(--app-font-xs, 12px);
  color: var(--text-muted);
  flex-shrink: 0;
}

.tree-child-count {
  font-size: var(--app-font-xs, 11px);
  color: var(--text-muted);
  flex-shrink: 0;
}

.tree-node-parent-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.tree-node-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.tree-select-radio {
  font-size: 18px;
  color: var(--text-muted);
  transition: color 0.15s ease;
}

.tree-select-radio.is-checked {
  color: var(--brand);
}

.move-tree-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--app-font-sm, 13px);
}

.move-tree-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border-soft);
  background: var(--panel-bg);
}

.move-tree-cancel-btn {
  flex: 0 0 76px;
  border-radius: var(--shape-sm, 8px);
}

.move-tree-confirm-btn {
  flex: 1 1 auto;
  border-radius: var(--shape-sm, 8px);
  font-weight: 600;
}
</style>
