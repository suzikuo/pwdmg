import type { VaultPayload } from '../types'

export type PasskeyMetadataUpdate = {
  label: string
  entryId: string
}

const MAX_PASSKEY_LABEL_BYTES = 512
const MAX_ENTRY_ID_BYTES = 128
const UTF8_ENCODER = new TextEncoder()

export function updatePasskeyMetadata(
  payload: VaultPayload,
  passkeyId: string,
  update: PasskeyMetadataUpdate,
  updatedAt: number,
  validLoginIds?: ReadonlySet<string>
): boolean {
  const passkey = payload.passkeys.find((item) => item.id === passkeyId)
  if (!passkey) return false
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) throw new Error('更新时间无效')

  const label = boundedOptionalText(update.label, MAX_PASSKEY_LABEL_BYTES, '通行密钥名称')
  const entryId = boundedOptionalText(update.entryId, MAX_ENTRY_ID_BYTES, '登录项 ID')
  if (entryId && validLoginIds && !validLoginIds.has(entryId)) throw new Error('关联登录项无效')

  const currentLabel = passkey.label || ''
  const currentEntryId = passkey.entryId || ''
  if (currentLabel === label && currentEntryId === entryId) return false
  if (label) passkey.label = label
  else delete passkey.label
  if (entryId) passkey.entryId = entryId
  else delete passkey.entryId
  passkey.updatedAt = Math.max(passkey.createdAt, updatedAt)
  payload.version = 2
  payload.passkeySchemaVersion = 1
  return true
}

function boundedOptionalText(value: unknown, maxBytes: number, field: string): string {
  const text = String(value || '').trim()
  if (UTF8_ENCODER.encode(text).byteLength > maxBytes) throw new Error(`${field}过长`)
  return text
}

export function removePasskeyWithTombstone(
  payload: VaultPayload,
  passkeyId: string,
  deletedAt: number
): boolean {
  const index = payload.passkeys.findIndex((item) => item.id === passkeyId)
  if (index < 0) return false
  const passkey = payload.passkeys[index]
  if (!Number.isSafeInteger(deletedAt) || deletedAt <= 0) throw new Error('删除时间无效')
  if (payload.passkeyTombstones.some((item) => item.id === passkey.id || item.credentialId === passkey.credentialId)) {
    throw new Error('通行密钥墓碑冲突')
  }
  payload.passkeys.splice(index, 1)
  payload.passkeyTombstones.push({
    id: passkey.id,
    credentialId: passkey.credentialId,
    deletedAt
  })
  payload.version = 2
  payload.passkeySchemaVersion = 1
  return true
}
