<template>
  <Teleport to="body">
    <div class="ui-toast-stack" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="ui-toast-slide">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="ui-toast"
          :class="`ui-toast--${item.type}`"
          :role="item.type === 'error' ? 'alert' : 'status'"
          @click="dismissToast(item.id)"
        >
          <UiIcon :name="toastIconName(item.type)" :size="15" class="ui-toast__icon" />
          <span class="ui-toast__text">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>

    <Transition name="ui-confirm-fade">
      <div
        v-if="activeConfirm"
        class="ui-confirm-backdrop"
        @mousedown.self="cancelActiveConfirm()"
      >
        <div
          ref="confirmDialogEl"
          class="ui-confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="confirmTitleId"
          :aria-describedby="confirmMessageId"
          tabindex="-1"
        >
          <div class="ui-confirm-dialog__body">
            <h2 v-if="activeConfirm.title" :id="confirmTitleId" class="ui-confirm-dialog__title">
              {{ activeConfirm.title }}
            </h2>
            <p :id="confirmMessageId" class="ui-confirm-dialog__message">
              {{ activeConfirm.message }}
            </p>
          </div>
          <div class="ui-confirm-dialog__footer">
            <UiButton
              ref="cancelButtonRef"
              variant="secondary"
              size="sm"
              @click="cancelActiveConfirm()"
            >
              {{ activeConfirm.cancelButtonText }}
            </UiButton>
            <UiButton
              ref="confirmButtonRef"
              :variant="activeConfirm.danger ? 'danger' : 'primary'"
              size="sm"
              @click="resolveActiveConfirm()"
            >
              {{ activeConfirm.confirmButtonText }}
            </UiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import {
  activeConfirm,
  cancelActiveConfirm,
  dismissToast,
  resolveActiveConfirm,
  toasts,
  type ToastType
} from '../../services/uiFeedback'
import UiButton from './UiButton.vue'
import UiIcon from './UiIcon.vue'

const confirmTitleId = useId()
const confirmMessageId = useId()
const confirmDialogEl = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<{ $el?: HTMLElement } | null>(null)
const confirmButtonRef = ref<{ $el?: HTMLElement } | null>(null)

function toastIconName(type: ToastType): string {
  if (type === 'success') return 'check'
  if (type === 'error' || type === 'warning') return 'alert'
  return 'info'
}

function handleConfirmKeydown(event: KeyboardEvent): void {
  if (!activeConfirm.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelActiveConfirm()
    return
  }
  if (event.key === 'Enter') {
    const cancelEl = cancelButtonRef.value?.$el
    if (cancelEl && document.activeElement === cancelEl) {
      event.preventDefault()
      event.stopPropagation()
      cancelActiveConfirm()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resolveActiveConfirm()
  }
}

watch(
  activeConfirm,
  (confirmState) => {
    if (typeof window === 'undefined') return
    if (confirmState) {
      window.addEventListener('keydown', handleConfirmKeydown, true)
      void nextTick(() => {
        confirmDialogEl.value?.focus()
      })
    } else {
      window.removeEventListener('keydown', handleConfirmKeydown, true)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleConfirmKeydown, true)
  }
})
</script>

<style scoped>
/* Non-blocking Toast Stack */
.ui-toast-stack {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: min(92vw, 420px);
  pointer-events: none;
}

.ui-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 9px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-elevated);
  color: var(--text-main);
  font-size: var(--app-font-sm);
  line-height: 1.4;
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  cursor: pointer;
}

.ui-toast__icon {
  flex-shrink: 0;
}

.ui-toast--info .ui-toast__icon {
  color: var(--brand);
}

.ui-toast--success {
  border-color: color-mix(in srgb, var(--success) 32%, var(--border-soft));
}

.ui-toast--success .ui-toast__icon {
  color: var(--success);
}

.ui-toast--warning {
  border-color: color-mix(in srgb, var(--warning) 36%, var(--border-soft));
}

.ui-toast--warning .ui-toast__icon {
  color: var(--warning);
}

.ui-toast--error {
  border-color: color-mix(in srgb, var(--danger) 36%, var(--border-soft));
}

.ui-toast--error .ui-toast__icon {
  color: var(--danger);
}

.ui-toast__text {
  word-break: break-word;
}

.ui-toast-slide-enter-active,
.ui-toast-slide-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-standard),
    transform var(--duration-normal) var(--ease-standard);
}

.ui-toast-slide-enter-from,
.ui-toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

@media (max-width: 767px) {
  .ui-toast-stack {
    top: auto;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }

  .ui-toast-slide-enter-from,
  .ui-toast-slide-leave-to {
    transform: translateY(10px) scale(0.97);
  }
}

/* Accessible Confirm Dialog */
.ui-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(3px);
}

.ui-confirm-dialog {
  width: 100%;
  max-width: 400px;
  background-color: var(--panel-bg);
  color: var(--text-main);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  outline: none;
}

.ui-confirm-dialog__body {
  padding: 20px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ui-confirm-dialog__title {
  margin: 0;
  font-size: var(--app-font-lg);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-main);
}

.ui-confirm-dialog__message {
  margin: 0;
  font-size: var(--app-font-base);
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-line;
  word-break: break-word;
}

.ui-confirm-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.ui-confirm-fade-enter-active,
.ui-confirm-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.ui-confirm-fade-enter-active .ui-confirm-dialog,
.ui-confirm-fade-leave-active .ui-confirm-dialog {
  transition:
    transform var(--duration-normal) var(--ease-standard),
    opacity var(--duration-normal) var(--ease-standard);
}

.ui-confirm-fade-enter-from,
.ui-confirm-fade-leave-to {
  opacity: 0;
}

.ui-confirm-fade-enter-from .ui-confirm-dialog,
.ui-confirm-fade-leave-to .ui-confirm-dialog {
  opacity: 0;
  transform: scale(0.96);
}
</style>
