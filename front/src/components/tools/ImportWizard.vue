<template>
  <UiModal
    :open="open"
    title="导入数据"
    subtitle="支持 Bitwarden、Chrome / Edge、KeePassXC 与通用 CSV / JSON 导出文件"
    size="lg"
    @close="emit('update:open', false)"
  >
    <div class="import-wizard">
      <ol class="import-steps" aria-label="导入步骤">
        <li class="import-step" :class="{ 'is-active': !preview, 'is-done': Boolean(preview) }">
          <span class="import-step-num">1</span>
          <span>选择来源与文件</span>
        </li>
        <li class="import-step-sep" aria-hidden="true" />
        <li class="import-step" :class="{ 'is-active': Boolean(preview) }">
          <span class="import-step-num">2</span>
          <span>预览与确认导入</span>
        </li>
      </ol>

      <div class="import-security-banner" role="note">
        <UiIcon name="alert" :size="16" class="import-banner-icon" />
        <span>导出文件通常包含明文密码。导入完成后，请立即从设备和回收站中彻底删除原文件。</span>
      </div>

      <input
        ref="fileInput"
        class="import-file-input"
        type="file"
        :accept="selectedSource.accept"
        @change="handleInputChange"
      />

      <template v-if="!preview">
        <div class="import-source-section">
          <span class="import-section-label">选择导出格式来源</span>
          <div class="import-source-grid" role="radiogroup" aria-label="导入来源">
            <button
              v-for="source in sourcePresets"
              :key="source.id"
              type="button"
              role="radio"
              class="import-source-card"
              :class="{ 'is-selected': selectedSourceId === source.id }"
              :aria-checked="selectedSourceId === source.id"
              @click="selectedSourceId = source.id"
            >
              <strong class="import-source-title">{{ source.label }}</strong>
              <span class="import-source-desc">{{ source.description }}</span>
              <UiBadge tone="neutral" size="sm">{{ source.ext }}</UiBadge>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="import-dropzone"
          :class="{ 'is-dragging': isDragging }"
          :disabled="reading"
          @click="fileInput?.click()"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <span class="import-dropzone-icon" aria-hidden="true">
            <UiIcon name="upload" :size="24" />
          </span>
          <strong class="import-dropzone-title">
            {{ reading ? '正在解析文件…' : `拖放或点击选择 ${selectedSource.ext} 文件` }}
          </strong>
          <span class="import-dropzone-hint">
            文件仅在本机内存中解析，解析后会自动识别格式与重复条目
          </span>
        </button>

        <p v-if="errorMessage" class="import-error" role="alert">
          <UiIcon name="alert" :size="15" />
          <span>{{ errorMessage }}</span>
        </p>
      </template>

      <template v-else>
        <div class="import-summary-grid">
          <div class="import-stat-card">
            <span class="import-stat-label">识别格式</span>
            <strong class="import-stat-value">{{ preview.format }}</strong>
          </div>
          <div class="import-stat-card">
            <span class="import-stat-label">新增条目</span>
            <strong class="import-stat-value is-brand">{{ eligibleCount }}</strong>
          </div>
          <div class="import-stat-card">
            <span class="import-stat-label">涉及分组</span>
            <strong class="import-stat-value">{{ folderCount }}</strong>
          </div>
          <div class="import-stat-card">
            <span class="import-stat-label">已存在重复</span>
            <strong class="import-stat-value is-muted">{{ duplicateCount }}</strong>
          </div>
        </div>

        <div class="import-options-bar">
          <div class="import-options-left">
            <label class="import-check-label">
              <input type="checkbox" :checked="allSelectableSelected" @change="toggleAll" />
              <span>全选可导入项（已选 {{ selectedCount }}）</span>
            </label>
          </div>
          <div class="import-options-right">
            <label class="import-conflict-toggle">
              <span>跳过重复条目</span>
              <UiSwitch
                v-model="skipDuplicates"
                aria-label="跳过重复条目"
                @change="handleSkipDuplicatesChange"
              />
            </label>
            <UiButton variant="ghost" size="sm" @click="chooseAnotherFile">
              <UiIcon name="upload" :size="14" />
              <span>更换文件</span>
            </UiButton>
          </div>
        </div>

        <div v-if="preview.warnings.length" class="import-warnings" role="status">
          <p v-for="warning in preview.warnings.slice(0, 5)" :key="warning">{{ warning }}</p>
          <p v-if="preview.warnings.length > 5">另有 {{ preview.warnings.length - 5 }} 条解析提醒</p>
        </div>

        <p v-if="errorMessage" class="import-error" role="alert">
          <UiIcon name="alert" :size="15" />
          <span>{{ errorMessage }}</span>
        </p>

        <div v-if="visibleRecords.length" class="import-table-wrap">
          <div class="import-table-head">
            <span class="import-col-check" />
            <span>条目名称</span>
            <span>类型 / 分组</span>
            <span>状态</span>
          </div>
          <div class="import-table-body">
            <label
              v-for="record in visibleRecords"
              :key="record.importId"
              class="import-row"
              :class="{ 'is-duplicate': isDuplicate(record) && skipDuplicates }"
            >
              <input
                type="checkbox"
                :checked="selectedIds.has(record.importId)"
                :disabled="isDuplicate(record) && skipDuplicates"
                @change="toggleRecord(record.importId)"
              />
              <span class="import-row-title">
                <span class="import-row-icon" aria-hidden="true">
                  <UiIcon :name="kindIconName(record.kind)" :size="14" />
                </span>
                <strong class="import-row-name">{{ record.title }}</strong>
              </span>
              <span class="import-row-meta">
                <span>{{ entryKindLabel(record.kind) }}</span>
                <span v-if="record.folderPath" class="import-row-folder">· {{ record.folderPath }}</span>
              </span>
              <span class="import-row-status">
                <UiBadge v-if="isDuplicate(record)" tone="warning" size="sm">已存在</UiBadge>
                <UiBadge v-else tone="success" size="sm">新增</UiBadge>
              </span>
            </label>
          </div>
        </div>

        <UiEmpty
          v-else
          icon="folder"
          title="没有可预览的条目"
          description="请尝试选择其他导出文件"
        />

        <p v-if="preview.records.length > visibleRecords.length" class="import-limit-note">
          当前展示前 {{ visibleRecords.length }} 项（共 {{ preview.records.length }} 项），其余条目仍会按勾选状态导入。
        </p>
      </template>
    </div>

    <template #footer>
      <UiButton variant="secondary" @click="emit('update:open', false)">取消</UiButton>
      <UiButton
        v-if="preview"
        variant="primary"
        :disabled="selectedCount === 0"
        :loading="busy"
        @click="submitImport"
      >
        <UiIcon name="download" :size="15" />
        <span>确认导入 {{ selectedCount }} 项</span>
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiModal, UiSwitch, type UiIconName } from '../ui'
import { entryKindLabel } from '../../services/entryKinds.ts'
import {
  existingImportFingerprints,
  importRecordFingerprint,
  parseVaultImport,
  type ImportedVaultRecord,
  type VaultImportPreview
} from '../../services/vaultImport.ts'
import type { EntryKind, VaultEntry } from '../../types.ts'

