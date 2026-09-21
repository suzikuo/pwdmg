<template>
  <van-popup
    :show="open"
    position="bottom"
    class="cloud-sync-popup"
    :duration="0.14"
    :close-on-click-overlay="false"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <section v-if="preview" class="cloud-sync-shell">
      <van-nav-bar safe-area-inset-top :title="title" left-arrow @click-left="emit('close')" />
      <div class="cloud-sync-body">
        <div class="cloud-sync-target">
          <span>{{ preview.direction === 'download' ? '云端到本机' : '本机到云端' }}</span>
          <strong>{{ preview.objectName }}</strong>
        </div>
        <div class="cloud-sync-summary">
          <div><span>新增</span><strong>{{ diffCounts.added }}</strong></div>
          <div><span>修改</span><strong>{{ diffCounts.modified }}</strong></div>
          <div><span>删除</span><strong>{{ diffCounts.deleted }}</strong></div>
        </div>
        <div class="cloud-sync-actions">
          <van-button size="small" plain type="default" @click="emit('select-all', true)">全选</van-button>
          <van-button size="small" plain type="default" @click="emit('select-all', false)">全不选</van-button>
          <van-button size="small" plain type="danger" @click="emit('discard')">放弃本次</van-button>
        </div>
        <div v-if="preview.items.length" class="cloud-sync-list">
          <article
            v-for="item in preview.items"
            :key="`${item.changeType}:${item.id}`"
            class="cloud-sync-item"
            :class="`is-${item.changeType}`"
          >
            <div class="cloud-sync-item-head" role="checkbox" :aria-checked="isItemChecked(item)" @click="toggleItem(item)">
              <input :checked="isItemChecked(item)" type="checkbox" @click.stop.prevent="toggleItem(item)" />
              <span class="cloud-sync-tag">{{ changeLabel(item.changeType) }}</span>
              <span class="cloud-sync-copy">
                <strong>{{ item.path }}</strong>
                <small>{{ itemSummary(item) }}</small>
              </span>
            </div>
            <div v-if="item.changeType === 'modified' && item.details.length" class="cloud-sync-field-list">
              <div v-for="detail in item.details" :key="detail.key" class="cloud-sync-field" role="checkbox" :aria-checked="detail.checked" @click="toggleDetail(item, detail)">
                <input :checked="detail.checked" type="checkbox" @click.stop.prevent="toggleDetail(item, detail)" />
                <span class="cloud-sync-field-copy">
                  <strong>{{ detail.label }}</strong>
                  <small>
                    <em>{{ preview.direction === 'download' ? '云端' : '本机' }}</em>
                    <b>{{ detail.sourceText }}</b>
                  </small>
                  <small>
                    <em>{{ preview.direction === 'download' ? '本机' : '云端' }}</em>
                    <b>{{ detail.baseText }}</b>
                  </small>
                </span>
              </div>
            </div>
          </article>
        </div>
        <van-empty v-else image="search" description="两端条目一致" />
      </div>
      <div class="cloud-sync-footer">
        <span>已选 {{ selectedCount }} 处</span>
        <van-button size="small" type="primary" :disabled="selectedCount === 0" :loading="busy" @click="emit('apply')">
          {{ actionText }}
        </van-button>
      </div>
    </section>
  </van-popup>
</template>

<script setup lang="ts">
import type { CloudSyncChangeDetail, CloudSyncDiffItem, CloudSyncPreview } from '../../services/sync/legacyDiff'

const props = defineProps<{
  open: boolean
  preview: CloudSyncPreview | null
  title: string
  diffCounts: { added: number; modified: number; deleted: number }
  selectedCount: number
  actionText: string
  busy: boolean
  isItemChecked: (item: CloudSyncDiffItem) => boolean
  changeLabel: (changeType: CloudSyncDiffItem['changeType']) => string
  itemSummary: (item: CloudSyncDiffItem) => string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
  'select-all': [checked: boolean]
  discard: []
  'item-checked': [item: CloudSyncDiffItem, checked: boolean]
  'detail-checked': [item: CloudSyncDiffItem, detail: CloudSyncChangeDetail, checked: boolean]
  apply: []
}>()

function toggleItem(item: CloudSyncDiffItem) {
  const nextChecked = !props.isItemChecked(item)
  emit('item-checked', item, nextChecked)
}

function toggleDetail(item: CloudSyncDiffItem, detail: CloudSyncChangeDetail) {
  emit('detail-checked', item, detail, !detail.checked)
}
</script>
