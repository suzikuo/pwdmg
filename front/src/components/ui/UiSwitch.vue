<template>
  <button
    type="button"
    role="switch"
    class="ui-switch"
    :class="{
      'ui-switch--checked': modelValue,
      'ui-switch--loading': loading
    }"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="ariaLabel"
    :aria-busy="loading ? 'true' : undefined"
    :disabled="disabled || loading"
    @click="toggle"
  >
    <span class="ui-switch__thumb">
      <span v-if="loading" class="ui-switch__spinner" aria-hidden="true" />
    </span>
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
    loading?: boolean
    ariaLabel?: string
  }>(),
  {
    disabled: false,
    loading: false,
    ariaLabel: undefined
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function toggle(): void {
  if (props.disabled || props.loading) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<style scoped>
.ui-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background-color: var(--surface-container-high);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--duration-normal) var(--ease-standard),
    border-color var(--duration-normal) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.ui-switch:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-switch--checked {
  background-color: var(--brand);
  border-color: var(--brand);
}

.ui-switch:disabled {
  opacity: 0.54;
  cursor: not-allowed;
}

.ui-switch__thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background-color: var(--panel-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.25);
  transform: translateX(0);
  transition: transform var(--duration-normal) var(--ease-standard);
}

.ui-switch--checked .ui-switch__thumb {
  background-color: var(--on-brand);
  transform: translateX(18px);
}

.ui-switch__spinner {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--brand);
  border-right-color: transparent;
  animation: ui-switch-spin 0.72s linear infinite;
}

.ui-switch--checked .ui-switch__spinner {
  border-color: var(--brand);
  border-right-color: transparent;
}

@keyframes ui-switch-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
