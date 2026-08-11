<template>
  <DetailContent
    v-if="entry"
    :entry="entry"
    :show-password="showPassword"
    :password-mask="passwordMask"
    :totp-code="totpCode"
    :totp-remaining="totpRemaining"
    :totp-progress="totpProgress"
    :linked-passkeys="linkedPasskeys"
    :attachment-busy="attachmentBusy"
    :attachment-actions-supported="attachmentActionsSupported"
    @edit="emit('edit', $event)"
    @move="emit('move', $event)"
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
</template>

<script setup lang="ts">
import DetailContent from '../DetailContent.vue'
import type { VaultEntry } from '../../types'
import type { PasskeyPresentationItem } from '../../services/passkeyPresentation.ts'

defineProps<{
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
  'toggle-password': []
  'refresh-totp': []
  'open-passkey': [passkeyId: string]
  'unlink-passkey': [passkeyId: string]
  'add-attachment': [entryId: string, file: File]
  'save-attachment': [entryId: string, attachmentId: string]
  'remove-attachment': [entryId: string, attachmentId: string]
}>()
</script>
