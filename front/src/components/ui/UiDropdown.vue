<template>
  <div ref="rootEl" class="ui-dropdown">
    <div class="ui-dropdown__trigger" @click="toggleOpen">
      <slot name="trigger" :open="open" />
    </div>

    <Transition name="ui-dropdown-pop">
      <div
        v-if="open"
        ref="menuEl"
        class="ui-dropdown__menu"
        :class="`ui-dropdown__menu--${align}`"
        role="menu"
      >
        <slot :close="closeMenu">
          <template v-for="item in items" :key="item.key">
            <div v-if="item.divider" class="ui-dropdown__divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              class="ui-dropdown__item"
              :class="{
                'ui-dropdown__item--danger': item.danger,
                'ui-dropdown__item--disabled': item.disabled
              }"
              :disabled="item.disabled"
              @click="handleSelect(item)"
            >
              <UiIcon v-if="item.icon" :name="item.icon" :size="15" class="ui-dropdown__item-icon" />
              <span class="ui-dropdown__item-label">{{ item.label }}</span>
            </button>
          </template>
        </slot>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'

export type UiDropdownItem = {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  icon?: string
  divider?: boolean
}

const props = withDefaults(
  defineProps<{
    open: boolean
    align?: 'left' | 'right'
    items?: UiDropdownItem[]
  }>(),
  {
    align: 'right',
    items: () => []
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [item: UiDropdownItem]
}>()

const rootEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

function closeMenu(): void {
  if (props.open) {
    emit('update:open', false)
  }
}

function toggleOpen(): void {
  emit('update:open', !props.open)
}

function handleSelect(item: UiDropdownItem): void {
  if (item.disabled) return
  emit('select', item)
  emit('update:open', false)
}

function handleOutsidePointerDown(event: PointerEvent): void {
  if (!props.open) return
  const target = event.target as Node | null
  if (target && rootEl.value?.contains(target)) return
  closeMenu()
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const buttons = Array.from(
      menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex =
      event.key === 'ArrowDown'
        ? (currentIndex + 1) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof window === 'undefined') return
    if (isOpen) {
      window.addEventListener('pointerdown', handleOutsidePointerDown, true)
      window.addEventListener('keydown', handleKeydown)
    } else {
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true)
      window.removeEventListener('keydown', handleKeydown)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', handleOutsidePointerDown, true)
    window.removeEventListener('keydown', handleKeydown)
  }
})
</script>

<style scoped>
.ui-dropdown {
  position: relative;
  display: inline-flex;
}

.ui-dropdown__trigger {
  display: inline-flex;
  align-items: center;
}

.ui-dropdown__menu {
  position: absolute;
  top: calc(100% + 6px);
  z-index: var(--z-dropdown);
  min-width: 176px;
  max-width: 280px;
  padding: 5px;
  background-color: var(--surface-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ui-dropdown__menu--left {
  left: 0;
  transform-origin: top left;
}

.ui-dropdown__menu--right {
  right: 0;
  transform-origin: top right;
}

.ui-dropdown__divider {
  height: 1px;
  margin: 4px 6px;
  background-color: var(--border-soft);
}

.ui-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-main);
  font-size: var(--app-font-sm);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.ui-dropdown__item:hover:not(:disabled),
.ui-dropdown__item:focus-visible:not(:disabled) {
  background-color: var(--brand-soft);
  color: var(--text-main);
  outline: none;
}

.ui-dropdown__item--danger {
  color: var(--danger);
}

.ui-dropdown__item--danger:hover:not(:disabled),
.ui-dropdown__item--danger:focus-visible:not(:disabled) {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.ui-dropdown__item--disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.ui-dropdown__item-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.ui-dropdown__item--danger .ui-dropdown__item-icon {
  color: var(--danger);
}

.ui-dropdown__item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-dropdown-pop-enter-active,
.ui-dropdown-pop-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.ui-dropdown-pop-enter-from,
.ui-dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
