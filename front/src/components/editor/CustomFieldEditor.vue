<template>
  <section class="custom-field-editor">
    <div class="custom-field-head">
      <div class="custom-field-title-group">
        <strong class="custom-field-title">自定义字段</strong>
        <UiBadge tone="neutral" size="sm">{{ modelValue.length }} 项</UiBadge>
      </div>
      <UiButton variant="subtle" size="sm" @click="addField">
        <UiIcon name="plus" :size="14" />
        <span>添加字段</span>
      </UiButton>
    </div>

    <div v-if="modelValue.length" class="custom-field-list">
      <div v-for="(field, index) in modelValue" :key="field.id" class="custom-field-card">
        <div class="custom-field-meta">
          <input
            class="custom-field-control"
            :value="field.label"
            type="text"
            autocomplete="off"
            maxlength="200"
            aria-label="字段名称"
            placeholder="字段名称"
            @input="updateField(index, 'label', inputValue($event))"
          />
          <select
            class="custom-field-select"
            :value="field.type"
            aria-label="字段类型"
            @change="updateType(index, inputValue($event))"
          >
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <button
            type="button"
            class="custom-field-icon-btn"
            :class="{ 'is-active': field.protected }"
            :aria-label="field.protected ? '取消保护字段' : '保护字段'"
            :aria-pressed="field.protected"
            :title="field.protected ? '取消保护字段' : '保护字段'"
            @click="updateField(index, 'protected', !field.protected)"
          >
            <UiIcon :name="field.protected ? 'lock' : 'unlock'" :size="15" />
          </button>
          <button
            type="button"
            class="custom-field-icon-btn is-danger"
            aria-label="删除字段"
            title="删除字段"
            @click="removeField(index)"
          >
            <UiIcon name="trash" :size="15" />
          </button>
        </div>

        <div class="custom-field-value">
          <input
            class="custom-field-control"
            :class="{ 'is-mono': field.type === 'secret' || field.protected }"
            :value="field.value"
            :type="fieldInputType(field)"
            :autocomplete="field.type === 'secret' ? 'new-password' : 'off'"
            maxlength="65536"
            aria-label="字段值"
            placeholder="字段值"
            @input="updateField(index, 'value', inputValue($event))"
          />
          <button
            v-if="field.protected || field.type === 'secret'"
            type="button"
            class="custom-field-icon-btn"
            :aria-label="revealed.has(field.id) ? '隐藏字段' : '显示字段'"
            :title="revealed.has(field.id) ? '隐藏字段' : '显示字段'"
            @click="toggleReveal(field.id)"
          >
            <UiIcon :name="revealed.has(field.id) ? 'eye-off' : 'eye'" :size="15" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { UiBadge, UiButton, UiIcon } from '../ui'
import { secureRandomId } from '../../services/secureRandom.ts'
import type { VaultCustomField, VaultCustomFieldType } from '../../types.ts'

const props = defineProps<{ modelValue: VaultCustomField[] }>()
const emit = defineEmits<{ 'update:model-value': [value: VaultCustomField[]] }>()
const revealed = ref(new Set<string>())
const typeOptions: Array<{ value: VaultCustomFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'secret', label: '密码' },
  { value: 'date', label: '日期' },
  { value: 'url', label: '网址' },
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '电话' }
]

watch(() => props.modelValue.map((field) => field.id).join('|'), () => {
  const liveIds = new Set(props.modelValue.map((field) => field.id))
  revealed.value = new Set([...revealed.value].filter((id) => liveIds.has(id)))
})

function addField() {
  emit('update:model-value', [
    ...props.modelValue,
    { id: secureRandomId(), label: '', value: '', type: 'text', protected: false }
  ])
}

function updateField<K extends keyof VaultCustomField>(index: number, key: K, value: VaultCustomField[K]) {
  emit('update:model-value', props.modelValue.map((field, current) => current === index ? { ...field, [key]: value } : field))
}

function updateType(index: number, value: string) {
  const type = typeOptions.some((option) => option.value === value) ? value as VaultCustomFieldType : 'text'
  const field = props.modelValue[index]
  if (!field) return
  emit('update:model-value', props.modelValue.map((item, current) => current === index
    ? { ...item, type, protected: type === 'secret' ? true : item.protected }
    : item))
}

function removeField(index: number) {
  emit('update:model-value', props.modelValue.filter((_, current) => current !== index))
}

function toggleReveal(id: string) {
  const next = new Set(revealed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealed.value = next
}

function fieldInputType(field: VaultCustomField) {
  if ((field.protected || field.type === 'secret') && !revealed.value.has(field.id)) return 'password'
  if (field.type === 'date') return 'date'
  if (field.type === 'email') return 'email'
  if (field.type === 'phone') return 'tel'
  if (field.type === 'url') return 'url'
  return 'text'
}

function inputValue(event: Event) {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target.value : ''
}
</script>

<style scoped>
.custom-field-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.custom-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.custom-field-title-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.custom-field-title {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.custom-field-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-field-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.custom-field-meta,
.custom-field-value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.custom-field-control,
.custom-field-select {
  height: var(--control-height-sm);
  padding: 0 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  font-family: inherit;
  font-size: var(--app-font-sm);
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.custom-field-control:focus,
.custom-field-select:focus {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.custom-field-control {
  flex: 1 1 auto;
  min-width: 0;
}

.custom-field-control.is-mono {
  font-family: var(--font-mono);
  font-variant-ligatures: none;
}

.custom-field-select {
  width: 78px;
  flex: 0 0 78px;
}

.custom-field-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.custom-field-icon-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.custom-field-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.custom-field-icon-btn.is-active {
  background-color: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 36%, transparent);
  color: var(--brand);
}

.custom-field-icon-btn.is-danger {
  color: var(--danger);
}

.custom-field-icon-btn.is-danger:hover {
  background-color: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 420px) {
  .custom-field-meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 74px var(--control-height-sm) var(--control-height-sm);
  }
}
</style>
