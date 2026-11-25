<template>
  <article v-if="entry" ref="detailRoot" class="detail-content">
    <div
      v-if="entry.status === 'disabled' || entry.status === 'trashed'"
      class="detail-status-banner"
      :class="entry.status === 'trashed' ? 'is-trashed' : 'is-archived'"
      role="status"
    >
      <div class="detail-status-banner__copy">
        <div class="detail-status-banner__title">
          <UiIcon :name="entry.status === 'trashed' ? 'trash' : 'archive'" :size="15" />
          <strong>{{ entry.status === 'disabled' ? '已归档条目（只读预览）' : '回收站条目（只读预览）' }}</strong>
        </div>
        <p class="detail-status-banner__desc">
          {{ entry.statusReason || (entry.status === 'disabled' ? '不会出现在正常列表和自动填充中，恢复后回到原位置。' : '已从正常列表隐藏，可随时恢复或彻底删除。') }}
        </p>
      </div>
      <div class="detail-status-banner__actions">
        <UiButton variant="primary" size="sm" @click="$emit('restore', entry.id)">
          <UiIcon name="restore" :size="14" />
          <span>恢复条目</span>
        </UiButton>
        <UiButton
          v-if="entry.status === 'trashed'"
          variant="danger"
          size="sm"
          @click="$emit('purge', entry.id)"
        >
          <UiIcon name="trash" :size="14" />
          <span>彻底删除</span>
        </UiButton>
        <UiButton
          v-else
          variant="secondary"
          size="sm"
          @click="$emit('delete', entry.id)"
        >
          <UiIcon name="trash" :size="14" />
          <span>移入回收站</span>
        </UiButton>
      </div>
    </div>

    <header class="detail-header">
      <div class="detail-heading">
        <span class="detail-kind-avatar" :class="`is-${entry.kind}`" aria-hidden="true">
          <UiIcon :name="resolveKindIcon(entry.kind)" :size="20" />
        </span>
        <div class="detail-heading-text">
          <div v-if="entry.status === 'disabled' || entry.status === 'trashed'" class="detail-heading-meta">
            <UiBadge v-if="entry.status === 'disabled'" tone="warning" size="sm">已归档</UiBadge>
            <UiBadge v-if="entry.status === 'trashed'" tone="danger" size="sm">回收站</UiBadge>
          </div>
          <h2 class="detail-title">{{ entry.title || '未命名条目' }}</h2>
        </div>
      </div>

      <div class="detail-actions">
        <UiButton
          v-if="entry.status !== 'trashed'"
          variant="primary"
          size="sm"
          @click="$emit('edit', entry)"
        >
          <UiIcon name="edit" :size="14" />
          <span>编辑</span>
        </UiButton>

        <UiButton
          v-if="entry.domains?.[0]"
          variant="secondary"
          size="sm"
          @click="$emit('open-website', entry.domains[0])"
        >
          <UiIcon name="external-link" :size="14" />
          <span>打开网站</span>
        </UiButton>

        <UiDropdown
          :open="detailMenuOpen"
          align="right"
          :items="detailDropdownItems"
          @update:open="detailMenuOpen = $event"
          @select="selectDetailAction"
        >
          <template #trigger>
            <UiButton
              variant="ghost"
              size="sm"
              icon-only
              aria-label="更多条目操作"
              title="更多操作"
            >
              <UiIcon name="more" :size="16" />
            </UiButton>
          </template>
        </UiDropdown>
      </div>
    </header>

    <div class="detail-sections">
      <section v-if="entry.kind === 'login'" class="detail-card" aria-label="登录凭据">
        <div
          v-if="entry.username"
          class="detail-field is-copyable"
          title="点击复制账号"
          @click="$emit('copy', entry.username)"
        >
          <div class="detail-field__body">
            <span class="detail-field__label">账号</span>
            <span class="detail-field__value">{{ entry.username }}</span>
          </div>
          <div class="detail-field__actions">
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              aria-label="复制账号"
              title="复制账号"
              @click.stop="$emit('copy', entry.username)"
            >
              <UiIcon name="copy" :size="14" />
            </UiButton>
          </div>
        </div>

        <div
          v-if="entry.email"
          class="detail-field is-copyable"
          title="点击复制邮箱"
          @click="$emit('copy', entry.email)"
        >
          <div class="detail-field__body">
            <span class="detail-field__label">邮箱</span>
            <span class="detail-field__value">{{ entry.email }}</span>
          </div>
          <div class="detail-field__actions">
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              aria-label="复制邮箱"
              title="复制邮箱"
              @click.stop="$emit('copy', entry.email)"
            >
              <UiIcon name="copy" :size="14" />
            </UiButton>
          </div>
        </div>

        <div
          v-if="entry.phone"
          class="detail-field is-copyable"
          title="点击复制手机号"
          @click="$emit('copy', entry.phone)"
        >
          <div class="detail-field__body">
            <span class="detail-field__label">手机号</span>
            <span class="detail-field__value">{{ entry.phone }}</span>
          </div>
          <div class="detail-field__actions">
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              aria-label="复制手机号"
              title="复制手机号"
              @click.stop="$emit('copy', entry.phone)"
            >
              <UiIcon name="copy" :size="14" />
            </UiButton>
          </div>
        </div>

        <div
          class="detail-field detail-field--password"
          :class="{ 'is-copyable': Boolean(entry.password) }"
          :title="entry.password ? '点击复制密码' : undefined"
          @click="entry.password && $emit('copy', entry.password)"
        >
          <div class="detail-field__body">
            <span class="detail-field__label">密码</span>
            <div class="password-display" :class="{ 'is-empty': !entry.password }">
              <code class="password-display__text">
                {{ entry.password ? (showPassword ? entry.password : passwordMask) : '未设置' }}
              </code>
            </div>
          </div>
          <div v-if="entry.password" class="detail-field__actions">
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click.stop="$emit('toggle-password')"
            >
              <UiIcon :name="showPassword ? 'eye-off' : 'eye'" :size="15" />
            </UiButton>
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              aria-label="复制密码"
              title="复制密码"
              @click.stop="$emit('copy', entry.password)"
            >
              <UiIcon name="copy" :size="14" />
            </UiButton>
          </div>
        </div>

        <div
          v-if="entry.totpSecret"
          class="detail-totp-card"
          :class="{ 'is-copyable': Boolean(totpCode) }"
          :title="totpCode ? '点击复制验证码' : undefined"
          @click="totpCode && $emit('copy', totpCode)"
        >
          <div class="detail-totp-top">
            <div class="detail-totp-main">
              <span class="detail-field__label">动态验证码 (TOTP)</span>
              <button
                type="button"
                class="totp-code-btn"
                :disabled="!totpCode"
                title="点击复制验证码"
                @click.stop="totpCode && $emit('copy', totpCode)"
              >
                <code class="totp-code">{{ formattedTotpCode }}</code>
              </button>
            </div>

            <div class="detail-totp-controls">
              <UiBadge :tone="totpRemaining <= 5 ? 'danger' : 'brand'" size="sm">
                {{ totpRemaining }}s
              </UiBadge>
              <UiButton
                variant="ghost"
                size="xs"
                icon-only
                aria-label="刷新验证码"
                title="刷新验证码"
                @click.stop="$emit('refresh-totp')"
              >
                <UiIcon name="refresh" :size="14" />
              </UiButton>
              <UiButton
                v-if="totpCode"
                variant="subtle"
                size="xs"
                aria-label="复制验证码"
                title="复制验证码"
                @click.stop="$emit('copy', totpCode)"
              >
                <UiIcon name="copy" :size="13" />
                <span>复制</span>
              </UiButton>
            </div>
          </div>
          <div class="totp-progress-track" aria-hidden="true">
            <span
              class="totp-progress-fill"
              :class="{ 'is-expiring': totpRemaining <= 5 }"
              :style="{ width: `${Math.max(0, Math.min(100, totpProgress))}%` }"
            />
          </div>
        </div>
      </section>

      <section v-if="entry.kind === 'login' && (entry.domains?.length || entry.autofillMatchMode)" class="detail-card" aria-label="网站与填充规则">
        <div v-if="entry.domains?.length" class="detail-field">
          <div class="detail-field__body">
            <span class="detail-field__label">{{ entry.autofillMatchMode === 'url-prefix' ? 'URL 前缀' : '关联域名' }}</span>
            <div class="detail-domain-list">
              <div v-for="domain in entry.domains" :key="domain" class="detail-domain-chip">
                <span class="detail-domain-text">{{ domain }}</span>
                <button
                  type="button"
                  class="domain-chip-btn"
                  title="打开网站"
                  :aria-label="`打开 ${domain}`"
                  @click="$emit('open-website', domain)"
                >
                  <UiIcon name="external-link" :size="12" />
                </button>
                <button
                  type="button"
                  class="domain-chip-btn"
                  title="复制域名"
                  :aria-label="`复制 ${domain}`"
                  @click="$emit('copy', domain)"
                >
                  <UiIcon name="copy" :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-field">
          <div class="detail-field__body">
            <span class="detail-field__label">自动填充匹配规则</span>
            <span class="detail-field__value">{{ autofillMatchModeLabel(entry.autofillMatchMode) }}</span>
          </div>
        </div>
      </section>

      <section v-if="(entry.customFields || []).length" class="detail-card" aria-label="自定义字段">
        <div class="detail-card__head">
          <span class="detail-card__title">自定义字段</span>
          <UiBadge tone="neutral" size="sm">{{ entry.customFields?.length }}</UiBadge>
        </div>
        <div v-for="field in entry.customFields || []" :key="field.id" class="detail-field">
          <div class="detail-field__body">
            <span class="detail-field__label">{{ field.label || '未命名字段' }}</span>
            <span
              class="detail-field__value"
              :class="{
                'is-empty': !field.value,
                'is-mono': field.protected || field.type === 'secret'
              }"
            >
              {{ customFieldValue(field) }}
            </span>
          </div>
          <div v-if="field.value" class="detail-field__actions">
            <UiButton
              v-if="field.protected || field.type === 'secret'"
              variant="ghost"
              size="xs"
              icon-only
              :aria-label="revealedCustomFields.has(field.id) ? '隐藏字段' : '显示字段'"
              :title="revealedCustomFields.has(field.id) ? '隐藏字段' : '显示字段'"
              @click="toggleCustomField(field.id)"
            >
              <UiIcon :name="revealedCustomFields.has(field.id) ? 'eye-off' : 'eye'" :size="14" />
            </UiButton>
            <UiButton
              variant="ghost"
              size="xs"
              icon-only
              aria-label="复制字段"
              title="复制字段"
              @click="$emit('copy', field.value)"
            >
              <UiIcon name="copy" :size="14" />
            </UiButton>
          </div>
        </div>
      </section>

      <section v-if="entry.kind === 'login' && linkedPasskeys.length" class="detail-card detail-passkeys" aria-label="已关联通行密钥">
        <div class="detail-card__head">
          <div class="detail-card__head-left">
            <UiIcon name="key" :size="15" />
            <span class="detail-card__title">通行密钥</span>
            <UiBadge tone="brand" size="sm">{{ linkedPasskeys.length }} 个已关联</UiBadge>
          </div>
        </div>
        <div class="detail-item-list">
          <div v-for="passkey in linkedPasskeys" :key="passkey.id" class="detail-subcard">
            <span class="detail-subcard__icon is-brand">
              <UiIcon name="shield" :size="15" />
            </span>
            <div class="detail-subcard__copy">
              <strong>{{ passkey.displayLabel }}</strong>
              <small>{{ passkey.accountLabel }} · {{ passkey.backupState ? '已备份' : passkey.backupEligible ? '可备份' : '仅本机' }}</small>
            </div>
            <div class="detail-subcard__actions">
              <UiButton
                variant="ghost"
                size="xs"
                icon-only
                aria-label="管理通行密钥"
                title="管理通行密钥"
                @click="$emit('open-passkey', passkey.id)"
              >
                <UiIcon name="settings" :size="14" />
              </UiButton>
              <UiButton
                variant="ghost"
                size="xs"
                icon-only
                aria-label="解除通行密钥关联"
                title="解除关联"
                @click="$emit('unlink-passkey', passkey.id)"
              >
                <UiIcon name="close" :size="14" />
              </UiButton>
            </div>
          </div>
        </div>
      </section>

      <input
        v-if="entry.kind !== 'folder'"
        ref="attachmentInput"
        class="sr-only"
        type="file"
        tabindex="-1"
        @change="selectAttachmentFile"
      />

      <section
        v-if="entry.kind !== 'folder' && (entry.attachments?.length || 0) > 0"
        class="detail-attachments"
        aria-label="附件"
      >
        <div class="detail-card__head">
          <div class="detail-card__head-left">
            <UiIcon name="paperclip" :size="15" />
            <span class="detail-card__title">附件</span>
            <UiBadge tone="neutral" size="sm">{{ entry.attachments?.length || 0 }}</UiBadge>
          </div>
          <UiButton
            v-if="attachmentActionsSupported && entry.status !== 'trashed'"
            variant="subtle"
            size="xs"
            :disabled="attachmentBusy"
            aria-label="添加附件"
            title="添加附件"
            @click="attachmentInput?.click()"
          >
            <UiIcon name="plus" :size="13" />
            <span>添加附件</span>
          </UiButton>
        </div>

        <div class="detail-item-list">
          <div v-for="attachment in entry.attachments" :key="attachment.id" class="detail-subcard">
            <span class="detail-subcard__icon">
              <UiIcon name="paperclip" :size="15" />
            </span>
            <div class="detail-subcard__copy">
              <strong :title="attachment.name">{{ attachment.name }}</strong>
              <small>{{ formatAttachmentSize(attachment.size) }} · {{ attachment.mimeType }}</small>
            </div>
            <div class="detail-subcard__actions">
              <UiButton
                v-if="attachmentActionsSupported"
                variant="ghost"
                size="xs"
                icon-only
                :disabled="attachmentBusy"
                aria-label="保存附件"
                title="保存附件"
                @click="$emit('save-attachment', entry.id, attachment.id)"
              >
                <UiIcon name="download" :size="14" />
              </UiButton>
              <UiButton
                v-if="attachmentActionsSupported && entry.status !== 'trashed'"
                variant="ghost"
                size="xs"
                icon-only
                :disabled="attachmentBusy"
                aria-label="删除附件"
                title="删除附件"
                @click="$emit('remove-attachment', entry.id, attachment.id)"
              >
                <UiIcon name="trash" :size="14" />
              </UiButton>
            </div>
          </div>
        </div>
      </section>

      <section v-if="entry.note" class="detail-card detail-note" aria-label="备注">
        <div class="detail-card__head">
          <span class="detail-card__title">备注</span>
          <UiButton
            variant="ghost"
            size="xs"
            aria-label="复制全部备注"
            title="复制全部备注"
            @click="$emit('copy', entry.note || '')"
          >
            <UiIcon name="copy" :size="13" />
            <span>复制</span>
          </UiButton>
        </div>
        <pre class="detail-note-body">{{ entry.note }}</pre>
      </section>
    </div>

    <UiModal
      :open="historyModalOpen"
      title="修改历史"
      :subtitle="`共 ${visibleHistory.length} 条记录`"
      size="md"
      @close="historyModalOpen = false"
    >
      <template #header-extra>
        <UiButton
          v-if="visibleHistory.length"
          variant="ghost"
          size="xs"
          aria-label="清空历史记录"
          title="清空历史记录"
          @click="$emit('clear-history', entry.id)"
        >
          <UiIcon name="trash" :size="13" />
          <span>清空</span>
        </UiButton>
      </template>

      <div v-if="visibleHistory.length" class="history-list">
        <div v-for="(item, index) in visibleHistory" :key="item.id" class="history-item">
          <div class="history-item__head">
            <div class="history-item__meta">
              <UiBadge tone="neutral" size="sm">{{ historyActionLabel(item.action) }}</UiBadge>
              <span class="history-item__time">{{ formatHistoryTime(item.at) }}</span>
              <span v-if="item.note" class="history-item__note">· {{ item.note }}</span>
            </div>
            <UiButton
              v-if="item.snapshot"
              variant="subtle"
              size="xs"
              aria-label="恢复此历史版本"
              title="恢复此历史版本"
              @click="$emit('restore-history', entry.id, item.id)"
            >
              <UiIcon name="restore" :size="13" />
              <span>恢复</span>
            </UiButton>
          </div>

          <div v-if="historyChanges(item, index).length" class="history-changes">
            <div
              v-for="change in historyChanges(item, index)"
              :key="`${item.id}-${change.field}`"
              class="history-change"
            >
              <span class="history-change__field">{{ entryHistoryFieldLabel(change.field) }}</span>
              <div class="history-change__values">
                <span class="history-change__before">{{ change.before }}</span>
                <UiIcon name="chevron-right" :size="12" />
                <span class="history-change__after">{{ change.after }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <UiEmpty
        v-else
        icon="vault"
        title="暂无修改历史"
        description="编辑或更改条目状态后，系统会自动记录历史版本。"
      />
    </UiModal>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiDropdown, UiEmpty, UiIcon, UiModal } from './ui'
