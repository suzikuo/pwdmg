<template>
  <UiModal
    :open="open"
    :title="title"
    :subtitle="preview ? preview.objectName : undefined"
    size="lg"
    :close-on-backdrop="false"
    @close="emit('close')"
  >
    <div v-if="preview" class="sync-review">
      <div v-if="preview.usedAlternatePassword" class="sync-password-notice" role="note">
        <UiIcon name="shield" :size="14" />
        <span>应用后，本机将同步采用已校验的云端主密码和加密参数。</span>
      </div>

      <div class="sync-top-bar">
        <div class="sync-top-bar__meta">
          <span class="sync-direction-pill">
            <UiIcon name="cloud" :size="13" />
            <span>{{ preview.direction === 'download' ? '云端 → 本机' : '本机 → 云端' }}</span>
          </span>
          <span class="sync-counts" aria-label="变更统计">
            <span class="sync-count is-added">+{{ diffCounts.added }}</span>
            <span class="sync-count is-modified">~{{ diffCounts.modified }}</span>
            <span class="sync-count is-deleted">-{{ diffCounts.deleted }}</span>
          </span>
        </div>

        <div v-if="preview.items.length" class="sync-top-bar__actions">
          <UiButton
            v-if="hasExpandableItems"
            variant="ghost"
            size="xs"
            @click="toggleExpandAll"
          >
            {{ allExpanded ? '全部收起' : '全部展开' }}
          </UiButton>
          <UiButton variant="subtle" size="xs" @click="emit('select-all', true)">全选</UiButton>
          <UiButton variant="subtle" size="xs" @click="emit('select-all', false)">全不选</UiButton>
        </div>
      </div>

      <div v-if="preview.items.length" class="sync-diff-list">
        <article
          v-for="item in preview.items"
          :key="itemKey(item)"
          class="sync-diff-card"
          :class="[`is-${item.changeType}`, { 'is-expanded': isExpanded(item) }]"
        >
          <div class="sync-diff-head">
            <label class="sync-check-wrap" @click.stop>
              <input
                type="checkbox"
                class="sync-checkbox"
                :checked="isItemChecked(item)"
                :aria-label="`选择 ${item.path}`"
                @change="toggleItem(item)"
              />
            </label>

            <button
              type="button"
              class="sync-diff-head__main"
              @click="item.changeType === 'modified' && item.details.length ? toggleExpand(item) : toggleItem(item)"
            >
              <UiBadge :tone="changeBadgeTone(item.changeType)" size="sm">
                {{ changeLabel(item.changeType) }}
              </UiBadge>
              <strong class="sync-diff-path">{{ item.path }}</strong>
              <span class="sync-diff-compact-summary">{{ compactItemSummary(item) }}</span>
              <UiIcon
                v-if="item.changeType === 'modified' && item.details.length"
                :name="isExpanded(item) ? 'chevron-down' : 'chevron-right'"
                :size="14"
                class="sync-diff-chevron"
              />
            </button>
          </div>

          <div
            v-if="item.changeType === 'modified' && item.details.length && isExpanded(item)"
            class="sync-field-list"
          >
            <div
              v-for="detail in visibleDetails(item)"
              :key="detail.key"
              class="sync-field-row"
              role="checkbox"
              tabindex="0"
              :aria-checked="detail.checked"
              @click="toggleDetail(item, detail)"
              @keydown.enter.prevent="toggleDetail(item, detail)"
              @keydown.space.prevent="toggleDetail(item, detail)"
            >
              <input
                type="checkbox"
                class="sync-checkbox"
                :checked="detail.checked"
                tabindex="-1"
                @click.stop.prevent="toggleDetail(item, detail)"
              />
              <span class="sync-field-label">{{ detail.label }}</span>
              <div class="sync-diff-inline">
                <code class="sync-val is-before">{{ detail.baseText || '空' }}</code>
                <span class="sync-diff-arrow" aria-hidden="true">→</span>
                <code class="sync-val is-after">{{ detail.sourceText || '空' }}</code>
              </div>
            </div>

            <div v-if="statusMetaDetails(item).length" class="sync-meta-fold">
              <button
                type="button"
                class="sync-meta-fold__btn"
                @click="toggleMetaExpanded(item)"
              >
                <UiIcon :name="isMetaExpanded(item) ? 'chevron-down' : 'chevron-right'" :size="12" />
                <span>
                  {{ isMetaExpanded(item) ? '收起状态元数据' : `含 ${statusMetaDetails(item).length} 项状态元数据（状态说明 / 删除时间）` }}
                </span>
              </button>

              <template v-if="isMetaExpanded(item)">
                <div
                  v-for="detail in statusMetaDetails(item)"
                  :key="detail.key"
                  class="sync-field-row is-meta"
                  role="checkbox"
                  tabindex="0"
                  :aria-checked="detail.checked"
                  @click="toggleDetail(item, detail)"
                  @keydown.enter.prevent="toggleDetail(item, detail)"
                  @keydown.space.prevent="toggleDetail(item, detail)"
                >
                  <input
                    type="checkbox"
                    class="sync-checkbox"
                    :checked="detail.checked"
                    tabindex="-1"
                    @click.stop.prevent="toggleDetail(item, detail)"
                  />
                  <span class="sync-field-label">{{ detail.label }}</span>
                  <div class="sync-diff-inline">
                    <code class="sync-val is-before">{{ detail.baseText || '空' }}</code>
                    <span class="sync-diff-arrow" aria-hidden="true">→</span>
                    <code class="sync-val is-after">{{ detail.sourceText || '空' }}</code>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </article>
      </div>

      <UiEmpty
        v-else
        icon="shield"
        title="两端条目一致"
        description="云端与本机数据内容没有差异"
      />
    </div>

    <template #footer>
      <div v-if="preview" class="sync-footer">
        <div v-if="preview.automatic && postponeMenuOpen" class="sync-postpone-bar" role="group" aria-label="选择推迟自动同步时长">
          <span class="sync-postpone-bar__label">暂停自动同步：</span>
          <div class="sync-postpone-bar__presets">
            <UiButton
              v-for="minutes in AUTO_SYNC_POSTPONE_PRESET_MINUTES"
              :key="minutes"
              variant="subtle"
              size="xs"
              :disabled="busy"
              @click="handlePostpone(minutes)"
            >
              {{ formatAutoSyncPostponePresetLabel(minutes) }}
            </UiButton>
          </div>
        </div>
        <span v-if="preview.managedRemote && !allChangesSelected" class="sync-selected-count">勾选全部差异后可同步完整快照</span>
        <span v-else class="sync-selected-count">已选 <strong>{{ selectedCount }}</strong> 处变更</span>
        <div class="sync-footer-actions">
          <UiButton
            v-if="preview.automatic"
            :variant="postponeMenuOpen ? 'secondary' : 'ghost'"
            size="sm"
            :disabled="busy"
            @click="postponeMenuOpen = !postponeMenuOpen"
          >
            推迟同步
          </UiButton>
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="emit('discard')">
            放弃本次
          </UiButton>
          <UiButton
            variant="primary"
            size="sm"
            :disabled="(preview.managedRemote && !allChangesSelected) || (selectedCount === 0 && (preview.items.length > 0 || !preview.usedAlternatePassword))"
            :loading="busy"
            @click="emit('apply')"
          >
            <UiIcon name="check" :size="14" />
            <span>{{ actionText }}</span>
          </UiButton>
        </div>
      </div>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiModal } from '../ui'
