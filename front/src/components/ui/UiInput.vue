<template>
  <div
    class="ui-field"
    :class="{
      'ui-field--error': Boolean(error),
      'ui-field--disabled': disabled,
      'ui-field--textarea': isTextarea
    }"
  >
    <label v-if="label" :for="inputId" class="ui-field__label">
      {{ label }}
    </label>

    <div class="ui-field__control-wrap">
      <span v-if="$slots.prefix" class="ui-field__affix ui-field__affix--prefix">
        <slot name="prefix" />
      </span>

      <textarea
        v-if="isTextarea"
        :id="inputId"
        ref="inputEl"
        class="ui-field__control ui-field__textarea"
        :class="{ 'ui-field__control--mono': monospace }"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :rows="rows"
        :autocomplete="autocomplete"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedById"
        @input="handleInput"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
        @keydown="handleKeydown"
      />

      <input
        v-else
        :id="inputId"
        ref="inputEl"
        class="ui-field__control"
        :class="{ 'ui-field__control--mono': monospace }"
        :type="resolvedType"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autocomplete="autocomplete"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedById"
        @input="handleInput"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
        @keydown="handleKeydown"
      />

      <span v-if="hasTrailing" class="ui-field__affix ui-field__affix--suffix">
        <button
          v-if="showClearButton"
          type="button"
          class="ui-field__action"
          aria-label="清空"
          title="清空"
          @mousedown.prevent
          @click="handleClear"
        >
          <UiIcon name="close" :size="14" />
        </button>

        <button
          v-if="type === 'password'"
          type="button"
          class="ui-field__action"
          :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
          :title="passwordVisible ? '隐藏密码' : '显示密码'"
          :disabled="disabled"
          @mousedown.prevent
          @click="passwordVisible = !passwordVisible"
        >
          <UiIcon :name="passwordVisible ? 'eye-off' : 'eye'" :size="15" />
        </button>

        <slot name="suffix" />
      </span>
    </div>

    <p v-if="error" :id="messageId" class="ui-field__message ui-field__message--error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="hint" :id="messageId" class="ui-field__message ui-field__message--hint">
      {{ hint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useSlots } from 'vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    type?: 'text' | 'password' | 'search' | 'email' | 'url' | 'tel' | 'textarea'
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    monospace?: boolean
    clearable?: boolean
    rows?: number
    autocomplete?: string
    error?: string
    hint?: string
    autofocus?: boolean
  }>(),
  {
    label: undefined,
    type: 'text',
    placeholder: '',
    disabled: false,
    readonly: false,
    monospace: false,
    clearable: false,
    rows: 3,
    autocomplete: undefined,
    error: undefined,
    hint: undefined,
    autofocus: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  clear: []
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
  enter: [event: KeyboardEvent]
}>()

const slots = useSlots()
const inputId = useId()
const messageId = useId()
const inputEl = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const passwordVisible = ref(false)

const isTextarea = computed(() => props.type === 'textarea')
const resolvedType = computed(() => {
  if (props.type === 'password') {
    return passwordVisible.value ? 'text' : 'password'
  }
  return props.type
})

const showClearButton = computed(
  () => props.clearable && !props.disabled && !props.readonly && props.modelValue.length > 0
)

const hasTrailing = computed(
  () => showClearButton.value || props.type === 'password' || Boolean(slots.suffix)
)

const describedById = computed(() => (props.error || props.hint ? messageId : undefined))

function handleInput(event: Event): void {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null
  emit('update:modelValue', target?.value ?? '')
}

function handleClear(): void {
  emit('update:modelValue', '')
  emit('clear')
  focus()
}

function handleKeydown(event: KeyboardEvent): void {
  emit('keydown', event)
  if (event.key === 'Enter' && !isTextarea.value) {
    emit('enter', event)
  }
}

function focus(): void {
  inputEl.value?.focus()
}

function select(): void {
  inputEl.value?.select()
}

onMounted(() => {
  if (props.autofocus) {
    void nextTick(() => focus())
  }
})

defineExpose({
  focus,
  select,
  inputEl
})
</script>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.ui-field__label {
  font-size: var(--app-font-sm);
  font-weight: 500;
  color: var(--text-secondary);
  line-height: 1.3;
}

.ui-field__control-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height-md);
  padding: 0 10px;
  background-color: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.ui-field--textarea .ui-field__control-wrap {
  align-items: flex-start;
  padding: 8px 10px;
}

.ui-field__control-wrap:hover:not(:has(:disabled)) {
  border-color: color-mix(in srgb, var(--brand) 52%, var(--border-strong));
}

.ui-field__control-wrap:focus-within {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.ui-field--error .ui-field__control-wrap {
  border-color: var(--danger);
}

.ui-field--error .ui-field__control-wrap:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 24%, transparent);
}

.ui-field--disabled .ui-field__control-wrap {
  opacity: 0.6;
  background-color: var(--surface-container-low);
  cursor: not-allowed;
}

.ui-field__control {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-main);
  font-size: var(--app-font-base);
  line-height: 1.45;
  padding: 6px 0;
  outline: none;
}

.ui-field__control::placeholder {
  color: var(--text-muted);
}

.ui-field__control::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.ui-field__control--mono {
  font-family: var(--font-mono);
  font-variant-ligatures: none;
  letter-spacing: 0.01em;
}

.ui-field__textarea {
  padding: 0;
  resize: vertical;
  min-height: 64px;
}

.ui-field__affix {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.ui-field__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.ui-field__action:hover:not(:disabled) {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.ui-field__action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-field__message {
  margin: 0;
  font-size: var(--app-font-xs);
  line-height: 1.4;
}

.ui-field__message--error {
  color: var(--danger);
}

.ui-field__message--hint {
  color: var(--text-muted);
}
</style>
