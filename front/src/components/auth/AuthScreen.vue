<template>
  <section class="auth-screen">
    <div v-if="!stateLoading && !hasVault" class="brand-panel">
      <div class="brand-mark">PM</div>
      <h1>My Password</h1>
    </div>

    <div v-if="stateLoading" class="auth-card auth-status">
      <van-loading size="24" vertical>正在连接本地保险库</van-loading>
    </div>

    <div v-else-if="stateError" class="auth-card auth-status">
      <p>{{ stateError }}</p>
      <van-button block type="primary" plain @click="emit('retry')">重试</van-button>
    </div>

    <van-form v-else-if="hasVault" class="auth-card auth-card-compact" @submit="emit('unlock')">
      <van-field
        :model-value="password"
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="输入主密码，未设置可留空"
        @update:model-value="emit('update:password', String($event))"
      />
      <van-button block type="primary" native-type="submit" :loading="busy">解锁</van-button>
      <van-button
        v-if="deviceUnlockEnabled"
        block
        plain
        type="primary"
        icon="shield-o"
        native-type="button"
        :loading="busy"
        @click="emit('quick-unlock')"
      >设备快速解锁</van-button>
    </van-form>

    <van-form v-else class="auth-card" @submit="emit('create')">
      <van-field
        :model-value="newPassword"
        type="password"
        label="主密码"
        autocomplete="new-password"
        placeholder="可留空"
        @update:model-value="emit('update:newPassword', String($event))"
      />
      <van-field
        :model-value="confirmPassword"
        type="password"
        label="确认"
        autocomplete="new-password"
        placeholder="再次输入，可留空"
        @update:model-value="emit('update:confirmPassword', String($event))"
      />
      <van-cell center title="迁移旧数据" label="从旧 localStorage_data.json 导入">
        <template #right-icon>
          <van-switch
            :model-value="importLegacy"
            size="22"
            @update:model-value="emit('update:importLegacy', Boolean($event))"
          />
        </template>
      </van-cell>
      <van-button block type="primary" native-type="submit" :loading="busy">创建保险库</van-button>
    </van-form>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  stateLoading: boolean
  stateError: string
  hasVault: boolean
  busy: boolean
  password: string
  newPassword: string
  confirmPassword: string
  importLegacy: boolean
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
  'update:importLegacy': [value: boolean]
}>()
</script>
