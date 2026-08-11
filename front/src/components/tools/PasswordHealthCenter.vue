<template>
  <van-popup
    :show="open"
    position="right"
    class="plugin-detail-popup password-health-popup"
    :duration="0.16"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <section class="plugin-detail-shell password-health-shell" @keydown="handleKeydown">
      <van-nav-bar
        safe-area-inset-top
        :title="mode === 'totp' ? 'TOTP 规则' : '密码健康'"
        left-arrow
        @click-left="handleBack"
      />

      <div v-if="mode === 'totp'" class="plugin-detail-body password-health-body health-totp-rules">
        <div class="health-rule-search">
          <van-icon name="search" />
          <input v-model="totpKeyword" type="search" autocomplete="off" placeholder="搜索登录条目" />
          <button v-if="totpKeyword" type="button" title="清空" aria-label="清空" @click="totpKeyword = ''">
            <van-icon name="cross" />
          </button>
        </div>
        <div class="password-health-section-head">
          <strong>本机规则</strong>
          <span>{{ expectedTotpIds.size }} 项</span>
        </div>
        <div v-if="filteredLoginEntries.length" class="health-rule-list">
          <label v-for="entry in filteredLoginEntries" :key="entry.entryId" class="health-rule-row">
            <span class="health-rule-copy">
              <strong>{{ entry.title || '未命名条目' }}</strong>
              <small>{{ entry.issues.includes('missing-totp') ? '待配置 TOTP' : '登录条目' }}</small>
            </span>
            <input
              type="checkbox"
              :checked="expectedTotpIds.has(entry.entryId)"
              @change="emit('toggle-totp-expected', entry.entryId, ($event.target as HTMLInputElement).checked)"
            />
          </label>
        </div>
        <van-empty v-else image="search" description="没有匹配的登录条目" />
      </div>

      <div v-else class="plugin-detail-body password-health-body">
        <div class="password-health-summary" aria-label="密码健康汇总">
          <div>
            <strong>{{ pendingEntryCount }}</strong>
            <span>需处理</span>
          </div>
          <div>
            <strong>{{ report.summary.weakCount }}</strong>
            <span>弱密码</span>
          </div>
          <div>
            <strong>{{ report.summary.duplicateEntryCount }}</strong>
            <span>重复项</span>
          </div>
          <div>
            <strong>{{ report.summary.expiredCount + report.summary.expiringCount }}</strong>
            <span>到期</span>
          </div>
        </div>

        <div class="health-toolbar">
          <div class="health-view-switch" role="tablist" aria-label="发现状态">
            <button type="button" :class="{ active: view === 'pending' }" @click="view = 'pending'">
              待处理 <span>{{ pendingFindings.length }}</span>
            </button>
            <button type="button" :class="{ active: view === 'ignored' }" @click="view = 'ignored'">
              已忽略 <span>{{ ignoredRows.length }}</span>
            </button>
          </div>
          <button type="button" class="health-totp-button" title="TOTP 规则" @click="mode = 'totp'">
            <van-icon name="clock-o" />
            <span>TOTP</span>
          </button>
        </div>

        <div class="password-health-section-head">
          <strong>{{ view === 'pending' ? '风险发现' : '已忽略发现' }}</strong>
          <span>{{ visibleRows.length }} 项</span>
        </div>

        <div v-if="visibleRows.length" class="password-health-list health-finding-list">
          <article v-for="row in visibleRows" :key="row.key" class="password-health-entry health-finding-row">
            <button type="button" class="health-finding-main" @click="emit('open-entry', row.entry.entryId)">
              <span class="password-health-entry-icon"><van-icon :name="issueIcon(row.issue)" /></span>
              <span class="password-health-entry-copy">
                <strong>{{ row.entry.title || '未命名条目' }}</strong>
                <small>{{ entryKindLabel(row.entry.kind) }} · {{ issueLabel(row.entry, row.issue) }}</small>
                <span v-if="row.ignored" class="health-ignore-reason">{{ row.ignored.reason }}</span>
              </span>
              <van-icon class="password-health-entry-arrow" name="arrow" />
            </button>
            <div class="health-finding-actions">
              <button
                v-if="!row.ignored"
                type="button"
                class="health-remediate-button"
                @click="emit('remediate', row.entry.entryId, row.issue)"
              >{{ remediationLabel(row.issue) }}</button>
              <button
                v-if="!row.ignored"
                type="button"
                class="health-ignore-button"
                @click="beginIgnore(row.entry.entryId, row.issue)"
              >忽略</button>
              <button
                v-else
                type="button"
                class="health-remediate-button"
                @click="emit('restore-finding', row.entry.entryId, row.issue)"
              >恢复检查</button>
            </div>
          </article>
        </div>
        <van-empty v-else image="search" :description="view === 'pending' ? '没有待处理风险' : '没有已忽略发现'" />
        <p v-if="report.truncated" class="password-health-warning">条目数量超过本次分析上限，结果不完整</p>
      </div>

      <van-popup v-model:show="ignoreOpen" round class="health-ignore-popup" :close-on-click-overlay="true">
        <section class="health-ignore-panel" aria-label="忽略原因">
          <strong>忽略原因</strong>
          <van-field
            v-model="ignoreReason"
            type="textarea"
            rows="2"
            maxlength="120"
            show-word-limit
            autofocus
            placeholder="例如：测试账号"
          />
          <span v-if="ignoreError" class="health-ignore-error">{{ ignoreError }}</span>
          <div class="health-ignore-actions">
            <van-button size="small" plain @click="ignoreOpen = false">取消</van-button>
            <van-button size="small" type="primary" @click="confirmIgnore">确认忽略</van-button>
          </div>
        </section>
      </van-popup>
    </section>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { entryKindLabel } from '../../services/entryKinds.ts'
