<template>
  <van-popup
    :show="open"
    position="bottom"
    class="import-popup"
    :duration="0.12"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <div class="import-shell">
      <van-nav-bar safe-area-inset-top title="导入数据" left-arrow @click-left="emit('update:open', false)" />

      <div class="import-body">
        <div class="import-warning">
          <van-icon name="warning-o" />
          <span>导出文件包含明文密码。导入完成后，请立即从设备和回收站中删除原文件。</span>
        </div>

        <input ref="fileInput" class="import-file-input" type="file" accept=".csv,.json,text/csv,application/json" @change="readFile" />
        <button v-if="!preview" class="import-file-picker" type="button" :disabled="reading" @click="fileInput?.click()">
          <van-icon name="upgrade" />
          <strong>{{ reading ? '正在读取' : '选择 CSV 或 JSON 文件' }}</strong>
          <span>支持 Chrome、Edge、Bitwarden、KeePassXC 和 1Password 常见导出格式</span>
        </button>

        <div v-if="errorMessage" class="import-error">{{ errorMessage }}</div>

        <template v-if="preview">
          <div class="import-summary">
            <div><span>格式</span><strong>{{ preview.format }}</strong></div>
            <div><span>可导入</span><strong>{{ eligibleCount }}</strong></div>
            <div><span>重复</span><strong>{{ duplicateCount }}</strong></div>
          </div>

          <div class="import-toolbar">
            <label>
              <input type="checkbox" :checked="allEligibleSelected" @change="toggleAll" />
              <span>选择全部非重复项</span>
            </label>
            <button type="button" @click="chooseAnotherFile">更换文件</button>
          </div>

          <div v-if="preview.warnings.length" class="import-warnings">
            <p v-for="warning in preview.warnings.slice(0, 5)" :key="warning">{{ warning }}</p>
            <p v-if="preview.warnings.length > 5">另有 {{ preview.warnings.length - 5 }} 条警告</p>
          </div>

          <div class="import-records">
            <label v-for="record in visibleRecords" :key="record.importId" class="import-record" :class="{ duplicate: isDuplicate(record) }">
              <input
                type="checkbox"
                :checked="selectedIds.has(record.importId)"
                :disabled="isDuplicate(record)"
                @change="toggleRecord(record.importId)"
              />
              <span class="import-record-icon"><van-icon :name="entryKindIcon(record.kind)" /></span>
              <span class="import-record-main">
                <strong>{{ record.title }}</strong>
                <small>{{ entryKindLabel(record.kind) }}<template v-if="record.folderPath"> · {{ record.folderPath }}</template></small>
              </span>
              <span v-if="isDuplicate(record)" class="import-duplicate-label">已存在</span>
            </label>
          </div>
          <p v-if="preview.records.length > visibleRecords.length" class="import-limit-note">
            仅展示前 {{ visibleRecords.length }} 项，其他非重复项仍会按全选状态导入。
          </p>
        </template>
      </div>

      <div v-if="preview" class="import-submit-bar">
        <van-button block type="primary" :disabled="selectedCount === 0" :loading="busy" @click="submitImport">
          导入 {{ selectedCount }} 项
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { entryKindIcon, entryKindLabel } from '../../services/entryKinds.ts'
import {
  existingImportFingerprints,
  importRecordFingerprint,
  parseVaultImport,
  type ImportedVaultRecord,
  type VaultImportPreview
} from '../../services/vaultImport.ts'
import type { VaultEntry } from '../../types.ts'

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

const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<VaultImportPreview | null>(null)
const selectedIds = ref(new Set<string>())
const duplicateIds = ref(new Set<string>())
const reading = ref(false)
const errorMessage = ref('')
const visibleRecords = computed(() => (preview.value?.records || []).slice(0, 500))
const eligibleRecords = computed(() => (preview.value?.records || []).filter((record) => !isDuplicate(record)))
const eligibleCount = computed(() => eligibleRecords.value.length)
const duplicateCount = computed(() => (preview.value?.records.length || 0) - eligibleCount.value)
const selectedCount = computed(() => selectedIds.value.size)
const allEligibleSelected = computed(() => eligibleCount.value > 0 && eligibleRecords.value.every((record) => selectedIds.value.has(record.importId)))