import {
  AUTO_SYNC_POSTPONE_PRESET_MINUTES,
  formatAutoSyncPostponePresetLabel
} from '../../services/autoSyncPostpone'
import type { CloudSyncChangeDetail, CloudSyncDiffItem, CloudSyncPreview } from '../../services/sync/legacyDiff'

const STATUS_META_KEYS = new Set(['statusReason', 'deletedAt'])

const props = defineProps<{
  open: boolean
  preview: CloudSyncPreview | null
  title: string
  diffCounts: { added: number; modified: number; deleted: number }
  selectedCount: number
  actionText: string
  busy: boolean
  isItemChecked: (item: CloudSyncDiffItem) => boolean
  changeLabel: (changeType: CloudSyncDiffItem['changeType']) => string
  itemSummary: (item: CloudSyncDiffItem) => string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
  'select-all': [checked: boolean]
  discard: []
  postpone: [minutes: number]
  'item-checked': [item: CloudSyncDiffItem, checked: boolean]
  'detail-checked': [item: CloudSyncDiffItem, detail: CloudSyncChangeDetail, checked: boolean]
  apply: []
}>()

const allChangesSelected = computed(() => props.preview?.items.every(props.isItemChecked) ?? false)
const expandedKeys = ref<Set<string>>(new Set())
const metaExpandedKeys = ref<Set<string>>(new Set())
const postponeMenuOpen = ref(false)

