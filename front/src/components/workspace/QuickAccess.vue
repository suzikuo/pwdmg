<template>
  <Teleport to="body">
    <Transition name="qa-fade">
      <div
        v-if="open"
        class="qa-backdrop"
        @mousedown.self="closePalette"
      >
        <section
          class="qa-panel"
          role="dialog"
          aria-modal="true"
          aria-label="快速访问与命令面板"
          @keydown="handleKeydown"
        >
          <div class="qa-search-bar">
            <UiIcon name="search" :size="17" class="qa-search-icon" />
            <input
              ref="searchInput"
              v-model="keyword"
              type="search"
              class="qa-input"
              autocomplete="off"
              spellcheck="false"
              :placeholder="showCommands ? '搜索条目、账号、域名，或输入 > 运行指令…' : '搜索条目、账号、域名…'"
              aria-label="搜索条目或命令"
            />
            <button
              v-if="keyword"
              type="button"
              class="qa-clear-btn"
              aria-label="清空搜索"
              title="清空搜索"
              @click="clearKeyword"
            >
              <UiIcon name="close" :size="14" />
            </button>
            <button
              type="button"
              class="qa-esc-btn"
              aria-label="关闭"
              title="关闭 (Esc)"
              @click="closePalette"
            >
              <kbd>Esc</kbd>
            </button>
          </div>

          <div ref="resultList" class="qa-body" role="listbox">
            <template v-if="flatItems.length">
              <div v-if="entryResults.length" class="qa-section">
                <div class="qa-section-label">
                  <span>{{ keyword.trim() ? '匹配条目' : '常用条目' }}</span>
                  <span class="qa-section-count">{{ entryResults.length }}</span>
                </div>

                <div
                  v-for="(entry, idx) in entryResults"
                  :key="`entry-${entry.id}`"
                  :data-palette-index="idx"
                  class="qa-item"
                  :class="{ 'is-active': activeIndex === idx }"
                  role="option"
                  :aria-selected="activeIndex === idx"
                  @mouseenter="activeIndex = idx"
                >
                  <button
                    type="button"
                    class="qa-item-main"
                    @click="openEntry(entry)"
                  >
                    <span class="qa-item-avatar" :class="`is-${entry.kind}`" aria-hidden="true">
                      <UiIcon :name="resolveKindIcon(entry.kind)" :size="15" />
                    </span>
                    <span class="qa-item-copy">
                      <span class="qa-item-title-line">
                        <strong>{{ entry.title || '未命名条目' }}</strong>
                        <UiBadge v-if="entry.totpSecret" tone="success" size="sm">TOTP</UiBadge>
                      </span>
                      <small>{{ entrySummary(entry) }}</small>
                    </span>
                  </button>

                  <div class="qa-item-actions" @click.stop>
                    <button
                      v-if="primaryAccount(entry)"
                      type="button"
                      class="qa-action-btn"
                      aria-label="复制账号"
                      title="复制账号 (Shift+Enter)"
                      @click="copyAccount(entry)"
                    >
                      <UiIcon name="copy" :size="14" />
                    </button>
                    <button
                      v-if="entry.password"
                      type="button"
                      class="qa-action-btn is-primary"
                      aria-label="复制密码"
                      title="复制密码 (Enter)"
                      @click="copyPassword(entry)"
                    >
                      <UiIcon name="key" :size="14" />
                    </button>
                    <button
                      v-if="entry.totpSecret"
                      type="button"
                      class="qa-action-btn"
                      aria-label="复制 TOTP"
                      title="复制 TOTP"
                      @click="copyTotp(entry)"
                    >
                      <UiIcon name="clock" :size="14" />
                    </button>
                    <button
                      v-if="entry.domains?.[0]"
                      type="button"
                      class="qa-action-btn"
                      aria-label="打开网站"
                      title="打开网站 (Alt+Enter)"
                      @click="openWebsite(entry.domains[0])"
                    >
                      <UiIcon name="external-link" :size="14" />
                    </button>
                  </div>
                </div>
              </div>

              <div v-if="filteredCommands.length" class="qa-section">
                <div class="qa-section-label">
                  <span>快捷指令</span>
                  <span class="qa-section-count">{{ filteredCommands.length }}</span>
                </div>

                <div
                  v-for="(cmd, cmdIdx) in filteredCommands"
                  :key="`cmd-${cmd.key}`"
                  :data-palette-index="entryResults.length + cmdIdx"
                  class="qa-item qa-item--command"
                  :class="{ 'is-active': activeIndex === entryResults.length + cmdIdx }"
                  role="option"
                  :aria-selected="activeIndex === entryResults.length + cmdIdx"
                  @mouseenter="activeIndex = entryResults.length + cmdIdx"
                >
                  <button
                    type="button"
                    class="qa-item-main"
                    @click="triggerCommand(cmd.key)"
                  >
                    <span class="qa-item-avatar is-command" aria-hidden="true">
                      <UiIcon :name="cmd.icon" :size="15" />
                    </span>
                    <span class="qa-item-copy">
                      <span class="qa-item-title-line">
                        <strong>{{ cmd.label }}</strong>
                      </span>
                      <small>{{ cmd.hint }}</small>
                    </span>
                    <kbd v-if="cmd.shortcut" class="qa-cmd-shortcut">{{ cmd.shortcut }}</kbd>
                  </button>
                </div>
              </div>
            </template>

            <UiEmpty
              v-else
              icon="search"
              :title="showCommands ? '没有匹配的条目或指令' : '没有匹配的条目'"
              :description="showCommands ? '试试其他关键词，或输入 > 查看所有快捷指令。' : '试试其他关键词，支持标题、账号、域名或备注搜索。'"
            />
          </div>

          <footer v-if="showCommands" class="qa-footer" aria-hidden="true">
            <span class="qa-hint"><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span class="qa-hint"><kbd>Enter</kbd> 复制密码 / 执行</span>
            <span class="qa-hint"><kbd>Shift+Enter</kbd> 复制账号</span>
            <span class="qa-hint"><kbd>Alt+Enter</kbd> 打开网站</span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { UiBadge, UiEmpty, UiIcon } from '../ui'