watch(() => props.resetKey, reset)
watch(() => props.open, (open) => {
  if (!open) reset()
})

async function readFile(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (!file) return
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
    selectedIds.value = new Set(parsed.records
      .filter((record) => !repeatedIds.has(record.importId))
      .map((record) => record.importId))
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

function toggleRecord(importId: string) {
  const next = new Set(selectedIds.value)
  if (next.has(importId)) next.delete(importId)
  else next.add(importId)
  selectedIds.value = next
}

function toggleAll() {
  selectedIds.value = allEligibleSelected.value
    ? new Set()
    : new Set(eligibleRecords.value.map((record) => record.importId))
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
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<style scoped>
.import-shell {
  height: min(88dvh, 760px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--app-bg);
}

.import-body {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 20px;
}

.import-warning,
.import-error,
.import-warnings {
  border-radius: 7px;
  padding: 10px 12px;
  font-size: var(--app-font-sm);
}

.import-warning {
  display: flex;
  gap: 8px;
  color: #854d0e;
  background: #fef9c3;
}

.import-file-input { display: none; }

.import-file-picker {
  width: 100%;
  min-height: 150px;
  margin-top: 14px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  border: 1px dashed var(--panel-border);
  border-radius: 8px;
  color: var(--text-main);
  background: var(--panel-bg);
  cursor: pointer;
}

.import-file-picker .van-icon { color: var(--brand-strong); font-size: 30px; }
.import-file-picker span { max-width: 420px; color: var(--text-muted); font-size: var(--app-font-sm); }
.import-error { margin-top: 12px; color: #991b1b; background: #fee2e2; }

.import-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-border);
}

.import-summary div { display: grid; gap: 3px; padding: 10px; background: var(--panel-bg); }
.import-summary span { color: var(--text-muted); font-size: var(--app-font-sm); }
.import-summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.import-toolbar {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.import-toolbar label { display: flex; align-items: center; gap: 8px; }
.import-toolbar button { border: 0; color: var(--brand-strong); background: transparent; cursor: pointer; }
.import-warnings { margin-bottom: 10px; color: #854d0e; background: #fef9c3; }
.import-warnings p { margin: 0 0 4px; }
.import-warnings p:last-child { margin-bottom: 0; }

.import-records { border-top: 1px solid var(--panel-border); }
.import-record {
  min-height: 58px;
  display: grid;
  grid-template-columns: auto 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--panel-border);
  cursor: pointer;
}
.import-record.duplicate { opacity: .62; cursor: default; }
.import-record-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; color: var(--brand-strong); background: var(--panel-bg-muted); }
.import-record-main { min-width: 0; display: grid; gap: 3px; }
.import-record-main strong, .import-record-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-record-main small, .import-duplicate-label, .import-limit-note { color: var(--text-muted); font-size: var(--app-font-sm); }
.import-submit-bar { padding: 10px 16px max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--panel-border); background: var(--panel-bg); }

@media (min-width: 820px) {
  .import-popup { width: min(680px, 100vw); left: 50%; transform: translateX(-50%); border-radius: 8px 8px 0 0; }
}

@media (max-width: 420px) {
  .import-body { padding-inline: 12px; }
  .import-summary div { padding-inline: 7px; }
  .import-toolbar { align-items: flex-start; padding-block: 8px; }
}

:global(html[data-theme='dark']) .import-warning,
:global(html[data-theme='dark']) .import-warnings { color: #fde68a; background: #422006; }
:global(html[data-theme='dark']) .import-error { color: #fecaca; background: #450a0a; }
</style>