import type { UiDropdownItem, UiIconName } from './ui'
import type {
  AutofillMatchMode,
  EntryKind,
  VaultCustomField,
  VaultEntry,
  VaultEntryHistory,
  VaultEntryHistoryChange
} from '../types'
import { buildEntryHistoryChanges, entryHistoryFieldLabel } from '../services/entryHistory'
import type { PasskeyPresentationItem } from '../services/passkeyPresentation.ts'

const props = defineProps<{
  entry: VaultEntry | null
  showPassword: boolean
  passwordMask: string
  totpCode: string
  totpRemaining: number
  totpProgress: number
  linkedPasskeys: PasskeyPresentationItem[]
  attachmentBusy: boolean
  attachmentActionsSupported: boolean
}>()

const emit = defineEmits<{
  edit: [entry: VaultEntry]
  move: [entryId: string]
  duplicate: [entryId: string]
  delete: [entryId: string]
  disable: [entryId: string]
  restore: [entryId: string]
  purge: [entryId: string]
  'restore-history': [entryId: string, historyId: string]
  'clear-history': [entryId: string]
  copy: [value: string]
  'open-website': [domain: string]
  'toggle-password': []
  'refresh-totp': []
  'open-passkey': [passkeyId: string]
  'unlink-passkey': [passkeyId: string]
  'save-attachment': [entryId: string, attachmentId: string]
  'remove-attachment': [entryId: string, attachmentId: string]
  'add-attachment': [entryId: string, file: File]
}>()