import { healthFindingKey, type IgnoredHealthFinding } from '../../services/healthPreferences.ts'
import type {
  PasswordHealthEntryResult,
  PasswordHealthIssue,
  PasswordHealthReport
} from '../../services/passwordHealth.ts'

const props = defineProps<{
  open: boolean
  report: PasswordHealthReport
  expectedTotpIds: ReadonlySet<string>
  ignoredFindings: ReadonlyMap<string, IgnoredHealthFinding>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'open-entry': [entryId: string]
  remediate: [entryId: string, issue: PasswordHealthIssue]
  'ignore-finding': [entryId: string, issue: PasswordHealthIssue, reason: string]
  'restore-finding': [entryId: string, issue: PasswordHealthIssue]
  'toggle-totp-expected': [entryId: string, expected: boolean]
}>()

type FindingRow = {
  key: string
  entry: PasswordHealthEntryResult
  issue: PasswordHealthIssue
  ignored?: IgnoredHealthFinding
}

const view = ref<'pending' | 'ignored'>('pending')
const mode = ref<'findings' | 'totp'>('findings')
const totpKeyword = ref('')
const ignoreOpen = ref(false)
const ignoreReason = ref('')
const ignoreError = ref('')
const ignoreEntryId = ref('')
const ignoreIssue = ref<PasswordHealthIssue | null>(null)

const findingRows = computed<FindingRow[]>(() => props.report.entries.flatMap((entry) =>
  entry.issues.map((issue) => {
    const key = healthFindingKey(entry.entryId, issue)
    return { key, entry, issue, ignored: props.ignoredFindings.get(key) }
  })
))
const pendingFindings = computed(() => findingRows.value.filter((row) => !row.ignored))
const ignoredRows = computed(() => findingRows.value.filter((row) => row.ignored))
const visibleRows = computed(() => view.value === 'pending' ? pendingFindings.value : ignoredRows.value)
const pendingEntryCount = computed(() => new Set(pendingFindings.value.map((row) => row.entry.entryId)).size)
const filteredLoginEntries = computed(() => {
  const term = totpKeyword.value.trim().toLocaleLowerCase('zh-CN')
  return props.report.entries.filter((entry) => entry.kind === 'login' && (
    !term || entry.title.toLocaleLowerCase('zh-CN').includes(term)
  ))
})

watch(() => props.open, (open) => {
  if (!open) return
  mode.value = 'findings'
  view.value = 'pending'
  totpKeyword.value = ''
  ignoreOpen.value = false
})

function handleBack() {
  if (mode.value === 'totp') {
    mode.value = 'findings'
    return
  }
  emit('update:open', false)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  if (ignoreOpen.value) ignoreOpen.value = false
  else handleBack()
}

function beginIgnore(entryId: string, issue: PasswordHealthIssue) {
  ignoreEntryId.value = entryId
  ignoreIssue.value = issue
  ignoreReason.value = ''
  ignoreError.value = ''
  ignoreOpen.value = true
}

function confirmIgnore() {
  const reason = ignoreReason.value.trim()
  if (!reason) {
    ignoreError.value = '请填写忽略原因'
    return
  }
  if (ignoreIssue.value) emit('ignore-finding', ignoreEntryId.value, ignoreIssue.value, reason)
  ignoreOpen.value = false
}

function issueLabel(entry: PasswordHealthEntryResult, issue: PasswordHealthIssue) {
  if (issue === 'missing') return '未设置密码'
  if (issue === 'weak') return `弱密码 · 强度 ${entry.strength?.score ?? 0} / 4`
  if (issue === 'reused') return '密码重复使用'
  if (issue === 'stale') return entry.passwordAge ? `${entry.passwordAge.ageDays} 天未更改` : '长期未更改'
  if (issue === 'insecure-url') return `${entry.insecureUrlCount || 1} 个 HTTP 地址`
  if (issue === 'duplicate') return '精确重复条目'
  if (issue === 'missing-totp') return '应配置 TOTP'
  const expiration = entry.expirations?.find((item) => item.status === issue)
  if (issue === 'expired') return expiration ? `${expiration.label} 已过期 ${Math.abs(expiration.daysRemaining)} 天` : '已过期'
  return expiration ? `${expiration.label} 将在 ${expiration.daysRemaining} 天后到期` : '即将到期'
}

function remediationLabel(issue: PasswordHealthIssue) {
  if (issue === 'missing' || issue === 'weak' || issue === 'reused' || issue === 'stale') return '生成新密码'
  if (issue === 'missing-totp') return '配置 TOTP'
  if (issue === 'duplicate') return '合并重复项'
  return '编辑条目'
}

function issueIcon(issue: PasswordHealthIssue) {
  if (issue === 'duplicate') return 'copy-o'
  if (issue === 'expired' || issue === 'expiring') return 'clock-o'
  if (issue === 'insecure-url') return 'warning-o'
  if (issue === 'missing-totp') return 'shield-o'
  return 'closed-eye'
}
</script>
