import type { VaultPayload } from '../types'

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