const detailRoot = ref<HTMLElement | null>(null)
const attachmentInput = ref<HTMLInputElement | null>(null)
const historyModalOpen = ref(false)
const revealedCustomFields = ref(new Set<string>())
const detailMenuOpen = ref(false)

const visibleHistory = computed(() =>
  (props.entry?.history || []).filter((item) => item.action !== 'created').slice(0, 10)
)

const formattedTotpCode = computed(() => {
  const code = (props.totpCode || '').trim()
  if (!code) return '--- ---'
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  return code
})

const detailDropdownItems = computed<UiDropdownItem[]>(() => {
  const entry = props.entry
  if (!entry) return []

  const items: UiDropdownItem[] = []
  if (entry.status !== 'trashed') {
    if (entry.status === 'active' || !entry.status) {
      items.push({ key: 'move', label: '移动到分组', icon: 'move' })
    }
    items.push({ key: 'duplicate', label: '复制为新条目', icon: 'duplicate' })
    if (entry.kind !== 'folder' && props.attachmentActionsSupported) {
      items.push({
        key: 'add-attachment',
        label: '添加附件',
        icon: 'paperclip',
        disabled: props.attachmentBusy
      })
    }
  }
  if (visibleHistory.value.length > 0) {
    items.push({
      key: 'history',
      label: `查看历史 (${visibleHistory.value.length})`,
      icon: 'clock'
    })
  }
  if (entry.status === 'active' || !entry.status) {
    items.push({ key: 'disable', label: '归档条目', icon: 'archive', divider: items.length > 0 })
  }
  if (entry.status === 'disabled' || entry.status === 'trashed') {
    items.push({ key: 'restore', label: '恢复条目', icon: 'restore', divider: items.length > 0 })
  }
  items.push(
    entry.status === 'trashed'
      ? { key: 'purge', label: '彻底删除', icon: 'trash', danger: true, divider: true }
      : { key: 'delete', label: '移入回收站', icon: 'trash', danger: true, divider: true }
  )
  return items
})

