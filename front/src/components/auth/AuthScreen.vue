<template>
  <section class="auth-screen">
    <div class="auth-container">
      <header class="auth-brand">
        <div class="auth-brand-mark" aria-hidden="true">
          <UiIcon name="lock" :size="20" :stroke-width="1.75" />
        </div>
        <h1 class="auth-brand-title">我的密码库</h1>
        <p v-if="statusLine" class="auth-brand-subtitle">
          {{ statusLine }}
        </p>
      </header>

      <div v-if="stateLoading" class="auth-panel auth-status" role="status" aria-live="polite">
        <span class="auth-spinner" aria-hidden="true" />
        <p class="auth-status-text">正在连接本地保险库…</p>
      </div>

      <div v-else-if="stateError" class="auth-panel auth-status" role="alert">
        <div class="auth-error-icon" aria-hidden="true">
          <UiIcon name="alert" :size="20" />
        </div>
        <p class="auth-error-text">{{ stateError }}</p>
        <UiButton variant="primary" size="md" block @click="emit('retry')">
          <UiIcon name="refresh" :size="15" />
          <span>重试连接</span>
        </UiButton>
      </div>

      <form
        v-else-if="hasVault"
        class="auth-panel"
        autocomplete="off"
        @submit.prevent="emit('unlock')"
      >
        <UiInput
          :model-value="password"
          type="password"
          label="主密码"
          autocomplete="current-password"
          placeholder="输入主密码，未设置可留空"
          :disabled="busy"
          :autofocus="!deviceUnlockEnabled"
          @update:model-value="emit('update:password', $event)"
          @enter="emit('unlock')"
        />

        <div class="auth-actions">
          <UiButton
            variant="primary"
            size="md"
            type="submit"
            block
            :loading="busy"
          >
            <UiIcon name="unlock" :size="15" />
            <span>解锁</span>
          </UiButton>

          <button
            v-if="deviceUnlockEnabled"
            type="button"
            class="device-unlock-row"
            :disabled="busy"
            @click="emit('quick-unlock')"
          >
            <span class="device-unlock-row__left">
              <UiIcon name="shield" :size="15" />
              <span>设备快速解锁</span>
            </span>
            <UiIcon name="chevron-right" :size="14" class="device-unlock-row__arrow" />
          </button>
        </div>
      </form>

      <form
        v-else
        class="auth-panel"
        autocomplete="off"
        @submit.prevent="emit('create')"
      >
        <UiInput
          :model-value="newPassword"
          type="password"
          label="设置主密码"
          autocomplete="new-password"
          placeholder="输入主密码，单机环境可留空"
          :disabled="busy"
          autofocus
          @update:model-value="emit('update:newPassword', $event)"
        />

        <UiInput
          :model-value="confirmPassword"
          type="password"
          label="确认主密码"
          autocomplete="new-password"
          placeholder="再次输入主密码，可留空"
          :disabled="busy"
          @update:model-value="emit('update:confirmPassword', $event)"
          @enter="emit('create')"
        />

        <UiButton
          variant="primary"
          size="md"
          type="submit"
          block
          :loading="busy"
        >
          <span>创建保险库</span>
        </UiButton>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { UiButton, UiIcon, UiInput } from '../ui'

const props = defineProps<{
  stateLoading: boolean
  stateError: string
  hasVault: boolean
  busy: boolean
  password: string
  newPassword: string
  confirmPassword: string
  deviceUnlockEnabled: boolean
}>()

const emit = defineEmits<{
  retry: []
  unlock: []
  create: []
  'quick-unlock': []
  'update:password': [value: string]
  'update:newPassword': [value: string]
  'update:confirmPassword': [value: string]
}>()

const statusLine = computed(() => {
  if (props.stateLoading) return '初始化中'
  if (props.stateError) return '连接异常'
  if (!props.hasVault) return '初始化本地保险库'
  return ''
})
</script>

<style scoped>
.auth-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
  background-color: var(--app-bg);
  color: var(--text-main);
}

.auth-container {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

.auth-brand-mark {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background-color: var(--panel-bg);
  color: var(--text-main);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.auth-brand-title {
  margin: 2px 0 0;
  font-size: var(--app-font-xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-main);
  line-height: 1.25;
}

.auth-brand-subtitle {
  margin: 0;
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  line-height: 1.4;
}

.auth-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.auth-status {
  align-items: center;
  text-align: center;
  padding: 28px 20px;
}

.auth-spinner {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  border: 2px solid var(--border-strong);
  border-top-color: var(--text-main);
  animation: auth-spin 0.72s linear infinite;
}

.auth-status-text {
  margin: 0;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
}

.auth-error-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--danger-soft);
  color: var(--danger);
}

.auth-error-text {
  margin: 0;
  font-size: var(--app-font-sm);
  color: var(--danger);
  line-height: 1.5;
}

.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-unlock-row {
  width: 100%;
  height: var(--control-height-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.device-unlock-row:hover:not(:disabled) {
  background-color: var(--surface-container);
  border-color: var(--border-strong);
  color: var(--text-main);
}

.device-unlock-row:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.device-unlock-row:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.device-unlock-row__left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.device-unlock-row__arrow {
  color: var(--text-muted);
}

@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .auth-screen {
    align-items: flex-start;
    padding: max(48px, env(safe-area-inset-top, 24px)) 16px max(24px, env(safe-area-inset-bottom, 16px));
    background-color: var(--panel-bg);
  }

  .auth-panel {
    padding: 4px 0 0;
    background-color: transparent;
    border: 0;
    border-radius: 0;
  }
}
</style>
