<template>
  <van-popup
    :show="open"
    position="right"
    class="passkey-manager-popup"
    :duration="0.14"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <div class="passkey-manager-shell">
      <van-nav-bar title="通行密钥" left-arrow @click-left="emit('update:open', false)" />
      <div class="passkey-manager-toolbar">
        <van-icon name="search" />
        <input v-model="query" type="search" placeholder="搜索名称、网站或账号" aria-label="搜索通行密钥" />
        <span>{{ filteredItems.length }}</span>
      </div>

      <div class="passkey-manager-content">
        <div class="passkey-list" role="listbox" aria-label="通行密钥列表">
          <button
            v-for="item in filteredItems"
            :key="item.id"
            type="button"
            role="option"
            class="passkey-list-item"
            :class="{ active: selectedId === item.id }"
            :aria-selected="selectedId === item.id"
            @click="selectItem(item.id)"
          >
            <span class="passkey-item-icon"><van-icon name="shield-o" /></span>
            <span class="passkey-item-copy">
              <strong>{{ item.displayLabel }}</strong>
              <small>{{ item.accountLabel }} · {{ item.rpId }}</small>
            </span>
            <van-icon name="arrow" />
          </button>
          <van-empty v-if="filteredItems.length === 0" image="search" :description="items.length ? '没有匹配结果' : '暂无通行密钥'" />
        </div>

        <section v-if="selected" class="passkey-inspector">
          <header>
            <div>
              <span>{{ selected.rpId }}</span>
              <h2>{{ selected.displayLabel }}</h2>
              <small>{{ selected.accountLabel }}</small>
            </div>
            <span class="passkey-state-badge" :class="{ synced: selected.backupState }">
              {{ selected.backupState ? '已备份' : selected.backupEligible ? '可备份' : '仅本机' }}
            </span>
          </header>

          <div class="passkey-meta-grid">
            <div><span>类型</span><strong>{{ selected.discoverable ? '可发现凭据' : '服务端凭据' }}</strong></div>
            <div><span>传输</span><strong>{{ selected.transports.join(' · ') || '未声明' }}</strong></div>
            <div><span>创建</span><strong>{{ formatTime(selected.createdAt) }}</strong></div>
            <div><span>更新</span><strong>{{ formatTime(selected.updatedAt) }}</strong></div>
          </div>

          <label class="passkey-form-field">
            <span>显示名称</span>
            <input v-model="labelDraft" maxlength="512" placeholder="使用网站名称" />
          </label>
          <label class="passkey-form-field">
            <span>关联登录项</span>
            <select v-model="entryIdDraft">
              <option value="">不关联</option>
              <option v-for="option in loginOptions" :key="option.id" :value="option.id">{{ option.title }}</option>
            </select>
          </label>

          <div class="passkey-link-summary">
            <span>当前关联</span>
            <button v-if="selected.linkedEntryId && selected.linkedEntryTitle" type="button" @click="emit('open-entry', selected.linkedEntryId)">
              {{ selected.linkedEntryTitle }} <van-icon name="arrow" />
            </button>
            <strong v-else>{{ selected.linkedEntryId ? '关联项已失效' : '未关联' }}</strong>
          </div>

          <div class="passkey-manager-actions">
            <van-button size="small" type="danger" plain icon="delete-o" :disabled="busy" @click="emit('delete', selected.id)">删除</van-button>
            <van-button size="small" type="primary" :loading="busy" :disabled="!draftChanged" @click="saveMetadata">保存</van-button>
          </div>
        </section>
      </div>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  return props.items.filter((item) => [item.displayLabel, item.rpId, item.accountLabel, item.linkedEntryTitle || '']
    .some((value) => value.toLocaleLowerCase().includes(term)))
})
const selected = computed(() => props.items.find((item) => item.id === selectedId.value) || null)
const draftChanged = computed(() => Boolean(selected.value) && (
  labelDraft.value.trim() !== selected.value?.userLabel
  || entryIdDraft.value !== (selected.value?.linkedEntryId || '')
))

watch(() => props.open, (open) => {
  if (!open) return
  query.value = ''
  selectItem(props.initialId && props.items.some((item) => item.id === props.initialId)
    ? props.initialId
    : props.items[0]?.id || '')
})

watch(() => props.initialId, (id) => {
  if (props.open && id && props.items.some((item) => item.id === id)) selectItem(id)
})

watch(() => props.items, () => {
  if (selectedId.value && props.items.some((item) => item.id === selectedId.value)) selectItem(selectedId.value)
  else selectItem(props.items[0]?.id || '')
}, { deep: true })

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
