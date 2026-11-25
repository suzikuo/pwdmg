<template>
  <UiModal
    :open="open"
    :title="mode === 'totp' ? 'TOTP 规则配置' : '密码健康中心'"
    :subtitle="mode === 'totp' ? '勾选应开启两步验证的登录条目，未配置时将给出提醒' : '全面扫描弱密码、重复密码、过期凭据与缺失 TOTP'"
    size="xl"
    @close="handleModalClose"
  >
    <template #header-extra>
      <UiButton v-if="mode === 'totp'" variant="subtle" size="sm" @click="mode = 'findings'">
        <UiIcon name="arrow-left" :size="14" />
        <span>返回体检</span>
      </UiButton>
      <UiButton v-else variant="subtle" size="sm" @click="mode = 'totp'">
        <UiIcon name="clock" :size="14" />
        <span>TOTP 规则 ({{ expectedTotpIds.size }})</span>
      </UiButton>
    </template>

    <div v-if="mode === 'totp'" class="health-totp-view">
      <UiInput
        v-model="totpKeyword"
        type="search"
        clearable
        placeholder="搜索登录条目名称…"
      >
        <template #prefix>
          <UiIcon name="search" :size="15" />
        </template>
      </UiInput>

      <div v-if="filteredLoginEntries.length" class="health-rule-list">
        <div
          v-for="entry in filteredLoginEntries"
          :key="entry.entryId"
          class="health-rule-row"
        >
          <div class="health-rule-copy">
            <strong>{{ entry.title || '未命名条目' }}</strong>
            <span>{{ entry.issues.includes('missing-totp') ? '当前尚未配置 TOTP' : '登录条目' }}</span>
          </div>
          <UiSwitch
            :model-value="expectedTotpIds.has(entry.entryId)"
            :aria-label="`要求 ${entry.title || '未命名条目'} 配置 TOTP`"
            @update:model-value="emit('toggle-totp-expected', entry.entryId, $event)"
          />
        </div>
      </div>

      <UiEmpty
        v-else
        icon="search"
        title="没有匹配的登录条目"
        description="尝试清除或更换搜索关键词"
      />
    </div>

    <div v-else class="health-dashboard">
      <section class="health-hero" aria-label="安全评分与汇总">
        <div class="health-score-ring-card">
          <div class="health-ring-wrap">
            <svg class="health-ring-svg" viewBox="0 0 96 96" aria-hidden="true">
              <circle class="health-ring-track" cx="48" cy="48" r="40" />
              <circle
                class="health-ring-fill"
                :class="`is-${scoreTone}`"
                cx="48"
                cy="48"
                r="40"
                :stroke-dasharray="RING_CIRCUMFERENCE"
                :stroke-dashoffset="ringDashOffset"
              />
            </svg>
            <div class="health-ring-center">
              <strong class="health-ring-value">{{ securityScore }}</strong>
              <span class="health-ring-unit">分</span>
            </div>
          </div>
          <div class="health-score-copy">
            <UiBadge :tone="scoreTone">{{ scoreStatusLabel }}</UiBadge>
            <p>已扫描 {{ report.summary.scannedEntryCount }} 项，其中 {{ pendingEntryCount }} 项存在待处理风险</p>
          </div>
        </div>

        <div class="health-kpi-grid">
          <div class="health-kpi-card">
            <span class="health-kpi-label">弱密码 / 缺失</span>
            <strong class="health-kpi-value is-danger">
              {{ report.summary.weakCount + report.summary.missingCount }}
            </strong>
          </div>
          <div class="health-kpi-card">
            <span class="health-kpi-label">重复密码 / 项</span>
            <strong class="health-kpi-value is-warning">
              {{ report.summary.reusedEntryCount + report.summary.duplicateEntryCount }}
            </strong>
          </div>
          <div class="health-kpi-card">
            <span class="health-kpi-label">缺少 TOTP</span>
            <strong class="health-kpi-value is-brand">
              {{ report.summary.missingTotpCount }}
            </strong>
          </div>
          <div class="health-kpi-card">
            <span class="health-kpi-label">过期 / 老化</span>
            <strong class="health-kpi-value">
              {{ report.summary.expiredCount + report.summary.expiringCount + report.summary.staleCount }}
            </strong>
          </div>
        </div>
      </section>

      <div class="health-filter-bar" role="tablist" aria-label="风险筛选">
        <button
          v-for="tab in filterTabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="health-filter-pill"
          :class="{ 'is-active': activeFilter === tab.key }"
          :aria-selected="activeFilter === tab.key"
          @click="selectFilter(tab.key)"
        >
          <span>{{ tab.label }}</span>
          <span class="health-filter-count">{{ tab.count }}</span>
        </button>
      </div>

      <div v-if="visibleRows.length" class="health-finding-list">
        <article
          v-for="row in visibleRows"
          :key="row.key"
          class="health-finding-card"
        >
          <div class="health-finding-top">
            <button
              type="button"
              class="health-finding-main"
              @click="emit('open-entry', row.entry.entryId)"
            >
              <span class="health-finding-icon" :class="`is-${issueTone(row.issue)}`" aria-hidden="true">
                <UiIcon :name="issueIcon(row.issue)" :size="16" />
              </span>
              <span class="health-finding-copy">
                <span class="health-finding-title-row">
                  <strong class="health-finding-title">{{ row.entry.title || '未命名条目' }}</strong>
                  <UiBadge :tone="issueTone(row.issue)" size="sm">{{ issueShortTag(row.issue) }}</UiBadge>
                </span>
                <small class="health-finding-desc">
                  {{ entryKindLabel(row.entry.kind) }} · {{ issueLabel(row.entry, row.issue) }}
                </small>
                <span v-if="row.ignored" class="health-ignore-note">
                  忽略原因：{{ row.ignored.reason }}
                </span>
              </span>
            </button>

            <div class="health-finding-actions">
              <template v-if="!row.ignored">
                <UiButton
                  variant="primary"
                  size="sm"
                  @click="emit('remediate', row.entry.entryId, row.issue)"
                >
                  {{ remediationLabel(row.issue) }}
                </UiButton>
                <UiButton
                  variant="ghost"
                  size="sm"
                  @click="beginIgnore(row.key, row.entry.entryId, row.issue)"
                >
                  忽略
                </UiButton>
              </template>
              <UiButton
                v-else
                variant="secondary"
                size="sm"
                @click="emit('restore-finding', row.entry.entryId, row.issue)"
              >
                <UiIcon name="restore" :size="14" />
                <span>恢复检查</span>
              </UiButton>
            </div>
          </div>

          <form
            v-if="ignoringRowKey === row.key"
            class="health-inline-ignore"
            @submit.prevent="confirmIgnore"
          >
            <UiInput
              v-model="ignoreReason"
              label="忽略原因"
              placeholder="例如：测试账号或临时环境凭据"
              :error="ignoreError"
              autofocus
              @enter="confirmIgnore"
            />
            <div class="health-inline-ignore-actions">
              <UiButton variant="ghost" size="sm" @click="cancelIgnore">取消</UiButton>
              <UiButton variant="primary" size="sm" type="submit">确认忽略</UiButton>
            </div>
          </form>
        </article>
      </div>

      <UiEmpty
        v-else
        icon="shield"
        :title="activeFilter === 'ignored' ? '没有已忽略的发现' : '当前分类没有待处理风险'"
        :description="activeFilter === 'ignored' ? '你在体检中忽略的风险会集中展示在这里' : '保险库在此维度表现良好'"
      />

      <p v-if="report.truncated" class="health-truncated-warning" role="status">
        条目数量超过本次分析上限，结果可能不完整。
      </p>
    </div>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiInput, UiModal, UiSwitch, type UiIconName } from '../ui'
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

