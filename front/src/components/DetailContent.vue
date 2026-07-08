<template>
  <div class="detail-content" v-if="entry">
    <div class="detail-header">
      <div>
        <span>{{ entry.domains?.[0] || '未设置域名' }}</span>
        <h2>{{ entry.title }}</h2>
      </div>
      <div class="detail-actions">
        <van-button v-if="entry.status !== 'trashed'" size="small" icon="edit" plain @click="$emit('edit', entry)">编辑</van-button>
        <van-button v-if="entry.status === 'active' || !entry.status" size="small" icon="closed-eye" plain type="danger" @click="$emit('disable', entry.id)">归档</van-button>
        <van-button v-if="entry.status === 'disabled' || entry.status === 'trashed'" size="small" icon="replay" plain type="primary" @click="$emit('restore', entry.id)">恢复</van-button>
        <button v-if="entry.status !== 'trashed'" class="detail-delete-button" type="button" aria-label="删除" @click="$emit('delete', entry.id)">
          <van-icon name="delete-o" />
        </button>
        <button v-else class="detail-delete-button" type="button" aria-label="彻底删除" @click="$emit('purge', entry.id)">
          <van-icon name="delete-o" />
        </button>
      </div>
    </div>
    <div v-if="entry.status === 'disabled' || entry.status === 'trashed'" class="detail-status-note">
      <strong>{{ entry.status === 'disabled' ? '已归档' : '回收站' }}</strong>
      <span>{{ entry.statusReason || (entry.status === 'disabled' ? '不会出现在正常列表和自动填充中，恢复后回到原位置' : '已从正常列表隐藏') }}</span>
    </div>

    <div class="detail-row" v-if="entry.domains?.length">
      <small>域名</small>
      <strong>{{ entry.domains.join(', ') }}</strong>
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制域名" @click="$emit('copy', entry.domains.join(', '))" />
    </div>
    <div class="detail-row">
      <small>账号</small>
      <strong>{{ entry.username || '未设置' }}</strong>
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制账号" @click="$emit('copy', entry.username || '')" />
    </div>
    <div class="detail-row" v-if="entry.email">
      <small>邮箱</small>
      <strong>{{ entry.email }}</strong>
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制邮箱" @click="$emit('copy', entry.email || '')" />
    </div>
    <div class="detail-row">
      <small>密码</small>
      <strong>{{ showPassword ? entry.password || '未设置' : passwordMask }}</strong>
      <van-button
        class="icon-action"
        size="mini"
        :icon="showPassword ? 'closed-eye' : 'eye-o'"
        plain
        :aria-label="showPassword ? '隐藏密码' : '显示密码'"
        @click="$emit('toggle-password')"
      />
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制密码" @click="$emit('copy', entry.password || '')" />
    </div>
    <div class="detail-row" v-if="entry.phone">
      <small>手机号</small>
      <strong>{{ entry.phone }}</strong>
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制手机号" @click="$emit('copy', entry.phone || '')" />
    </div>
    <div class="detail-row" v-if="entry.totpSecret">
      <small>TOTP</small>
      <strong class="totp-inline">{{ totpCode || '------' }}</strong>
      <button class="inline-icon-button" type="button" aria-label="刷新验证码" @click="$emit('refresh-totp')">
        <van-icon name="replay" />
      </button>
      <van-button class="icon-action" size="mini" icon="description-o" plain aria-label="复制验证码" @click="$emit('copy', totpCode)" />
    </div>
    <div class="totp-progress" v-if="entry.totpSecret">
      <div class="totp-progress-head">
        <span>自动刷新</span>
        <strong>{{ totpRemaining }} 秒</strong>
      </div>
      <div class="totp-progress-track">
        <span :style="{ width: `${totpProgress}%` }"></span>
      </div>
    </div>
    <div class="detail-note" v-if="entry.note">{{ entry.note }}</div>
  </div>
</template>

<script setup lang="ts">
import type { VaultEntry } from '../types'

defineProps<{
  entry: VaultEntry | null
  showPassword: boolean
  passwordMask: string
  totpCode: string
  totpRemaining: number
  totpProgress: number
}>()

defineEmits<{
  edit: [entry: VaultEntry]
  delete: [entryId: string]
  disable: [entryId: string]
  restore: [entryId: string]
  purge: [entryId: string]
  copy: [value: string]
  'toggle-password': []
  'refresh-totp': []
}>()
</script>
