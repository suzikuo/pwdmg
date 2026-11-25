<template>
  <UiModal
    :open="open"
    :title="title"
    size="sm"
    :close-on-backdrop="false"
    @close="emit('cancel')"
    @closed="emit('closed')"
  >
    <form
      id="cloud-password-prompt-form"
      class="cloud-prompt-form"
      autocomplete="off"
      @submit.prevent="emit('submit')"
    >
      <p class="cloud-prompt-note">{{ note }}</p>

      <UiInput
        ref="inputRef"
        :model-value="password"
        type="password"
        :label="label"
        autocomplete="current-password"
        :placeholder="placeholder"
        :disabled="busy"
        autofocus
        @update:model-value="emit('update:password', $event)"
        @enter="emit('submit')"
      />
    </form>

    <template #footer>
      <UiButton variant="secondary" :disabled="busy" @click="emit('cancel')">
        取消
      </UiButton>
      <UiButton
        variant="primary"
        type="submit"
        form="cloud-password-prompt-form"
        :loading="busy"
      >
        继续
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { UiButton, UiInput, UiModal } from '../ui'

const props = withDefaults(
  defineProps<{
    open: boolean
    password: string
    title?: string
    note?: string
    label?: string
    placeholder?: string
    busy?: boolean
  }>(),
  {
    title: '校验云端保险库',
    note: '本设备尚未绑定云端保险库的加密参数，或云端主密码刚刚修改。请输入云端保险库的主密码完成一次校验；成功后会自动绑定加密参数，云端未设置主密码可留空。',
    label: '云端密码',
    placeholder: '云端未设置可留空',
    busy: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:password': [value: string]
  submit: []
  cancel: []
  closed: []
}>()

const inputRef = ref<{ focus?: () => void } | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void nextTick(() => {
        inputRef.value?.focus?.()
      })
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.cloud-prompt-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cloud-prompt-note {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  line-height: 1.5;
}
</style>
