<template>
  <van-popup
    :show="open"
    round
    class="quick-access-popup"
    :close-on-click-overlay="true"
    @update:show="emit('update:open', $event)"
  >
    <section class="quick-access-panel" aria-label="快速访问" @keydown="handleKeydown">
      <div class="quick-access-search">
        <van-icon name="search" />
        <input
          ref="searchInput"
          v-model="keyword"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="搜索条目、账号或域名"
          aria-label="搜索条目"
        />
        <button v-if="keyword" type="button" aria-label="清空搜索" title="清空搜索" @click="keyword = ''">
          <van-icon name="cross" />
        </button>
        <button type="button" aria-label="关闭" title="关闭" @click="emit('update:open', false)">
          <van-icon name="close" />
        </button>
      </div>

      <div v-if="results.length" ref="resultList" class="quick-access-results" role="listbox">
        <div
          v-for="(entry, index) in results"
          :key="entry.id"
          class="quick-access-result"
          :class="{ 'is-active': index === activeIndex }"
          role="option"
          :aria-selected="index === activeIndex"
          @mouseenter="activeIndex = index"
        >
          <button class="quick-access-result-main" type="button" @click="openEntry(entry)">
            <span class="quick-access-kind"><van-icon :name="entryKindIcon(entry.kind)" /></span>
            <span class="quick-access-copy">
              <strong>{{ entry.title || '未命名条目' }}</strong>
              <small>{{ entrySummary(entry) }}</small>
            </span>
            <van-icon name="arrow" />
          </button>
          <div class="quick-access-actions">
            <button
              v-if="primaryAccount(entry)"
              type="button"
              aria-label="复制账号"
              title="复制账号"
              @click="emit('copy', primaryAccount(entry))"
            ><van-icon name="contact-o" /></button>
            <button
              v-if="entry.password"
              type="button"
              aria-label="复制密码"
              title="复制密码"
              @click="emit('copy', entry.password)"
            ><van-icon name="lock" /></button>
            <button
              v-if="entry.totpSecret"
              type="button"
              aria-label="复制 TOTP"
              title="复制 TOTP"
              @click="emit('copy-totp', entry)"
            ><van-icon name="clock-o" /></button>
            <button
              v-if="entry.domains?.[0]"
              type="button"
              aria-label="打开网站"
              title="打开网站"
              @click="emit('open-website', entry.domains[0])"
            ><van-icon name="link-o" /></button>
          </div>
        </div>
      </div>
      <van-empty v-else image="search" description="没有匹配的条目" />
    </section>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { entryKindIcon, entryKindLabel } from '../../services/entryKinds.ts'
import { searchQuickAccessEntries } from '../../services/quickAccess.ts'
import type { VaultSearchIndex } from '../../services/searchIndex.ts'
import type { VaultEntry } from '../../types'

const props = defineProps<{
  open: boolean
  entries: VaultEntry[]
  searchIndex: VaultSearchIndex | null
  favoriteIds: ReadonlySet<string>
  recentIds: readonly string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'open-entry': [entry: VaultEntry]
  copy: [value: string]
  'copy-totp': [entry: VaultEntry]
  'open-website': [domain: string]
}>()

const keyword = ref('')
const activeIndex = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)
const resultList = ref<HTMLElement | null>(null)
const results = computed(() => props.searchIndex?.quickAccess(keyword.value, {
  favoriteIds: props.favoriteIds,
  recentIds: props.recentIds
}) || searchQuickAccessEntries(props.entries, keyword.value, {
  favoriteIds: props.favoriteIds,
  recentIds: props.recentIds
}))

watch(() => props.open, async (open) => {
  if (!open) return
  keyword.value = ''
  activeIndex.value = 0
  await nextTick()
  searchInput.value?.focus()
})

watch(results, () => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(0, results.value.length - 1))
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('update:open', false)
    return
  }
  if (!results.value.length) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + direction + results.value.length) % results.value.length
    nextTick(() => scrollActiveResultIntoView())
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    openEntry(results.value[activeIndex.value])
  }
}

function scrollActiveResultIntoView() {
  resultList.value
    ?.querySelector<HTMLElement>(`.quick-access-result:nth-child(${activeIndex.value + 1})`)
    ?.scrollIntoView({ block: 'nearest' })
}

function openEntry(entry?: VaultEntry) {
  if (entry) emit('open-entry', entry)
}

function primaryAccount(entry: VaultEntry) {
  return entry.username || entry.email || entry.phone || ''
}

function entrySummary(entry: VaultEntry) {
  if (entry.kind === 'login') {
    return [primaryAccount(entry) || '未设置账号', entry.domains?.[0] || '未设置域名'].join(' · ')
  }
  return entryKindLabel(entry.kind)
}
</script>