import type { UiIconName } from '../ui'
import { entryKindLabel } from '../../services/entryKinds.ts'
import { searchQuickAccessEntries } from '../../services/quickAccess.ts'
import type { VaultSearchIndex } from '../../services/searchIndex.ts'
import type { EntryKind, VaultEntry } from '../../types'

type PaletteCommand = {
  key: string
  label: string
  hint: string
  icon: UiIconName
  keywords: string[]
  shortcut?: string
}

type FlatPaletteItem =
  | { type: 'entry'; entry: VaultEntry }
  | { type: 'command'; command: PaletteCommand }

const COMMANDS: PaletteCommand[] = [
  {
    key: 'create-login',
    label: '新建登录条目',
    hint: '创建新的账号、密码与 TOTP 记录',
    icon: 'plus',
    keywords: ['新建', '创建', '添加', '登录', 'new', 'create', 'add', 'login']
  },
  {
    key: 'generator',
    label: '密码生成器',
    hint: '生成高强度随机密码或易记口令',
    icon: 'wand',
    keywords: ['生成', '随机', '密码', '口令', 'generator', 'password']
  },
  {
    key: 'sync',
    label: '云同步',
    hint: '立即与云端存储同步最新保险库',
    icon: 'cloud',
    keywords: ['同步', '云', '上传', '下载', 'sync', 'cloud', 'oss']
  },
  {
    key: 'health',
    label: '密码健康检查',
    hint: '排查弱密码、复用密码与安全风险',
    icon: 'shield',
    keywords: ['健康', '安全', '弱密码', '检查', 'health', 'audit', 'security']
  },
  {
    key: 'import',
    label: '导入数据',
    hint: '从浏览器或其他密码管理器导入条目',
    icon: 'upload',
    keywords: ['导入', '迁移', 'csv', 'json', 'import']
  },
  {
    key: 'lock',
    label: '锁定保险库',
    hint: '立即锁定保险库并清除内存凭据',
    icon: 'lock',
    keywords: ['锁定', '退出', '安全', 'lock'],
    shortcut: 'Ctrl+L'
  }
]

