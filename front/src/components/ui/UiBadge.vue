<template>
  <span class="ui-badge" :class="[`ui-badge--${tone}`, `ui-badge--${size}`]">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
    size?: 'sm' | 'md'
  }>(),
  {
    tone: 'neutral',
    size: 'md'
  }
)
</script>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: var(--radius-full);
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  vertical-align: middle;
}

.ui-badge--sm {
  padding: 2px 7px;
  font-size: var(--app-font-xs);
}

.ui-badge--md {
  padding: 3px 9px;
  font-size: var(--app-font-sm);
}

.ui-badge--neutral {
  background-color: var(--surface-container-high);
  color: var(--text-secondary);
}

.ui-badge--brand {
  background-color: var(--brand-soft);
  color: var(--brand);
}

.ui-badge--success {
  background-color: var(--success-soft);
  color: var(--success);
}

.ui-badge--warning {
  background-color: var(--warning-soft);
  color: var(--warning);
}

.ui-badge--danger {
  background-color: var(--danger-soft);
  color: var(--danger);
}
</style>
