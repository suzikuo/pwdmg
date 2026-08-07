<template>
  <section class="custom-field-editor">
    <div class="custom-field-head">
      <div><strong>自定义字段</strong><span>{{ modelValue.length }} 项</span></div>
      <button type="button" class="custom-field-add" @click="addField"><van-icon name="plus" />添加</button>
    </div>

    <div v-if="modelValue.length" class="custom-field-list">
      <div v-for="(field, index) in modelValue" :key="field.id" class="custom-field-item">
        <div class="custom-field-meta">
          <input
            :value="field.label"
            type="text"
            maxlength="200"
            aria-label="字段名称"
            placeholder="字段名称"
            @input="updateField(index, 'label', inputValue($event))"
          />
          <select :value="field.type" aria-label="字段类型" @change="updateType(index, inputValue($event))">
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <button
            type="button"
            class="inline-icon-button"
            :class="{ active: field.protected }"
            :aria-label="field.protected ? '取消保护字段' : '保护字段'"
            :title="field.protected ? '取消保护字段' : '保护字段'"
            @click="updateField(index, 'protected', !field.protected)"
          ><van-icon :name="field.protected ? 'closed-eye' : 'eye-o'" /></button>
          <button type="button" class="inline-icon-button is-danger" aria-label="删除字段" title="删除字段" @click="removeField(index)">
            <van-icon name="delete-o" />
          </button>
        </div>
        <div class="custom-field-value">
          <input
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
            class="inline-icon-button"
            :aria-label="revealed.has(field.id) ? '隐藏字段' : '显示字段'"
            :title="revealed.has(field.id) ? '隐藏字段' : '显示字段'"
            @click="toggleReveal(field.id)"
          ><van-icon :name="revealed.has(field.id) ? 'closed-eye' : 'eye-o'" /></button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
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
  display: grid;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}

.custom-field-head,
.custom-field-meta,
.custom-field-value {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}

.custom-field-head {
  justify-content: space-between;
}

.custom-field-head > div {
  display: grid;
  gap: 2px;
}

.custom-field-head strong {
  font-size: var(--app-font-base);
}

.custom-field-head span {
  color: var(--text-muted);
  font-size: var(--app-font-sm);
}

.custom-field-add {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--panel-border);
  border-radius: 7px;
  padding: 0 9px;
  color: var(--brand-strong);
  background: var(--panel-bg);
  cursor: pointer;
}

.custom-field-list {
  display: grid;
  gap: 8px;
}

.custom-field-item {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg-muted);
}

.custom-field-meta input {
  min-width: 0;
  flex: 1 1 auto;
}

.custom-field-meta select {
  width: 76px;
  flex: 0 0 76px;
}

.custom-field-item input,
.custom-field-item select {
  height: 34px;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  padding: 0 8px;
  color: var(--text-main);
  background: var(--panel-bg);
  font: inherit;
  font-size: var(--app-font-sm);
}

.custom-field-value input {
  min-width: 0;
  flex: 1 1 auto;
}

.inline-icon-button.active {
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand), transparent 88%);
}

.inline-icon-button.is-danger {
  color: var(--danger, #dc2626);
}

@media (max-width: 360px) {
  .custom-field-meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 76px 32px 32px;
  }
}
</style>