watch(() => props.entry?.id, () => {
  historyModalOpen.value = false
  revealedCustomFields.value = new Set()
  detailMenuOpen.value = false
})

function resolveKindIcon(kind: EntryKind): UiIconName {
  if (kind === 'folder') return 'folder'
  if (kind === 'login') return 'key'
  if (kind === 'secure-note') return 'edit'
  if (kind === 'card') return 'lock'
  if (kind === 'identity') return 'info'
  if (kind === 'api-key') return 'command'
  return 'key'
}

function autofillMatchModeLabel(mode: AutofillMatchMode | undefined) {
  return {
    'base-domain': '根域及子域',
    'exact-host': '仅精确主机',
    subdomain: '仅下级子域',
    'url-prefix': 'URL 前缀',
    never: '永不填充'
  }[mode || 'base-domain']
}

function selectAttachmentFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file && props.entry) emit('add-attachment', props.entry.id, file)
}

function formatAttachmentSize(value: number) {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function selectDetailAction(item: UiDropdownItem) {
  const entry = props.entry
  if (!entry) return
  if (item.key === 'history') historyModalOpen.value = true
  else if (item.key === 'add-attachment') attachmentInput.value?.click()
  else if (item.key === 'duplicate') emit('duplicate', entry.id)
  else if (item.key === 'edit') emit('edit', entry)
  else if (item.key === 'move') emit('move', entry.id)
  else if (item.key === 'disable') emit('disable', entry.id)
  else if (item.key === 'restore') emit('restore', entry.id)
  else if (item.key === 'delete') emit('delete', entry.id)
  else if (item.key === 'purge') emit('purge', entry.id)
}

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

function historyChanges(item: VaultEntryHistory, index: number): VaultEntryHistoryChange[] {
  if (item.changes?.length) return item.changes
  if (!item.snapshot || !props.entry) return []
  const after = index === 0 ? props.entry : visibleHistory.value[index - 1]?.snapshot
  return after ? buildEntryHistoryChanges(item.snapshot, after) : []
}

function customFieldValue(field: VaultCustomField) {
  if ((field.protected || field.type === 'secret') && !revealedCustomFields.value.has(field.id)) {
    return field.value ? '••••••••' : '未设置'
  }
  return field.value || '未设置'
}

function toggleCustomField(fieldId: string) {
  const next = new Set(revealedCustomFields.value)
  if (next.has(fieldId)) next.delete(fieldId)
  else next.add(fieldId)
  revealedCustomFields.value = next
}
</script>

<style scoped>
.detail-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px 28px;
  color: var(--text-main);
  user-select: text;
}