function handlePostpone(minutes: number) {
  postponeMenuOpen.value = false
  emit('postpone', minutes)
}

function itemKey(item: CloudSyncDiffItem): string {
  return `${item.changeType}:${item.id}`
}

const expandableItems = computed(() =>
  (props.preview?.items || []).filter((item) => item.changeType === 'modified' && item.details.length > 0)
)

const hasExpandableItems = computed(() => expandableItems.value.length > 0)

const allExpanded = computed(() =>
  expandableItems.value.length > 0
  && expandableItems.value.every((item) => expandedKeys.value.has(itemKey(item)))
)

watch(
  () => [props.open, props.preview] as const,
  ([isOpen, nextPreview]) => {
    metaExpandedKeys.value = new Set()
    postponeMenuOpen.value = false
    if (!isOpen || !nextPreview) {
      expandedKeys.value = new Set()
      return
    }
    const expandable = nextPreview.items.filter((item) => item.changeType === 'modified' && item.details.length > 0)
    // Auto-expand when there are only a few modified items; collapse by default when many
    expandedKeys.value = expandable.length <= 3
      ? new Set(expandable.map((item) => itemKey(item)))
      : new Set()
  },
  { immediate: true }
)

function hasStatusChange(item: CloudSyncDiffItem): boolean {
  return item.details.some((detail) => detail.key === 'status')
}

function isStatusMetaDetail(item: CloudSyncDiffItem, detail: CloudSyncChangeDetail): boolean {
  return hasStatusChange(item) && STATUS_META_KEYS.has(detail.key)
}

function visibleDetails(item: CloudSyncDiffItem): CloudSyncChangeDetail[] {
  return item.details.filter((detail) => !isStatusMetaDetail(item, detail))
}

function statusMetaDetails(item: CloudSyncDiffItem): CloudSyncChangeDetail[] {
  return item.details.filter((detail) => isStatusMetaDetail(item, detail))
}

function compactItemSummary(item: CloudSyncDiffItem): string {
  if (item.changeType !== 'modified') {
    return props.itemSummary(item)
  }
  const statusDetail = item.details.find((d) => d.key === 'status')
  const primary = visibleDetails(item)
  if (statusDetail && primary.length === 1) {
    return `${statusDetail.baseText || '正常'} → ${statusDetail.sourceText || '正常'}`
  }
  const checkedPrimary = item.details.filter((d) => d.checked).length
  return `${checkedPrimary}/${item.details.length} 处`
}

function isExpanded(item: CloudSyncDiffItem): boolean {
  return expandedKeys.value.has(itemKey(item))
}

