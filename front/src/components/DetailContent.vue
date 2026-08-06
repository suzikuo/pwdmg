<template>
  <div ref="detailRoot" class="detail-content" v-if="entry">
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

    <div v-if="visibleHistory.length" class="detail-view-tabs" role="tablist" aria-label="条目详情视图">
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'details'"
        :class="{ active: activeView === 'details' }"
        @click="selectView('details')"
      >详情</button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'history'"
        :class="{ active: activeView === 'history' }"
        @click="selectView('history')"
      >历史 <span>{{ visibleHistory.length }}</span></button>
    </div>

    <div class="detail-primary" :class="{ 'is-mobile-hidden': activeView === 'history' }">
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
    <div class="detail-note" v-if="entry.note">
      <div class="detail-note-head">
        <small>备注</small>
        <button class="inline-icon-button" type="button" aria-label="复制全部备注" title="复制全部备注" @click="$emit('copy', entry.note || '')">
          <van-icon name="description-o" />
        </button>
      </div>
      <textarea
        class="detail-note-text"
        :value="entry.note"
        rows="4"
        readonly
        spellcheck="false"
        aria-label="备注内容，可选择部分文字复制"
      ></textarea>
    </div>
    </div>
    <section v-if="visibleHistory.length" class="detail-history" :class="{ 'is-mobile-hidden': activeView === 'details' }">
      <div class="detail-history-head">
        <strong>历史</strong>
        <div class="detail-history-head-actions">
          <span>{{ visibleHistory.length }} 条</span>
          <button
            class="detail-history-clear"
            type="button"
            aria-label="清空历史记录"
            title="清空历史记录"
            @click="$emit('clear-history', entry.id)"
          >
            <van-icon name="delete-o" />
            <span>清空</span>
          </button>
        </div>
      </div>
      <div v-for="(item, index) in visibleHistory" :key="item.id" class="detail-history-row">
        <div class="detail-history-main">
          <div class="detail-history-item-head">
            <div class="detail-history-meta">
              <strong>{{ historyActionLabel(item.action) }}</strong>
              <span>{{ formatHistoryTime(item.at) }}<template v-if="item.note"> · {{ item.note }}</template></span>
            </div>
            <van-button
              v-if="item.snapshot"
              class="icon-action"
              size="mini"
              icon="replay"
              plain
              aria-label="恢复此历史版本"
              @click="$emit('restore-history', entry.id, item.id)"
            />
          </div>
          <div v-if="historyChanges(item, index).length" class="detail-history-changes">
            <div v-for="change in historyChanges(item, index)" :key="`${item.id}-${change.field}`" class="detail-history-change">
              <span class="detail-history-field">{{ entryHistoryFieldLabel(change.field) }}</span>
              <div class="detail-history-values">
                <span class="is-before">{{ change.before }}</span>
                <van-icon name="arrow" aria-hidden="true" />
                <span class="is-after">{{ change.after }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { VaultEntry, VaultEntryHistory, VaultEntryHistoryChange } from '../types'
import { buildEntryHistoryChanges, entryHistoryFieldLabel } from '../services/entryHistory'

const props = defineProps<{
  entry: VaultEntry | null
  showPassword: boolean
  passwordMask: string
  totpCode: string
  totpRemaining: number
  totpProgress: number
}>()

const visibleHistory = computed(() =>
  (props.entry?.history || []).filter((item) => item.action !== 'created').slice(0, 10)
)
const activeView = ref<'details' | 'history'>('details')
const detailRoot = ref<HTMLElement | null>(null)

watch(() => props.entry?.id, () => {
  activeView.value = 'details'
})

watch(() => visibleHistory.value.length, (length) => {
  if (length === 0) activeView.value = 'details'
})

defineEmits<{
  edit: [entry: VaultEntry]
  delete: [entryId: string]
  disable: [entryId: string]
  restore: [entryId: string]
  purge: [entryId: string]
  'restore-history': [entryId: string, historyId: string]
  'clear-history': [entryId: string]
  copy: [value: string]
  'toggle-password': []
  'refresh-totp': []
}>()

function historyActionLabel(action: string) {
  if (action === 'created') return '创建'
  if (action === 'disabled') return '归档'
  if (action === 'restored') return '恢复'
  if (action === 'trashed') return '移入回收站'
  return '修改'
}

function formatHistoryTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  return new Date(value * 1000).toLocaleString()
}

async function selectView(view: 'details' | 'history') {
  activeView.value = view
  await nextTick()
  detailRoot.value?.closest<HTMLElement>('.sheet-inner')?.scrollTo({ top: 0 })
}

function historyChanges(item: VaultEntryHistory, index: number): VaultEntryHistoryChange[] {
  if (item.changes?.length) return item.changes
  if (!item.snapshot || !props.entry) return []
  const after = index === 0 ? props.entry : visibleHistory.value[index - 1]?.snapshot
  return after ? buildEntryHistoryChanges(item.snapshot, after) : []
}
</script>
