<template>
  <div ref="workspaceGrid" class="workspace-grid" :style="gridStyle">
    <section class="vault-pane">
      <div class="summary-strip">
        <div>
          <span>条目</span>
          <strong>{{ stats.items }}</strong>
        </div>
        <div>
          <span>分组</span>
          <strong>{{ stats.folders }}</strong>
        </div>
        <div>
          <span>TOTP</span>
          <strong>{{ stats.totp }}</strong>
        </div>
        <div>
          <span>归档</span>
          <strong>{{ stats.archived }}</strong>
        </div>
      </div>

      <EntryList
        :entries="entries"
        :selected-id="selectedEntry?.id || ''"
        :auto-expand="autoExpand"
        :draggable-enabled="draggableEnabled"
        :favorite-ids="favoriteIds"
        :selection-mode="selectionMode"
        :selected-ids="selectedIds"
        :depth="0"
        @view="emit('view', $event)"
        @edit="emit('edit', $event)"
        @move="emit('move', $event)"
        @duplicate="emit('duplicate', $event)"
        @delete="emit('delete', $event)"
        @create="emit('create', $event)"
        @move-entry="emit('move-entry', $event)"
        @context-menu="emit('context-menu', $event)"
        @toggle-favorite="emit('toggle-favorite', $event)"
        @toggle-selection="emit('toggle-selection', $event)"
      />
    </section>

    <div
      class="pane-resizer"
      role="separator"
      aria-label="调整列表宽度"
      aria-orientation="vertical"
      :aria-valuemin="paneWidthMin"
      :aria-valuemax="paneWidthMax"
      :aria-valuenow="paneWidth"
      tabindex="0"
      @keydown="emit('resize-keyboard', $event)"
      @pointerdown="emit('resize-pointer', $event)"
    ></div>

    <aside class="desktop-preview">
      <EntryDetailPane
        v-if="selectedEntry"
        :entry="selectedEntry"
        :show-password="showPassword"
        :password-mask="passwordMask"
        :totp-code="totpCode"
        :totp-remaining="totpRemaining"
        :totp-progress="totpProgress"
        :linked-passkeys="linkedPasskeys"
        :attachment-busy="attachmentBusy"
        :attachment-actions-supported="attachmentActionsSupported"
        @edit="emit('edit', $event)"
        @duplicate="emit('duplicate', $event)"
        @delete="emit('delete', $event)"
        @disable="emit('disable', $event)"
        @restore="emit('restore', $event)"
        @purge="emit('purge', $event)"
        @restore-history="(entryId, historyId) => emit('restore-history', entryId, historyId)"
        @clear-history="emit('clear-history', $event)"
        @copy="emit('copy', $event)"
        @toggle-password="emit('toggle-password')"
        @refresh-totp="emit('refresh-totp')"
        @open-passkey="emit('open-passkey', $event)"
        @unlink-passkey="emit('unlink-passkey', $event)"
        @add-attachment="(entryId, file) => emit('add-attachment', entryId, file)"
        @save-attachment="(entryId, attachmentId) => emit('save-attachment', entryId, attachmentId)"
        @remove-attachment="(entryId, attachmentId) => emit('remove-attachment', entryId, attachmentId)"
      />
      <van-empty v-else image="search" description="选择一个条目查看详情" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import EntryList from '../EntryList.vue'
import EntryDetailPane from './EntryDetailPane.vue'
import type { VaultEntry } from '../../types'
import type { PasskeyPresentationItem } from '../../services/passkeyPresentation.ts'

type WorkspaceStats = {
  items: number
  logins: number
  folders: number
  totp: number
  archived: number
}

defineProps<{
  entries: VaultEntry[]
  selectedEntry: VaultEntry | null
  stats: WorkspaceStats
  autoExpand: boolean
  draggableEnabled: boolean
  favoriteIds: ReadonlySet<string>
  selectionMode: boolean
  selectedIds: ReadonlySet<string>
  gridStyle: Record<string, string>
  paneWidth: number
  paneWidthMin: number
  paneWidthMax: number
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
  view: [entry: VaultEntry]
  edit: [entry: VaultEntry]
  move: [entryId: string]
  duplicate: [entryId: string]
  delete: [entryId: string]
  create: [parentId: string]
  'move-entry': [payload: { entryId: string; targetParentId: string; targetIndex: number }]
  'context-menu': [payload: { entry: VaultEntry; x: number; y: number }]
  'toggle-favorite': [entryId: string]
  'toggle-selection': [entryId: string]
  disable: [entryId: string]
  restore: [entryId: string]
  purge: [entryId: string]
  'restore-history': [entryId: string, historyId: string]
  'clear-history': [entryId: string]
  copy: [value: string]
  'toggle-password': []
  'refresh-totp': []
  'open-passkey': [passkeyId: string]
  'unlink-passkey': [passkeyId: string]
  'add-attachment': [entryId: string, file: File]
  'save-attachment': [entryId: string, attachmentId: string]
  'remove-attachment': [entryId: string, attachmentId: string]
  'resize-keyboard': [event: KeyboardEvent]
  'resize-pointer': [event: PointerEvent]
}>()
</script>
