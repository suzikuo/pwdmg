import { RemoteVaultStatus, type RemoteVaultStore } from '../cloud/remoteVaultStore.ts'

export type RemoteObjectValidationResult = {
  ok: boolean
  message: string
}

export async function validateLegacyRemoteObjectRevision(
  store: RemoteVaultStore,
  objectName: string,
  expectedFingerprint: string,
  expectedExists: boolean
): Promise<RemoteObjectValidationResult> {
  const currentRemote = await store.readObject(objectName)
  if (!expectedExists) {
    if (currentRemote.status !== RemoteVaultStatus.NotFound) {
      return { ok: false, message: '云端文件在确认期间已创建，请重新检测同步差异' }
    }
    return { ok: true, message: '' }
  }
  if (currentRemote.status !== RemoteVaultStatus.Success || typeof currentRemote.content !== 'string') {
    return { ok: false, message: String(currentRemote.content || '无法重新读取云端保险库') }
  }
  const currentFingerprint = currentRemote.revision || await sha256Text(currentRemote.content)
  if (currentFingerprint !== expectedFingerprint) {
    return { ok: false, message: '云端保险库在确认期间已变化，请重新检测同步差异' }
  }
  return { ok: true, message: '' }
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
