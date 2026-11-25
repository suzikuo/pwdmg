<template>
  <UiModal
    :open="open"
    title="通行密钥管理"
    :subtitle="`共 ${items.length} 个已保存的通行密钥`"
    size="xl"
    @close="emit('update:open', false)"
  >
    <div class="passkey-manager">
      <div class="passkey-search-bar">
        <UiInput
          v-model="query"
          type="search"
          clearable
          placeholder="搜索名称、网站域名或账号…"
        >
          <template #prefix>
            <UiIcon name="search" :size="15" />
          </template>
          <template #suffix>
            <UiBadge tone="neutral" size="sm">{{ filteredItems.length }}</UiBadge>
          </template>
        </UiInput>
      </div>

      <div class="passkey-split">
        <div class="passkey-list" role="listbox" aria-label="通行密钥列表">
          <button
            v-for="item in filteredItems"
            :key="item.id"
            type="button"
            role="option"
            class="passkey-list-item"
            :class="{ 'is-active': selectedId === item.id }"
            :aria-selected="selectedId === item.id"
            @click="selectItem(item.id)"
          >
            <span class="passkey-item-icon" aria-hidden="true">
              <UiIcon name="key" :size="16" />
            </span>
            <span class="passkey-item-copy">
              <strong class="passkey-item-title">{{ item.displayLabel }}</strong>
              <small class="passkey-item-sub">{{ item.accountLabel }} · {{ item.rpId }}</small>
              <span v-if="item.linkedEntryTitle" class="passkey-item-link">
                <UiBadge tone="brand" size="sm">{{ item.linkedEntryTitle }}</UiBadge>
              </span>
            </span>
            <UiIcon name="chevron-right" :size="15" class="passkey-item-arrow" />
          </button>

          <UiEmpty
            v-if="filteredItems.length === 0"
            icon="key"
            :title="items.length ? '没有匹配的通行密钥' : '暂无通行密钥'"
            :description="items.length ? '尝试更换搜索关键词' : '通过支持 Passkey 的网站或应用创建后会自动显示在这里'"
          />
        </div>

        <section v-if="selected" class="passkey-inspector" aria-label="通行密钥详情">
          <header class="passkey-inspector-head">
            <div class="passkey-inspector-title-group">
              <UiBadge tone="neutral" size="sm">{{ selected.rpId }}</UiBadge>
              <h3 class="passkey-inspector-title">{{ selected.displayLabel }}</h3>
              <p class="passkey-inspector-account">{{ selected.accountLabel }}</p>
            </div>
            <UiBadge :tone="selected.backupState ? 'success' : selected.backupEligible ? 'brand' : 'neutral'">
              {{ selected.backupState ? '已同步备份' : selected.backupEligible ? '可备份' : '仅本机' }}
            </UiBadge>
          </header>

          <div class="passkey-meta-grid">
            <div class="passkey-meta-card">
              <span>凭据类型</span>
              <strong>{{ selected.discoverable ? '可发现凭据' : '服务端凭据' }}</strong>
            </div>
            <div class="passkey-meta-card">
              <span>传输方式</span>
              <strong>{{ selected.transports.join(' · ') || '未声明' }}</strong>
            </div>
            <div class="passkey-meta-card">
              <span>创建时间</span>
              <strong>{{ formatTime(selected.createdAt) }}</strong>
            </div>
            <div class="passkey-meta-card">
              <span>最近更新</span>
              <strong>{{ formatTime(selected.updatedAt) }}</strong>
            </div>
          </div>

          <div class="passkey-edit-section">
            <UiInput
              v-model="labelDraft"
              label="显示名称"
              placeholder="默认使用网站名称"
            />

            <div class="passkey-field-block">
              <label class="passkey-field-label" for="passkey-linked-entry-select">关联登录条目</label>
              <div class="passkey-select-row">
                <select
                  id="passkey-linked-entry-select"
                  v-model="entryIdDraft"
                  class="passkey-select"
                >
                  <option value="">不关联任何条目</option>
                  <option v-for="option in loginOptions" :key="option.id" :value="option.id">
                    {{ option.title }}
                  </option>
                </select>
                <UiButton
                  v-if="entryIdDraft"
                  variant="ghost"
                  size="sm"
                  :disabled="busy"
                  @click="entryIdDraft = ''"
                >
                  解除关联
                </UiButton>
              </div>
            </div>
          </div>

          <div class="passkey-link-summary">
            <span class="passkey-link-label">当前关联</span>
            <button
              v-if="selected.linkedEntryId && selected.linkedEntryTitle"
              type="button"
              class="passkey-link-jump"
              @click="emit('open-entry', selected.linkedEntryId)"
            >
              <span>{{ selected.linkedEntryTitle }}</span>
              <UiIcon name="external-link" :size="14" />
            </button>
            <UiBadge v-else :tone="selected.linkedEntryId ? 'warning' : 'neutral'" size="sm">
              {{ selected.linkedEntryId ? '关联条目已失效' : '未关联' }}
            </UiBadge>
          </div>

          <div class="passkey-inspector-actions">
            <UiButton
              variant="danger"
              size="sm"
              :disabled="busy"
              @click="emit('delete', selected.id)"
            >
              <UiIcon name="trash" :size="14" />
              <span>删除密钥</span>
            </UiButton>
            <UiButton
              variant="primary"
              size="sm"
              :loading="busy"
              :disabled="!draftChanged"
              @click="saveMetadata"
            >
              <UiIcon name="check" :size="14" />
              <span>保存更改</span>
            </UiButton>
          </div>
        </section>

        <div v-else class="passkey-inspector-empty">
          <UiEmpty
            icon="shield"
            title="选择一个通行密钥"
            description="在左侧列表中选择条目以查看详情、修改显示名称或管理关联登录项"
          />
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiInput, UiModal } from '../ui'
import type { PasskeyPresentationItem } from '../../services/passkeyPresentation.ts'

