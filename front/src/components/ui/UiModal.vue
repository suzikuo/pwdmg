<template>
  <Teleport to="body">
    <Transition name="ui-modal-fade" @after-leave="emit('closed')">
      <div
        v-if="open"
        class="ui-modal-backdrop"
        :class="{
          'ui-modal-backdrop--stacked': stacked,
          'ui-modal-backdrop--sheet-mobile': sheetOnMobile && !fullscreenOnMobile,
          'ui-modal-backdrop--fullscreen-mobile': fullscreenOnMobile
        }"
        :style="backdropStyle"
        @mousedown.self="handleBackdropClick"
      >
        <div
          ref="dialogEl"
          class="ui-modal"
          :class="[
            `ui-modal--${size}`,
            {
              'ui-modal--sheet-mobile': sheetOnMobile && !fullscreenOnMobile,
              'ui-modal--fullscreen-mobile': fullscreenOnMobile,
              'ui-modal--fixed-height': fixedHeight
            }
          ]"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? titleId : undefined"
          tabindex="-1"
        >
          <div v-if="sheetOnMobile && !fullscreenOnMobile" class="ui-modal__sheet-handle" aria-hidden="true" />

          <header v-if="title || subtitle || showClose || $slots['header-leading'] || $slots['header-extra']" class="ui-modal__header">
            <div class="ui-modal__header-left">
              <slot name="header-leading" />
              <div class="ui-modal__heading">
                <h2 v-if="title" :id="titleId" class="ui-modal__title">{{ title }}</h2>
                <p v-if="subtitle" class="ui-modal__subtitle">{{ subtitle }}</p>
              </div>
            </div>
            <div class="ui-modal__header-actions">
              <slot name="header-extra" />
              <button
                v-if="showClose"
                type="button"
                class="ui-modal__close"
                aria-label="关闭"
                title="关闭"
                @click="emit('close')"
              >
                <UiIcon name="close" :size="16" />
              </button>
            </div>
          </header>

          <div class="ui-modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="ui-modal__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import {
  getModalStackOffset,
  isTopModalInStack,
  pushModalToStack,
  removeModalFromStack
} from '../../services/modalStack'
import { activeConfirm } from '../../services/uiFeedback'
import UiIcon from './UiIcon.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    subtitle?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    closeOnBackdrop?: boolean
    showClose?: boolean
    sheetOnMobile?: boolean
    fullscreenOnMobile?: boolean
    fixedHeight?: boolean
    stacked?: boolean
  }>(),
  {
    title: undefined,
    subtitle: undefined,
    size: 'md',
    closeOnBackdrop: true,
    showClose: true,
    sheetOnMobile: true,
    fullscreenOnMobile: false,
    fixedHeight: false,
    stacked: false
  }
)

const emit = defineEmits<{
  close: []
  closed: []
}>()

const titleId = useId()
const modalStackId = useId()
const dialogEl = ref<HTMLElement | null>(null)
const backdropStyle = computed(() => {
  const offset = getModalStackOffset(modalStackId, props.stacked)
  return offset > 0 ? { zIndex: `calc(var(--z-modal) + ${offset})` } : undefined
})

function handleBackdropClick(): void {
  if (!props.closeOnBackdrop) return
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape' || event.defaultPrevented) return
  if (activeConfirm.value || !isTopModalInStack(modalStackId)) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pushModalToStack(modalStackId)
    } else {
      removeModalFromStack(modalStackId)
    }
    if (typeof window === 'undefined') return
    if (isOpen) {
      window.addEventListener('keydown', handleKeydown)
    } else {
      window.removeEventListener('keydown', handleKeydown)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  removeModalFromStack(modalStackId)
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown)
  }
})
</script>

<style scoped>
.ui-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(3px);
}

.ui-modal-backdrop--stacked {
  z-index: calc(var(--z-modal) + 1);
}

.ui-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(88vh, 840px);
  max-height: min(88dvh, 840px);
  background-color: var(--panel-bg);
  color: var(--text-main);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  outline: none;
}

.ui-modal--sm {
  max-width: 400px;
}

.ui-modal--md {
  max-width: 540px;
}

.ui-modal--lg {
  max-width: 720px;
}

.ui-modal--xl {
  max-width: 920px;
}

.ui-modal--fixed-height {
  height: min(680px, calc(100vh - 48px));
  height: min(680px, calc(100dvh - 48px));
}

.ui-modal--fixed-height .ui-modal__body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ui-modal__sheet-handle {
  display: none;
}

.ui-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.ui-modal__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.ui-modal__heading {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ui-modal__title {
  margin: 0;
  font-size: var(--app-font-lg);
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-main);
}

.ui-modal__subtitle {
  margin: 0;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
  line-height: 1.4;
}

.ui-modal__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ui-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.ui-modal__close:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.ui-modal__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 20px;
}

.ui-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
  flex-shrink: 0;
}

/* Transitions */
.ui-modal-fade-enter-active,
.ui-modal-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
}

.ui-modal-fade-enter-active .ui-modal,
.ui-modal-fade-leave-active .ui-modal {
  transition:
    transform var(--duration-normal) var(--ease-standard),
    opacity var(--duration-normal) var(--ease-standard);
}

.ui-modal-fade-enter-from,
.ui-modal-fade-leave-to {
  opacity: 0;
}

.ui-modal-fade-enter-from .ui-modal,
.ui-modal-fade-leave-to .ui-modal {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

/* Mobile bottom sheet (< 768px) */
@media (max-width: 767px) {
  .ui-modal-backdrop--sheet-mobile {
    align-items: flex-end;
    padding: 0;
  }

  .ui-modal--sheet-mobile {
    max-width: 100%;
    max-height: min(92vh, calc(100vh - 24px));
    max-height: min(92dvh, calc(100dvh - 24px));
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-top-left-radius: var(--radius-xl);
    border-top-right-radius: var(--radius-xl);
    border-bottom: 0;
    border-left: 0;
    border-right: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .ui-modal--sheet-mobile .ui-modal__sheet-handle {
    display: block;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: var(--radius-full);
    background-color: var(--border-strong);
    flex-shrink: 0;
  }

  .ui-modal--sheet-mobile .ui-modal__header {
    padding: 12px 16px;
  }

  .ui-modal--sheet-mobile .ui-modal__body {
    padding: 14px 16px;
  }

  .ui-modal--sheet-mobile .ui-modal__footer {
    padding: 10px 16px;
  }

  .ui-modal-fade-enter-from .ui-modal--sheet-mobile,
  .ui-modal-fade-leave-to .ui-modal--sheet-mobile {
    opacity: 1;
    transform: translateY(100%);
  }

  .ui-modal-backdrop--fullscreen-mobile {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
  }

  .ui-modal--fullscreen-mobile {
    width: 100%;
    max-width: 100%;
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
    border: 0;
    box-shadow: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .ui-modal--fullscreen-mobile .ui-modal__header {
    padding: 12px 14px;
  }

  .ui-modal--fullscreen-mobile .ui-modal__body {
    padding: 14px;
  }

  .ui-modal--fullscreen-mobile .ui-modal__footer {
    padding: 10px 14px;
  }

  .ui-modal-fade-enter-from .ui-modal--fullscreen-mobile,
  .ui-modal-fade-leave-to .ui-modal--fullscreen-mobile {
    opacity: 0;
    transform: translateX(18px);
  }
}
</style>
