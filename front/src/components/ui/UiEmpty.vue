<template>
  <div class="ui-empty">
    <div class="ui-empty__icon-wrap" aria-hidden="true">
      <svg
        class="ui-empty__svg"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <template v-if="icon === 'search'">
          <circle cx="11" cy="11" r="7.5" />
          <path d="m20.5 20.5-4.2-4.2" />
          <path d="M8.5 11h5" />
        </template>
        <template v-else-if="icon === 'folder'">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </template>
        <template v-else-if="icon === 'key'">
          <circle cx="7.5" cy="15.5" r="5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3L22 7l-3-3" />
        </template>
        <template v-else-if="icon === 'shield'">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </template>
        <template v-else-if="icon === 'trash'">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </template>
        <template v-else>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 9V7.5" />
          <path d="M12 16.5V15" />
          <path d="M9 12H7.5" />
          <path d="M16.5 12H15" />
        </template>
      </svg>
    </div>

    <h3 v-if="title" class="ui-empty__title">{{ title }}</h3>
    <p v-if="description" class="ui-empty__description">{{ description }}</p>

    <div v-if="$slots.default" class="ui-empty__actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: 'vault' | 'search' | 'folder' | 'key' | 'shield' | 'trash'
  }>(),
  {
    title: undefined,
    description: undefined,
    icon: 'vault'
  }
)
</script>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 36px 20px;
  gap: 8px;
}

.ui-empty__icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
  border-radius: var(--radius-full);
  background-color: var(--brand-soft);
  color: var(--brand);
}

.ui-empty__title {
  margin: 0;
  font-size: var(--app-font-md);
  font-weight: 600;
  color: var(--text-main);
}

.ui-empty__description {
  margin: 0;
  max-width: 320px;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.ui-empty__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
</style>