const props = defineProps<{
  open: boolean
  entries: VaultEntry[]
  busy: boolean
  resetKey: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  import: [records: ImportedVaultRecord[]]
}>()

const sourcePresets = [
  {
    id: 'bitwarden',
    label: 'Bitwarden',
    description: '标准未加密 JSON 或 CSV 导出',
    ext: 'JSON / CSV',
    accept: '.json,.csv,application/json,text/csv'
  },
  {
    id: 'chrome',
    label: 'Chrome / Edge',
    description: '浏览器密码管理器 CSV 导出',
    ext: 'CSV',
    accept: '.csv,.json,text/csv,application/json'
  },
  {
    id: 'keepass',
    label: 'KeePassXC',
    description: 'KeePass / KeePassXC 表格导出',
    ext: 'CSV',
    accept: '.csv,.json,text/csv,application/json'
  },
  {
    id: 'generic',
    label: '1Password / 通用',
    description: '常见通用 CSV / JSON 密码导出',
    ext: 'CSV / JSON',
    accept: '.csv,.json,text/csv,application/json'
  }
]

const selectedSourceId = ref('bitwarden')
const selectedSource = computed(
  () => sourcePresets.find((item) => item.id === selectedSourceId.value) || sourcePresets[0]
)

const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<VaultImportPreview | null>(null)
const selectedIds = ref(new Set<string>())
const duplicateIds = ref(new Set<string>())
const skipDuplicates = ref(true)
const reading = ref(false)
const isDragging = ref(false)
const errorMessage = ref('')

