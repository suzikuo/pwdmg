<template>
  <DetailContent
    v-if="entry"
    :entry="entry"
    :show-password="showPassword"
    :password-mask="passwordMask"
    :totp-code="totpCode"
    :totp-remaining="totpRemaining"
    :totp-progress="totpProgress"
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
  />
</template>

<script setup lang="ts">
import DetailContent from '../DetailContent.vue'
import type { VaultEntry } from '../../types'

defineProps<{
  entry: VaultEntry | null
  showPassword: boolean
  passwordMask: string
  totpCode: string
  totpRemaining: number
  totpProgress: number
}>()

const emit = defineEmits<{
  edit: [entry: VaultEntry]
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
}>()
</script>