type FilterKey = 'all' | 'weak' | 'reused' | 'missing-totp' | 'expired' | 'ignored'

const RING_RADIUS = 40
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const mode = ref<'findings' | 'totp'>('findings')
const activeFilter = ref<FilterKey>('all')
const totpKeyword = ref('')
const ignoringRowKey = ref('')
const ignoreReason = ref('')
const ignoreError = ref('')
const ignoreEntryId = ref('')
const ignoreIssue = ref<PasswordHealthIssue | null>(null)

const findingRows = computed<FindingRow[]>(() =>
  props.report.entries.flatMap((entry) =>
    entry.issues.map((issue) => {
      const key = healthFindingKey(entry.entryId, issue)
      return { key, entry, issue, ignored: props.ignoredFindings.get(key) }
    })
  )
)

const pendingFindings = computed(() => findingRows.value.filter((row) => !row.ignored))
const ignoredRows = computed(() => findingRows.value.filter((row) => row.ignored))
const pendingEntryCount = computed(() => new Set(pendingFindings.value.map((row) => row.entry.entryId)).size)

const weakRows = computed(() =>
  pendingFindings.value.filter((row) => row.issue === 'weak' || row.issue === 'missing')
)
const reusedRows = computed(() =>
  pendingFindings.value.filter((row) => row.issue === 'reused' || row.issue === 'duplicate')
)
const missingTotpRows = computed(() =>
  pendingFindings.value.filter((row) => row.issue === 'missing-totp')
)
const expiredRows = computed(() =>
  pendingFindings.value.filter((row) => row.issue === 'expired' || row.issue === 'expiring' || row.issue === 'stale')
)