const visibleRecords = computed(() => (preview.value?.records || []).slice(0, 500))
const eligibleRecords = computed(() => (preview.value?.records || []).filter((record) => !isDuplicate(record)))
const selectableRecords = computed(() =>
  skipDuplicates.value ? eligibleRecords.value : (preview.value?.records || [])
)
const eligibleCount = computed(() => eligibleRecords.value.length)
const duplicateCount = computed(() => (preview.value?.records.length || 0) - eligibleCount.value)
const folderCount = computed(() => {
  const folders = new Set(
    (preview.value?.records || [])
      .map((record) => record.folderPath?.trim() || '')
      .filter(Boolean)
  )
  return folders.size
})
const selectedCount = computed(() => selectedIds.value.size)
const allSelectableSelected = computed(
  () =>
    selectableRecords.value.length > 0 &&
    selectableRecords.value.every((record) => selectedIds.value.has(record.importId))
)

watch(() => props.resetKey, reset)
watch(() => props.open, (isOpen) => {
  if (!isOpen) reset()
})

function kindIconName(kind: EntryKind): UiIconName {
  if (kind === 'login') return 'lock'
  if (kind === 'secure-note') return 'edit'
  if (kind === 'card') return 'shield'
  if (kind === 'identity') return 'info'
  if (kind === 'api-key') return 'key'
  if (kind === 'folder') return 'folder'
  return 'lock'
}

function handleInputChange(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (file) void parseFile(file)
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void parseFile(file)
}

async function parseFile(file: File) {
  reading.value = true
  errorMessage.value = ''
  preview.value = null
  selectedIds.value = new Set()
  try {
    const parsed = parseVaultImport(await file.text(), file.name)
    const knownFingerprints = existingImportFingerprints(props.entries)
    const repeatedIds = new Set<string>()
    for (const record of parsed.records) {
      const fingerprint = importRecordFingerprint(record)
      if (knownFingerprints.has(fingerprint)) repeatedIds.add(record.importId)
      else knownFingerprints.add(fingerprint)
    }
    duplicateIds.value = repeatedIds
    preview.value = parsed
    selectedIds.value = new Set(
      parsed.records
        .filter((record) => !skipDuplicates.value || !repeatedIds.has(record.importId))
        .map((record) => record.importId)
    )
    if (!parsed.records.length) errorMessage.value = '文件中没有可导入的条目。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法读取导入文件。'
  } finally {
    reading.value = false
  }
}

function isDuplicate(record: ImportedVaultRecord) {
  return duplicateIds.value.has(record.importId)
}

function handleSkipDuplicatesChange(skip: boolean) {
  if (!preview.value) return
  if (skip) {
    const next = new Set(selectedIds.value)
    for (const id of duplicateIds.value) next.delete(id)
    selectedIds.value = next
  }
}

function toggleRecord(importId: string) {
  const next = new Set(selectedIds.value)
  if (next.has(importId)) next.delete(importId)
  else next.add(importId)
  selectedIds.value = next
}

function toggleAll() {
  selectedIds.value = allSelectableSelected.value
    ? new Set()
    : new Set(selectableRecords.value.map((record) => record.importId))
}

function submitImport() {
  if (!preview.value || props.busy) return
  emit('import', preview.value.records.filter((record) => selectedIds.value.has(record.importId)))
}

function chooseAnotherFile() {
  reset()
  fileInput.value?.click()
}

