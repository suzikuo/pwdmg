<template>
  <button
    :type="type"
    class="ui-button"
    :class="[
      `ui-button--${variant}`,
      `ui-button--${size}`,
      {
        'ui-button--block': block,
        'ui-button--icon-only': iconOnly,
        'ui-button--loading': loading
      }
    ]"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
    :title="title"
  >
    <span v-if="loading" class="ui-button__spinner" aria-hidden="true" />
    <span v-if="$slots.default" class="ui-button__content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
    size?: 'xs' | 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit' | 'reset'
    loading?: boolean
    disabled?: boolean
    block?: boolean
    iconOnly?: boolean
    title?: string
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    type: 'button',
    loading: false,
    disabled: false,
    block: false,
    iconOnly: false,
    title: undefined
  }
)
</script>

<style scoped>
.ui-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.ui-button:active:not(:disabled) {
  transform: translateY(0.5px);
}

.ui-button:disabled {
  opacity: 0.54;
  cursor: not-allowed;
}

.ui-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* Sizes */
.ui-button--xs {
  height: var(--control-height-xs);
  padding: 0 8px;
  font-size: var(--app-font-xs);
  gap: 4px;
}

.ui-button--sm {
  height: var(--control-height-sm);
  padding: 0 11px;
  font-size: var(--app-font-sm);
  gap: 5px;
}

.ui-button--md {
  height: var(--control-height-md);
  padding: 0 14px;
  font-size: var(--app-font-base);
}

.ui-button--lg {
  height: var(--control-height-lg);
  padding: 0 18px;
  font-size: var(--app-font-md);
  border-radius: var(--radius-md);
}

/* Icon-only square dimensions */
.ui-button--icon-only {
  padding: 0;
}

.ui-button--icon-only.ui-button--xs {
  width: var(--control-height-xs);
}

.ui-button--icon-only.ui-button--sm {
  width: var(--control-height-sm);
}

.ui-button--icon-only.ui-button--md {
  width: var(--control-height-md);
}

.ui-button--icon-only.ui-button--lg {
  width: var(--control-height-lg);
}

.ui-button--block {
  width: 100%;
  display: flex;
}

/* Variants */
.ui-button--primary {
  background-color: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
}

.ui-button--primary:hover:not(:disabled) {
  background-color: var(--brand-hover);
  border-color: var(--brand-hover);
}

.ui-button--secondary {
  background-color: var(--panel-bg);
  border-color: var(--border-strong);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.ui-button--secondary:hover:not(:disabled) {
  background-color: var(--surface-container-low);
  border-color: var(--brand);
}

.ui-button--subtle {
  background-color: var(--surface-container);
  border-color: transparent;
  color: var(--text-main);
}

.ui-button--subtle:hover:not(:disabled) {
  background-color: var(--surface-container-high);
}

.ui-button--ghost {
  background-color: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}

.ui-button--ghost:hover:not(:disabled) {
  background-color: var(--brand-soft);
  color: var(--text-main);
}

.ui-button--danger {
  background-color: var(--danger);
  border-color: var(--danger);
  color: var(--on-danger);
}

.ui-button--danger:hover:not(:disabled) {
  background-color: var(--danger-hover);
  border-color: var(--danger-hover);
}

.ui-button__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: inherit;
  min-width: 0;
}

.ui-button__spinner {
  width: 1em;
  height: 1em;
  border-radius: var(--radius-full);
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: ui-button-spin 0.72s linear infinite;
  flex-shrink: 0;
}

@keyframes ui-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