const props = withDefaults(defineProps<{
  open: boolean
  entries: VaultEntry[]
  searchIndex?: VaultSearchIndex | null
  favoriteIds?: ReadonlySet<string>
  recentIds?: readonly string[]
  showCommands?: boolean
}>(), {
  searchIndex: null,
  favoriteIds: () => new Set<string>(),
  recentIds: () => [],
  showCommands: true
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
  'open-entry': [entry: VaultEntry]
  select: [entry: VaultEntry]
  copy: [value: string]
  'copy-password': [entryId: string]
  'copy-totp': [entry: VaultEntry]
  'open-website': [domain: string]
  'run-command': [commandKey: string]
}>()

const instance = getCurrentInstance()
const keyword = ref('')
const activeIndex = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)
const resultList = ref<HTMLElement | null>(null)

const isCommandOnlyQuery = computed(() => props.showCommands && keyword.value.trimStart().startsWith('>'))

const entryResults = computed<VaultEntry[]>(() => {
  if (isCommandOnlyQuery.value) return []
  const list = props.searchIndex?.quickAccess(keyword.value, {
    favoriteIds: props.favoriteIds,
    recentIds: props.recentIds
  }) || searchQuickAccessEntries(props.entries, keyword.value, {
    favoriteIds: props.favoriteIds,
    recentIds: props.recentIds
  })
  const limit = keyword.value.trim() ? 12 : 3
  return list.slice(0, limit)
})

const filteredCommands = computed<PaletteCommand[]>(() => {
  if (!props.showCommands) return []
  const raw = keyword.value.trim()
  if (!raw) return COMMANDS
  const query = (raw.startsWith('>') ? raw.slice(1) : raw).trim().toLowerCase()
  if (!query) return COMMANDS
  return COMMANDS.filter((cmd) => {
    if (cmd.label.toLowerCase().includes(query)) return true
    if (cmd.hint.toLowerCase().includes(query)) return true
    if (cmd.key.toLowerCase().includes(query)) return true
    return cmd.keywords.some((kw) => kw.toLowerCase().includes(query))
  })
})

const flatItems = computed<FlatPaletteItem[]>(() => [
  ...entryResults.value.map((entry) => ({ type: 'entry' as const, entry })),
  ...filteredCommands.value.map((command) => ({ type: 'command' as const, command }))
])

function closePalette() {
  emit('update:open', false)
  emit('close')
}

function clearKeyword() {
  keyword.value = ''
  nextTick(() => searchInput.value?.focus())
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape' && !event.defaultPrevented) {
    event.preventDefault()
    event.stopPropagation()
    closePalette()
  }
}

watch(() => props.open, async (open) => {
  if (typeof window !== 'undefined') {
    if (open) {
      window.addEventListener('keydown', handleGlobalKeydown)
    } else {
      window.removeEventListener('keydown', handleGlobalKeydown)
    }
  }
  if (!open) return
  keyword.value = ''
  activeIndex.value = 0
  await nextTick()
  searchInput.value?.focus()
}, { immediate: true })

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown)
  }
})

watch(flatItems, () => {
  if (flatItems.value.length === 0) {
    activeIndex.value = 0
    return
  }
  if (activeIndex.value >= flatItems.value.length) {
    activeIndex.value = 0
  }
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closePalette()
    return
  }

  const total = flatItems.value.length
  if (total === 0) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + direction + total) % total
    nextTick(() => scrollActiveResultIntoView())
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const current = flatItems.value[activeIndex.value]
    if (!current) return

    if (current.type === 'command') {
      triggerCommand(current.command.key)
      return
    }

    const entry = current.entry
    if (event.altKey && entry.domains?.[0]) {
      openWebsite(entry.domains[0])
      return
    }
    if (event.shiftKey) {
      const account = primaryAccount(entry)
      if (account) {
        copyAccount(entry)
        return
      }
    }
    if (entry.password) {
      copyPassword(entry)
      return
    }
    openEntry(entry)
  }
}