function reset() {
  preview.value = null
  selectedIds.value = new Set()
  duplicateIds.value = new Set()
  errorMessage.value = ''
  reading.value = false
  isDragging.value = false
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<style scoped>
.import-wizard {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.import-steps {
  display: flex;
  align-items: center;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.import-step {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--app-font-sm);
  color: var(--text-muted);
  font-weight: 500;
}

.import-step-num {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-container-high);
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 600;
}

.import-step.is-active {
  color: var(--text-main);
  font-weight: 600;
}

.import-step.is-active .import-step-num {
  background-color: var(--brand);
  color: var(--on-brand);
}

.import-step.is-done {
  color: var(--brand);
}

.import-step.is-done .import-step-num {
  background-color: var(--brand-soft);
  color: var(--brand);
}

.import-step-sep {
  flex: 1 1 auto;
  height: 1px;
  background-color: var(--border-soft);
}

.import-security-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background-color: var(--warning-soft);
  color: var(--warning);
  font-size: var(--app-font-sm);
  line-height: 1.45;
}

.import-banner-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.import-file-input {
  display: none;
}

.import-source-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-section-label {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.import-source-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.import-source-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.import-source-card:hover {
  border-color: var(--border-strong);
  background-color: var(--surface-container);
}

.import-source-card.is-selected {
  border-color: var(--brand);
  background-color: var(--brand-soft);
}

.import-source-title {
  font-size: var(--app-font-base);
  font-weight: 600;
  color: var(--text-main);
}

.import-source-desc {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.35;
}

.import-dropzone {
  width: 100%;
  min-height: 152px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background-color: var(--surface-container-low);
  color: var(--text-main);
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.import-dropzone:hover:not(:disabled),
.import-dropzone.is-dragging {
  border-color: var(--brand);
  background-color: var(--brand-soft);
}

.import-dropzone-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--brand-soft);
  color: var(--brand);
}

.import-dropzone-title {
  font-size: var(--app-font-base);
  font-weight: 600;
}

.import-dropzone-hint {
  max-width: 380px;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.45;
}

.import-error {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background-color: var(--danger-soft);
  color: var(--danger);
  font-size: var(--app-font-sm);
}

.import-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.import-stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  min-width: 0;
}

.import-stat-label {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.import-stat-value {
  font-size: var(--app-font-md);
  font-weight: 700;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-stat-value.is-brand {
  color: var(--brand);
}

.import-stat-value.is-muted {
  color: var(--text-secondary);
}

.import-options-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
}

.import-options-left,
.import-options-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.import-check-label,
.import-conflict-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--app-font-sm);
  color: var(--text-main);
  cursor: pointer;
}

.import-check-label input {
  accent-color: var(--brand);
  width: 15px;
  height: 15px;
}

.import-warnings {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background-color: var(--warning-soft);
  color: var(--warning);
  font-size: var(--app-font-xs);
  line-height: 1.45;
}

.import-warnings p {
  margin: 0 0 4px;
}

.import-warnings p:last-child {
  margin-bottom: 0;
}

.import-table-wrap {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: var(--panel-bg);
}

.import-table-head,
.import-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1.5fr) minmax(0, 1.1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}

.import-table-head {
  background-color: var(--surface-container-low);
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-muted);
}

.import-table-body {
  max-height: 300px;
  overflow-y: auto;
}

.import-row {
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.import-row:last-child {
  border-bottom: 0;
}

.import-row:hover:not(.is-duplicate) {
  background-color: var(--surface-container-low);
}

.import-row.is-duplicate {
  opacity: 0.56;
  cursor: default;
}

.import-row input {
  accent-color: var(--brand);
  width: 15px;
  height: 15px;
}

.import-row-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.import-row-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--brand-soft);
  color: var(--brand);
  flex-shrink: 0;
}

.import-row-name {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-row-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-row-folder {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.import-limit-note {
  margin: 0;
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .import-source-grid {
    grid-template-columns: 1fr;
  }

  .import-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .import-table-head {
    display: none;
  }

  .import-row {
    grid-template-columns: 24px minmax(0, 1fr) auto;
    row-gap: 4px;
  }

  .import-row-meta {
    grid-column: 2 / 4;
  }
}
</style>