const filterTabs = computed<Array<{ key: FilterKey; label: string; count: number }>>(() => [
  { key: 'all', label: '全部待处理', count: pendingFindings.value.length },
  { key: 'weak', label: '弱密码', count: weakRows.value.length },
  { key: 'reused', label: '重复密码', count: reusedRows.value.length },
  { key: 'missing-totp', label: '缺少 TOTP', count: missingTotpRows.value.length },
  { key: 'expired', label: '过期密码', count: expiredRows.value.length },
  { key: 'ignored', label: '已忽略', count: ignoredRows.value.length }
])

const visibleRows = computed(() => {
  if (activeFilter.value === 'ignored') return ignoredRows.value
  if (activeFilter.value === 'weak') return weakRows.value
  if (activeFilter.value === 'reused') return reusedRows.value
  if (activeFilter.value === 'missing-totp') return missingTotpRows.value
  if (activeFilter.value === 'expired') return expiredRows.value
  return pendingFindings.value
})

const securityScore = computed(() => {
  const total = props.report.summary.scannedEntryCount
  if (total <= 0) return 100
  const baseStrength = props.report.summary.analyzedCount > 0
    ? (props.report.summary.averageScore / 4) * 100
    : 100
  const penalty = Math.min(60, Math.round((pendingEntryCount.value / total) * 60))
  return Math.max(0, Math.min(100, Math.round(baseStrength * 0.55 + (100 - penalty) * 0.45)))
})

const scoreTone = computed<'success' | 'brand' | 'warning' | 'danger'>(() => {
  if (securityScore.value >= 85) return 'success'
  if (securityScore.value >= 65) return 'brand'
  if (securityScore.value >= 45) return 'warning'
  return 'danger'
})

const scoreStatusLabel = computed(() => {
  if (securityScore.value >= 85) return '安全状况优秀'
  if (securityScore.value >= 65) return '整体良好'
  if (securityScore.value >= 45) return '建议尽快加固'
  return '存在高风险项'
})

const ringDashOffset = computed(() => RING_CIRCUMFERENCE * (1 - securityScore.value / 100))

const filteredLoginEntries = computed(() => {
  const term = totpKeyword.value.trim().toLocaleLowerCase('zh-CN')
  return props.report.entries.filter(
    (entry) => entry.kind === 'login' && (!term || entry.title.toLocaleLowerCase('zh-CN').includes(term))
  )
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    mode.value = 'findings'
    activeFilter.value = 'all'
    totpKeyword.value = ''
    cancelIgnore()
  },
  { immediate: true }
)

function handleModalClose() {
  if (mode.value === 'totp') {
    mode.value = 'findings'
    return
  }
  emit('update:open', false)
}

function selectFilter(key: FilterKey) {
  activeFilter.value = key
  cancelIgnore()
}

function beginIgnore(rowKey: string, entryId: string, issue: PasswordHealthIssue) {
  ignoringRowKey.value = rowKey
  ignoreEntryId.value = entryId
  ignoreIssue.value = issue
  ignoreReason.value = ''
  ignoreError.value = ''
}

function cancelIgnore() {
  ignoringRowKey.value = ''
  ignoreEntryId.value = ''
  ignoreIssue.value = null
  ignoreReason.value = ''
  ignoreError.value = ''
}

function confirmIgnore() {
  const reason = ignoreReason.value.trim()
  if (!reason) {
    ignoreError.value = '请填写忽略原因'
    return
  }
  if (ignoreIssue.value) {
    emit('ignore-finding', ignoreEntryId.value, ignoreIssue.value, reason)
  }
  cancelIgnore()
}

function issueLabel(entry: PasswordHealthEntryResult, issue: PasswordHealthIssue) {
  if (issue === 'missing') return '未设置密码'
  if (issue === 'weak') return `弱密码 · 强度 ${entry.strength?.score ?? 0} / 4`
  if (issue === 'reused') return '多个账号复用了相同密码'
  if (issue === 'stale') return entry.passwordAge ? `${entry.passwordAge.ageDays} 天未更改` : '长期未更改'
  if (issue === 'insecure-url') return `${entry.insecureUrlCount || 1} 个非 HTTPS 地址`
  if (issue === 'duplicate') return '存在完全重复条目'
  if (issue === 'missing-totp') return '已标记需要 TOTP 但尚未配置'
  const expiration = entry.expirations?.find((item) => item.status === issue)
  if (issue === 'expired') return expiration ? `${expiration.label} 已过期 ${Math.abs(expiration.daysRemaining)} 天` : '已过期'
  return expiration ? `${expiration.label} 将在 ${expiration.daysRemaining} 天后到期` : '即将到期'
}