function scrollActiveResultIntoView() {
  resultList.value
    ?.querySelector<HTMLElement>(`[data-palette-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function openEntry(entry: VaultEntry) {
  emit('open-entry', entry)
  emit('select', entry)
  closePalette()
}

function copyAccount(entry: VaultEntry) {
  const account = primaryAccount(entry)
  if (!account) return
  emit('copy', account)
  closePalette()
}

function copyPassword(entry: VaultEntry) {
  if (!entry.password) return
  const hasCopyPasswordListener = Boolean(instance?.vnode.props?.onCopyPassword)
  if (hasCopyPasswordListener) {
    emit('copy-password', entry.id)
  } else {
    emit('copy', entry.password)
  }
  closePalette()
}

function copyTotp(entry: VaultEntry) {
  emit('copy-totp', entry)
  closePalette()
}

function openWebsite(domain: string) {
  emit('open-website', domain)
  closePalette()
}

function triggerCommand(commandKey: string) {
  emit('run-command', commandKey)
  closePalette()
}

function primaryAccount(entry: VaultEntry) {
  return entry.username || entry.email || entry.phone || ''
}

function resolveKindIcon(kind: EntryKind): UiIconName {
  if (kind === 'folder') return 'folder'
  if (kind === 'login') return 'key'
  if (kind === 'secure-note') return 'edit'
  if (kind === 'card') return 'lock'
  if (kind === 'identity') return 'info'
  if (kind === 'api-key') return 'command'
  return 'key'
}

function entrySummary(entry: VaultEntry) {
  if (entry.kind === 'login') {
    const parts = [primaryAccount(entry), entry.domains?.[0]].filter(Boolean)
    return parts.length ? parts.join(' · ') : '未设置账号或域名'
  }
  return entryKindLabel(entry.kind)
}
</script>

<style scoped>
.qa-backdrop {
  position: fixed;
  inset: var(--desktop-titlebar-height, 0px) 0 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: min(12vh, 96px) 16px 24px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(6px);
}

.qa-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 600px;
  max-height: min(72vh, 560px);
  max-height: min(72dvh, 560px);
  background-color: var(--surface-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  color: var(--text-main);
}

.qa-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.qa-search-icon {
  color: var(--brand);
  flex-shrink: 0;
}

.qa-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-main);
  font-size: var(--app-font-md);
  line-height: 1.4;
  outline: none;
}

.qa-input::placeholder {
  color: var(--text-muted);
}

.qa-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.qa-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.qa-clear-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.qa-esc-btn {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.qa-esc-btn kbd {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-muted);
  font-size: 11px;
}

.qa-esc-btn:hover kbd {
  color: var(--text-main);
  border-color: var(--border-strong);
}

/* Results body */
.qa-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qa-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qa-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-muted);
}

.qa-section-count {
  font-variant-numeric: tabular-nums;
}

.qa-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.qa-item.is-active {
  background-color: var(--brand-soft);
}

.qa-item-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.qa-item-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.qa-item-avatar.is-command {
  background-color: var(--surface-container);
  color: var(--text-secondary);
}

.qa-item.is-active .qa-item-avatar {
  background-color: var(--panel-bg);
  border-color: var(--border-strong);
  color: var(--brand);
}

.qa-item.is-active .qa-item-avatar.is-command {
  background-color: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
}

.qa-item-avatar.is-secure-note,
.qa-item-avatar.is-card,
.qa-item-avatar.is-identity,
.qa-item-avatar.is-api-key {
  background-color: var(--surface-container);
  color: var(--text-secondary);
}

.qa-item-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qa-item-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.qa-item-title-line strong {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qa-item-copy small {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qa-cmd-shortcut {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.qa-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.qa-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
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

.qa-action-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.qa-action-btn.is-primary {
  color: var(--brand);
}

.qa-action-btn.is-primary:hover {
  background-color: var(--brand);
  color: var(--on-brand);
}

/* Footer hints */
.qa-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.qa-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.qa-hint kbd {
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  color: var(--text-secondary);
  font-size: 10px;
}

/* Transitions */
.qa-fade-enter-active,
.qa-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.qa-fade-enter-active .qa-panel,
.qa-fade-leave-active .qa-panel {
  transition:
    transform var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.qa-fade-enter-from,
.qa-fade-leave-to {
  opacity: 0;
}

.qa-fade-enter-from .qa-panel,
.qa-fade-leave-to .qa-panel {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@media (max-width: 639px) {
  .qa-backdrop {
    padding: 16px 10px;
  }

  .qa-footer {
    display: none;
  }
}
</style>
