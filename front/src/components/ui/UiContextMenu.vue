<template>
  <Teleport to="body">
    <Transition name="ui-context-menu-fade">
      <div
        v-if="open && items.length > 0"
        ref="menuRef"
        class="ui-context-menu"
        :style="menuStyle"
        role="menu"
        :aria-label="header || '上下文菜单'"
        @contextmenu.prevent.stop
        @pointerdown.stop
        @keydown="handleMenuKeydown"
      >
        <div v-if="header" class="ui-context-menu__header">{{ header }}</div>
        <template v-for="(item, index) in items" :key="item.key">
          <div v-if="item.divider && index > 0" class="ui-context-menu__divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="ui-context-menu__item"
            :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
            :disabled="item.disabled"
            @click="handleSelect(item)"
          >
            <span class="ui-context-menu__icon" aria-hidden="true">
              <UiIcon v-if="item.icon" :name="item.icon" :size="14" />
            </span>
            <span class="ui-context-menu__label">{{ item.label }}</span>
            <kbd v-if="item.shortcut" class="ui-context-menu__shortcut">{{ item.shortcut }}</kbd>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import UiIcon, { type UiIconName } from './UiIcon.vue'

export interface UiContextMenuItem {
  key: string
  label: string
  icon?: UiIconName
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  divider?: boolean
}

const props = withDefaults(defineProps<{
  open: boolean
  x: number
  y: number
  items: UiContextMenuItem[]
  header?: string
}>(), {
  header: ''
})

const emit = defineEmits<{
  close: []
  select: [item: UiContextMenuItem]
}>()

const VIEWPORT_MARGIN = 8
const menuRef = ref<HTMLElement | null>(null)
const clampedX = ref(0)
const clampedY = ref(0)

const menuStyle = computed(() => ({
  left: `${clampedX.value}px`,
  top: `${clampedY.value}px`
}))

function updatePosition(): void {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const rect = menuRef.value?.getBoundingClientRect()
  const width = rect?.width || 200
  const height = rect?.height || Math.min(360, props.items.length * 32 + 24)

  const maxLeft = Math.max(VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN)
  const maxTop = Math.max(VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN)

  clampedX.value = Math.round(Math.max(VIEWPORT_MARGIN, Math.min(props.x, maxLeft)))
  clampedY.value = Math.round(Math.max(VIEWPORT_MARGIN, Math.min(props.y, maxTop)))
}

watch(
  () => [props.open, props.x, props.y, props.items.length] as const,
  async ([open]) => {
    if (!open) return
    clampedX.value = Math.max(VIEWPORT_MARGIN, props.x)
    clampedY.value = Math.max(VIEWPORT_MARGIN, props.y)
    await nextTick()
    updatePosition()
  },
  { immediate: true }
)

function handleSelect(item: UiContextMenuItem): void {
  if (item.disabled) return
  emit('select', item)
  emit('close')
}

function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const buttons = Array.from(
      menuRef.value?.querySelectorAll<HTMLButtonElement>('.ui-context-menu__item:not(:disabled)') || []
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % buttons.length
      : (currentIndex - 1 + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
  }
}
</script>

<style scoped>
.ui-context-menu {
  position: fixed;
  z-index: var(--z-confirm);
  min-width: 196px;
  max-width: 280px;
  padding: 5px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-elevated);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 1px;
  user-select: none;
}

.ui-context-menu__header {
  padding: 4px 9px 5px;
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-context-menu__divider {
  height: 1px;
  margin: 4px 6px;
  background-color: var(--border-soft);
}

.ui-context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 5px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-main);
  font-size: var(--app-font-sm);
  text-align: left;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.ui-context-menu__item:hover:not(:disabled),
.ui-context-menu__item:focus-visible:not(:disabled) {
  background-color: var(--surface-container-high);
}

.ui-context-menu__item.is-danger {
  color: var(--danger);
}

.ui-context-menu__item.is-danger:hover:not(:disabled),
.ui-context-menu__item.is-danger:focus-visible:not(:disabled) {
  background-color: var(--danger-soft);
}

.ui-context-menu__item.is-disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ui-context-menu__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.ui-context-menu__item.is-danger .ui-context-menu__icon {
  color: var(--danger);
}

.ui-context-menu__label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-context-menu__shortcut {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.4;
}

.ui-context-menu-fade-enter-active,
.ui-context-menu-fade-leave-active {
  transition:
    opacity 100ms var(--ease-standard),
    transform 100ms var(--ease-standard);
}

.ui-context-menu-fade-enter-from,
.ui-context-menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