const props = defineProps<{
  open: boolean
  items: PasskeyPresentationItem[]
  loginOptions: Array<{ id: string; title: string }>
  busy: boolean
  initialId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: { id: string; label: string; entryId: string }]
  delete: [id: string]
  'open-entry': [id: string]
}>()

const query = ref('')
const selectedId = ref('')
const labelDraft = ref('')
const entryIdDraft = ref('')

const filteredItems = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  if (!term) return props.items
  return props.items.filter((item) =>
    [item.displayLabel, item.rpId, item.accountLabel, item.linkedEntryTitle || ''].some((value) =>
      value.toLocaleLowerCase().includes(term)
    )
  )
})

const selected = computed(() => props.items.find((item) => item.id === selectedId.value) || null)

const draftChanged = computed(
  () =>
    Boolean(selected.value) &&
    (labelDraft.value.trim() !== selected.value?.userLabel ||
      entryIdDraft.value !== (selected.value?.linkedEntryId || ''))
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    selectItem(
      props.initialId && props.items.some((item) => item.id === props.initialId)
        ? props.initialId
        : props.items[0]?.id || ''
    )
  },
  { immediate: true }
)

watch(
  () => props.initialId,
  (id) => {
    if (props.open && id && props.items.some((item) => item.id === id)) selectItem(id)
  }
)

watch(
  () => props.items,
  () => {
    if (selectedId.value && props.items.some((item) => item.id === selectedId.value)) {
      selectItem(selectedId.value)
    } else {
      selectItem(props.items[0]?.id || '')
    }
  },
  { deep: true }
)

function selectItem(id: string) {
  selectedId.value = id
  const item = props.items.find((candidate) => candidate.id === id)
  labelDraft.value = item?.userLabel || ''
  entryIdDraft.value = item?.linkedEntryId || ''
}

function saveMetadata() {
  if (!selected.value || !draftChanged.value) return
  emit('save', {
    id: selected.value.id,
    label: labelDraft.value,
    entryId: entryIdDraft.value
  })
}

function formatTime(value: number) {
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toLocaleString() : '-'
}
</script>

<style scoped>
.passkey-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.passkey-split {
  display: grid;
  grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
  gap: 16px;
  min-height: 380px;
}

.passkey-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.passkey-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  color: var(--text-main);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.passkey-list-item:hover {
  background-color: var(--surface-container);
  border-color: var(--border-strong);
}

.passkey-list-item.is-active {
  background-color: var(--brand-soft);
  border-color: var(--brand);
}

.passkey-item-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--brand-soft);
  color: var(--brand);
  flex-shrink: 0;
}

.passkey-item-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.passkey-item-title {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passkey-item-sub {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passkey-item-link {
  margin-top: 2px;
}

.passkey-item-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
}

.passkey-inspector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.passkey-inspector-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.passkey-inspector-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.passkey-inspector-title-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
}

.passkey-inspector-title {
  margin: 0;
  font-size: var(--app-font-lg);
  font-weight: 700;
  color: var(--text-main);
  word-break: break-word;
}

.passkey-inspector-account {
  margin: 0;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
  word-break: break-all;
}

.passkey-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.passkey-meta-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
}

.passkey-meta-card span {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.passkey-meta-card strong {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.passkey-edit-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.passkey-field-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.passkey-field-label {
  font-size: var(--app-font-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.passkey-select-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.passkey-select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-height-md);
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  font-size: var(--app-font-base);
  outline: none;
}

.passkey-select:focus {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.passkey-link-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
}

.passkey-link-label {
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
}

.passkey-link-jump {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background-color: var(--brand-soft);
  color: var(--brand);
  font-size: var(--app-font-sm);
  font-weight: 600;
  cursor: pointer;
}

.passkey-link-jump:hover {
  background-color: var(--brand-soft-hover);
}

.passkey-inspector-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

@media (max-width: 767px) {
  .passkey-split {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .passkey-list {
    max-height: 240px;
  }

  .passkey-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
