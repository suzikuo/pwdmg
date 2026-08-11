<template>
  <header class="app-topbar">
    <button class="top-icon" type="button" aria-label="打开菜单" @click="emit('open-drawer')">
      <van-icon name="wap-nav" />
    </button>
    <div class="top-spacer"></div>
    <div class="top-actions">
      <button class="top-icon" type="button" :aria-label="searchActive ? '关闭搜索' : '搜索'" @click="emit('toggle-search')">
        <van-icon :name="searchActive ? 'cross' : 'search'" />
      </button>
      <van-popover
        :show="createMenuOpen"
        class="top-menu-popover top-create-popover"
        placement="bottom-end"
        :actions="createMenuActions"
        close-on-click-action
        close-on-click-outside
        @update:show="emit('update:create-menu-open', $event)"
        @select="emit('select-create', $event)"
      >
        <template #reference>
          <button class="top-icon top-menu-trigger" type="button" aria-label="新建" @click="emit('close-more-menu')">
            <span class="plus-glyph">+</span>
          </button>
        </template>
      </van-popover>
      <van-popover
        :show="moreMenuOpen"
        class="top-menu-popover top-more-popover"
        placement="bottom-end"
        :actions="moreActions"
        close-on-click-action
        close-on-click-outside
        @update:show="emit('update:more-menu-open', $event)"
        @select="emit('select-more', $event)"
      >
        <template #reference>
          <button class="top-icon top-menu-trigger" type="button" aria-label="更多" @click="emit('close-create-menu')">
            <van-icon name="ellipsis" />
          </button>
        </template>
      </van-popover>
    </div>
  </header>

  <div v-if="selectionMode" class="batch-mode-strip" role="toolbar" aria-label="批量操作">
    <button class="batch-mode-close" type="button" aria-label="退出选择" @click="emit('exit-selection')">
      <van-icon name="cross" />
    </button>
    <strong>已选 {{ selectionCount }}</strong>
    <div class="batch-mode-actions">
      <button type="button" @click="emit('toggle-select-all')">
        <van-icon :name="allVisibleSelected ? 'close' : 'passed'" />
        <span>{{ allVisibleSelected ? '全不选' : '全选' }}</span>
      </button>
      <button type="button" :disabled="selectionCount === 0" @click="emit('batch-move')">
        <van-icon name="location-o" /><span>移动</span>
      </button>
      <button type="button" :disabled="selectionCount === 0" @click="emit('batch-favorite')">
        <van-icon :name="allSelectedFavorite ? 'star' : 'star-o'" />
        <span>{{ allSelectedFavorite ? '取消收藏' : '收藏' }}</span>
      </button>
      <button type="button" :disabled="selectionCount === 0" @click="emit('batch-archive')">
        <van-icon name="certificate" /><span>归档</span>
      </button>
      <button class="is-danger" type="button" :disabled="selectionCount === 0" @click="emit('batch-trash')">
        <van-icon name="delete-o" /><span>回收站</span>
      </button>
    </div>
  </div>
  <div v-else-if="!dragMode" class="search-strip" :class="{ 'is-filter-only': !searchActive }">
    <van-search
      v-if="searchActive"
      ref="searchInput"
      :model-value="keyword"
      shape="round"
      placeholder="搜索标题、账号、域名、自定义字段"
      @update:model-value="emit('update:keyword', String($event))"
    />
    <div class="search-filter-segments" role="group" aria-label="条目筛选">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        :class="{ active: entryFilter === option.value }"
        :aria-pressed="entryFilter === option.value"
        @click="emit('update:entry-filter', option.value)"
      >
        <van-icon v-if="option.icon" :name="option.icon" />
        <span>{{ option.label }}</span>
      </button>
    </div>
  </div>
  <div v-if="dragMode" class="drag-mode-strip">
    <van-icon name="sort" />
    <span>拖拽模式：长按条目后移动</span>
    <button type="button" @click="emit('exit-drag')">退出</button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { EntryFilterMode } from '../../services/entryWorkspace.ts'
import type { EntryKind } from '../../types'

type WorkspaceAction = {
  text: string
  icon?: string
  key?: string
  color?: string
  kind?: EntryKind
}

const props = defineProps<{
  searchOpen: boolean
  keyword: string
  entryFilter: EntryFilterMode
  dragMode: boolean
  selectionMode: boolean
  selectionCount: number
  allVisibleSelected: boolean
  allSelectedFavorite: boolean
  createMenuOpen: boolean
  moreMenuOpen: boolean
  createMenuActions: WorkspaceAction[]
  moreActions: WorkspaceAction[]
}>()

const searchInput = ref<{ $el?: HTMLElement } | null>(null)
const searchActive = computed(() => props.searchOpen || Boolean(props.keyword) || props.entryFilter !== 'all')
const filterOptions: Array<{ label: string; value: EntryFilterMode; icon?: string }> = [
  { label: '全部', value: 'all', icon: 'apps-o' },
  { label: '收藏', value: 'favorites', icon: 'star-o' },
  { label: '最近', value: 'recent', icon: 'clock-o' },
  { label: '登录', value: 'login', icon: 'user-o' },
  { label: '其他', value: 'other', icon: 'label-o' },
  { label: 'TOTP', value: 'totp', icon: 'shield-o' },
  { label: '分组', value: 'folder', icon: 'cluster-o' }
]

watch(() => props.searchOpen, async (open) => {
  if (!open) return
  await nextTick()
  const input = searchInput.value?.$el?.querySelector('input') as HTMLInputElement | null
  input?.focus()
})

const emit = defineEmits<{
  'open-drawer': []
  'toggle-search': []
  'update:keyword': [value: string]
  'update:entry-filter': [value: EntryFilterMode]
  'update:create-menu-open': [value: boolean]
  'update:more-menu-open': [value: boolean]
  'select-create': [action: WorkspaceAction]
  'select-more': [action: WorkspaceAction]
  'close-create-menu': []
  'close-more-menu': []
  'exit-drag': []
  'exit-selection': []
  'toggle-select-all': []
  'batch-move': []
  'batch-favorite': []
  'batch-archive': []
  'batch-trash': []
}>()
</script>