function toggleExpand(item: CloudSyncDiffItem): void {
  const key = itemKey(item)
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

function toggleExpandAll(): void {
  if (allExpanded.value) {
    expandedKeys.value = new Set()
  } else {
    expandedKeys.value = new Set(expandableItems.value.map((item) => itemKey(item)))
  }
}

function isMetaExpanded(item: CloudSyncDiffItem): boolean {
  return metaExpandedKeys.value.has(itemKey(item))
}

function toggleMetaExpanded(item: CloudSyncDiffItem): void {
  const key = itemKey(item)
  const next = new Set(metaExpandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  metaExpandedKeys.value = next
}

function changeBadgeTone(changeType: CloudSyncDiffItem['changeType']): 'success' | 'warning' | 'danger' {
  if (changeType === 'added') return 'success'
  if (changeType === 'deleted') return 'danger'
  return 'warning'
}

function toggleItem(item: CloudSyncDiffItem) {
  const nextChecked = !props.isItemChecked(item)
  emit('item-checked', item, nextChecked)
}

function toggleDetail(item: CloudSyncDiffItem, detail: CloudSyncChangeDetail) {
  const nextChecked = !detail.checked
  emit('detail-checked', item, detail, nextChecked)
  // Keep folded status metadata in lockstep when toggling `status` while metadata is folded
  if (detail.key === 'status' && !isMetaExpanded(item)) {
    for (const meta of statusMetaDetails(item)) {
      if (meta.checked !== nextChecked) {
        emit('detail-checked', item, meta, nextChecked)
      }
    }
  }
}
</script>

<style scoped>
.sync-review {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sync-password-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background-color: var(--warning-soft);
  color: var(--warning);
  font-size: var(--app-font-xs);
}

.sync-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
}

.sync-top-bar__meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sync-direction-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-main);
}

.sync-counts {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sync-count.is-added {
  color: var(--success);
}

.sync-count.is-modified {
  color: var(--warning);
}

.sync-count.is-deleted {
  color: var(--danger);
}

.sync-top-bar__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sync-diff-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sync-diff-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  overflow: hidden;
}

.sync-diff-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  min-height: 38px;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.sync-diff-head:hover {
  background-color: var(--surface-container-low);
}

.sync-check-wrap {
  display: inline-flex;
  align-items: center;
  padding: 4px 2px;
  cursor: pointer;
}

.sync-diff-head__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.sync-checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--brand);
  flex-shrink: 0;
  cursor: pointer;
}

.sync-diff-path {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-diff-compact-summary {
  flex-shrink: 0;
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  white-space: nowrap;
}

.sync-diff-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}

.sync-field-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.sync-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 26px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}

.sync-field-row:last-child {
  border-bottom: 0;
}

.sync-field-row:hover {
  background-color: var(--surface-container);
}

.sync-field-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--brand);
}

.sync-field-row.is-meta {
  opacity: 0.85;
  padding-left: 34px;
}

.sync-field-label {
  width: 64px;
  flex-shrink: 0;
  font-size: var(--app-font-xs);
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sync-diff-inline {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.sync-val {
  display: inline-block;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  overflow-wrap: anywhere;
}

.sync-val.is-before {
  background-color: var(--danger-soft);
  color: var(--danger);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--danger) 50%, transparent);
}

.sync-val.is-after {
  background-color: var(--success-soft);
  color: var(--success);
}

.sync-diff-arrow {
  color: var(--text-muted);
  font-size: var(--app-font-xs);
  flex-shrink: 0;
}

.sync-meta-fold {
  display: flex;
  flex-direction: column;
}

.sync-meta-fold__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 10px 5px 26px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.sync-meta-fold__btn:hover {
  color: var(--text-secondary);
  background-color: var(--surface-container);
}

.sync-footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.sync-selected-count {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.sync-selected-count strong {
  color: var(--brand);
}

.sync-footer-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sync-postpone-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background-color: var(--surface-container);
}

.sync-postpone-bar__label {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.sync-postpone-bar__presets {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 600px) {
  .sync-field-row {
    padding-left: 12px;
  }

  .sync-field-row.is-meta {
    padding-left: 20px;
  }

  .sync-meta-fold__btn {
    padding-left: 12px;
  }
}
</style>