function issueShortTag(issue: PasswordHealthIssue) {
  if (issue === 'missing') return '缺失密码'
  if (issue === 'weak') return '弱密码'
  if (issue === 'reused') return '重复密码'
  if (issue === 'stale') return '长期未改'
  if (issue === 'insecure-url') return 'HTTP 地址'
  if (issue === 'duplicate') return '重复条目'
  if (issue === 'missing-totp') return '缺 TOTP'
  if (issue === 'expired') return '已过期'
  return '即将到期'
}

function issueTone(issue: PasswordHealthIssue): 'danger' | 'warning' | 'brand' | 'neutral' {
  if (issue === 'missing' || issue === 'weak' || issue === 'expired') return 'danger'
  if (issue === 'reused' || issue === 'insecure-url' || issue === 'expiring' || issue === 'stale') return 'warning'
  if (issue === 'missing-totp') return 'brand'
  return 'neutral'
}

function remediationLabel(issue: PasswordHealthIssue) {
  if (issue === 'missing' || issue === 'weak' || issue === 'reused' || issue === 'stale') return '去修改'
  if (issue === 'missing-totp') return '配置 TOTP'
  if (issue === 'duplicate') return '合并重复项'
  return '去修改'
}

function issueIcon(issue: PasswordHealthIssue): UiIconName {
  if (issue === 'duplicate' || issue === 'reused') return 'copy'
  if (issue === 'expired' || issue === 'expiring' || issue === 'stale') return 'clock'
  if (issue === 'insecure-url') return 'alert'
  if (issue === 'missing-totp') return 'shield'
  return 'key'
}
</script>

<style scoped>
.health-dashboard,
.health-totp-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.health-hero {
  display: grid;
  grid-template-columns: minmax(240px, 1.15fr) minmax(0, 1.5fr);
  gap: 12px;
}

.health-score-ring-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.health-ring-wrap {
  position: relative;
  width: 82px;
  height: 82px;
  flex-shrink: 0;
}

.health-ring-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.health-ring-track {
  fill: none;
  stroke: var(--surface-container-high);
  stroke-width: 8;
}

.health-ring-fill {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--duration-slow) var(--ease-standard);
}

.health-ring-fill.is-success {
  stroke: var(--success);
}

.health-ring-fill.is-brand {
  stroke: var(--brand);
}

.health-ring-fill.is-warning {
  stroke: var(--warning);
}

.health-ring-fill.is-danger {
  stroke: var(--danger);
}

.health-ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  padding-top: 26px;
}

.health-ring-value {
  font-size: var(--app-font-xl);
  font-weight: 700;
  color: var(--text-main);
  line-height: 1;
}

.health-ring-unit {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.health-score-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.health-score-copy p {
  margin: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.45;
}

.health-kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.health-kpi-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.health-kpi-label {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.health-kpi-value {
  font-size: var(--app-font-xl);
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.1;
}

.health-kpi-value.is-danger {
  color: var(--danger);
}

.health-kpi-value.is-warning {
  color: var(--warning);
}

.health-kpi-value.is-brand {
  color: var(--brand);
}

.health-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.health-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height-sm);
  padding: 0 11px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
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

.health-filter-pill:hover {
  background-color: var(--surface-container);
  color: var(--text-main);
}

.health-filter-pill.is-active {
  background-color: var(--brand-soft);
  border-color: var(--brand);
  color: var(--brand);
  font-weight: 600;
}

.health-filter-count {
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  opacity: 0.85;
}

.health-finding-list,
.health-rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.health-finding-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--panel-bg);
}

.health-finding-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-finding-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.health-finding-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.health-finding-icon.is-danger {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.health-finding-icon.is-warning {
  background-color: var(--warning-soft);
  color: var(--warning);
}

.health-finding-icon.is-brand {
  background-color: var(--brand-soft);
  color: var(--brand);
}

.health-finding-icon.is-neutral {
  background-color: var(--surface-container-high);
  color: var(--text-secondary);
}

.health-finding-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.health-finding-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.health-finding-title {
  font-size: var(--app-font-base);
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-finding-desc {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.health-ignore-note {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.health-finding-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.health-inline-ignore {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
}

.health-inline-ignore-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.health-rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.health-rule-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.health-rule-copy strong {
  font-size: var(--app-font-base);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-rule-copy span {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.health-truncated-warning {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--warning-soft);
  color: var(--warning);
  font-size: var(--app-font-xs);
}

@media (max-width: 720px) {
  .health-hero {
    grid-template-columns: 1fr;
  }

  .health-finding-top {
    flex-direction: column;
    align-items: stretch;
  }

  .health-finding-actions {
    justify-content: flex-end;
  }
}
</style>