/* Archived / trashed banner */
.detail-status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
}

.detail-status-banner.is-archived {
  background-color: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 30%, transparent);
}

.detail-status-banner.is-trashed {
  background-color: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
}

.detail-status-banner__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 220px;
}

.detail-status-banner__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--app-font-sm);
}

.detail-status-banner.is-archived .detail-status-banner__title {
  color: var(--warning);
}

.detail-status-banner.is-trashed .detail-status-banner__title {
  color: var(--danger);
}

.detail-status-banner__desc {
  margin: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.45;
}

.detail-status-banner__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Header */
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
}

.detail-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 220px;
}

.detail-kind-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  flex-shrink: 0;
  background-color: var(--surface-container);
  color: var(--text-main);
}

.detail-kind-avatar.is-folder,
.detail-kind-avatar.is-secure-note,
.detail-kind-avatar.is-card,
.detail-kind-avatar.is-identity,
.detail-kind-avatar.is-api-key {
  background-color: var(--surface-container);
  color: var(--text-secondary);
}

.detail-heading-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.detail-heading-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-subtitle {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.detail-title {
  margin: 0;
  font-size: var(--app-font-xl);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: var(--text-main);
  word-break: break-word;
  user-select: text;
}

.detail-actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}

/* Cards & fields */
.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-card,
.detail-attachments {
  display: flex;
  flex-direction: column;
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.detail-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.detail-card__head-left {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
}

.detail-card__title {
  font-size: var(--app-font-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

.detail-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.detail-field.is-copyable {
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.detail-field.is-copyable:hover {
  background-color: var(--surface-container-low);
}

.detail-field:last-child {
  border-bottom: 0;
}

.detail-field__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}

.detail-field__label {
  font-size: var(--app-font-xs);
  font-weight: 500;
  color: var(--text-muted);
}

.detail-field__value {
  font-size: var(--app-font-base);
  font-weight: 500;
  color: var(--text-main);
  word-break: break-word;
  user-select: text;
}

.detail-field__value.is-empty {
  color: var(--text-muted);
  font-weight: 400;
}

.detail-field__value.is-mono {
  font-family: var(--font-mono);
  font-variant-ligatures: none;
}

.detail-field__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* Password monospace display */
.password-display {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
}

.password-display.is-empty {
  padding: 0;
}

.password-display__text {
  font-family: var(--font-mono);
  font-size: var(--app-font-base);
  font-variant-ligatures: none;
  letter-spacing: 0.04em;
  color: var(--text-main);
  word-break: break-all;
  user-select: text;
}

.password-display.is-empty .password-display__text {
  font-family: var(--font-sans);
  letter-spacing: 0;
  color: var(--text-muted);
}

/* TOTP widget */
.detail-totp-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 14px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.detail-totp-card.is-copyable {
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.detail-totp-card.is-copyable:hover {
  background-color: var(--surface-container);
}

.detail-totp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-totp-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.totp-code-btn {
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.totp-code-btn:disabled {
  cursor: default;
}

.totp-code {
  font-family: var(--font-mono);
  font-size: var(--app-font-xl);
  font-weight: 700;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  color: var(--brand);
  user-select: text;
}

.detail-totp-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.totp-progress-track {
  height: 4px;
  border-radius: var(--radius-full);
  background-color: var(--surface-container-high);
  overflow: hidden;
}

.totp-progress-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background-color: var(--brand);
  transition: width 320ms linear, background-color var(--duration-fast) var(--ease-standard);
}

.totp-progress-fill.is-expiring {
  background-color: var(--danger);
}

/* Domains */
.detail-domain-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.detail-domain-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 6px 4px 10px;
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
  font-size: var(--app-font-sm);
  color: var(--text-main);
}

.detail-domain-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.domain-chip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.domain-chip-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--brand);
}

/* Passkeys & attachments subcards */
.detail-item-list {
  display: flex;
  flex-direction: column;
}

.detail-subcard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.detail-subcard:last-child {
  border-bottom: 0;
}

.detail-subcard__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background-color: var(--surface-container);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-subcard__icon.is-brand {
  background-color: var(--brand-soft);
  color: var(--brand);
}

.detail-subcard__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-subcard__copy strong {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}

.detail-subcard__copy small {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-subcard__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.detail-empty-hint {
  margin: 0;
  padding: 12px 14px;
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

/* Notes */
.detail-note-body {
  margin: 0;
  padding: 12px 14px;
  font-family: var(--font-sans);
  font-size: var(--app-font-sm);
  line-height: 1.6;
  color: var(--text-main);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

/* History modal content */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;
}

.history-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.history-item__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.history-item__time {
  font-variant-numeric: tabular-nums;
}

.history-item__note {
  color: var(--text-muted);
}

.history-changes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-soft);
}

.history-change {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: var(--app-font-xs);
}

.history-change__field {
  font-weight: 600;
  color: var(--text-secondary);
}

.history-change__values {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-muted);
}

.history-change__before {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background-color: var(--danger-soft);
  color: var(--danger);
  text-decoration: line-through;
  word-break: break-all;
}

.history-change__after {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background-color: var(--success-soft);
  color: var(--success);
  word-break: break-all;
}

@media (max-width: 639px) {
  .detail-content {
    padding: 14px 14px 24px;
  }

  .detail-action-label-desktop {
    display: none;
  }
}
</style>
