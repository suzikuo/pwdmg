import type { ApiResult, VaultAttachment, VaultEntry, VaultPayload } from '../../types'
import { verifyAttachmentCiphertext } from '../attachmentCrypto.ts'
import { normalizeObjectName } from '../aliyunOss.ts'
import { RemoteVaultStatus, type RemoteVaultStore } from '../cloud/remoteVaultStore.ts'

const MAX_ATTACHMENT_OBJECT_TEXT_BYTES = 14 * 1024 * 1024 + 2048

export type LocalAttachmentObjectApi = {
  readAttachmentCiphertext: (reference: VaultAttachment) => Promise<ApiResult<string>>
  writeAttachmentCiphertext: (reference: VaultAttachment, objectText: string) => Promise<ApiResult<null>>
}

export async function ensureLocalAttachmentObjects(
  remote: RemoteVaultStore,
  vaultObjectName: string,
  payload: VaultPayload,
  local: LocalAttachmentObjectApi
) {
  const references = collectAttachmentReferences(payload.entries)
  for (const reference of references) {
    const localResult = await local.readAttachmentCiphertext(reference)
    if (localResult.ok && localResult.data) continue
    const objectName = attachmentRemoteObjectName(vaultObjectName, reference.id)
    const remoteResult = await remote.readObject(objectName, MAX_ATTACHMENT_OBJECT_TEXT_BYTES)
    if (remoteResult.status !== RemoteVaultStatus.Success || typeof remoteResult.content !== 'string') {
      throw new Error(`云端缺少附件对象：${reference.name}`)
    }
    await verifyAttachmentCiphertext(reference, remoteResult.content)
    const writeResult = await local.writeAttachmentCiphertext(reference, remoteResult.content)
    if (!writeResult.ok) throw new Error(writeResult.message || `附件写入失败：${reference.name}`)
  }
  return references.length
}

export async function ensureRemoteAttachmentObjects(
  remote: RemoteVaultStore,
  vaultObjectName: string,
  payload: VaultPayload,
  local: LocalAttachmentObjectApi
) {
  const references = collectAttachmentReferences(payload.entries)
  for (const reference of references) {
    let localResult = await local.readAttachmentCiphertext(reference)
    if (!localResult.ok || !localResult.data) {
      await ensureLocalAttachmentObjects(remote, vaultObjectName, { ...payload, entries: entriesForAttachment(payload.entries, reference.id) }, local)
      localResult = await local.readAttachmentCiphertext(reference)
    }
    if (!localResult.ok || !localResult.data) throw new Error(localResult.message || `本地缺少附件对象：${reference.name}`)
    const objectName = attachmentRemoteObjectName(vaultObjectName, reference.id)
    const writeResult = await remote.writeObject(objectName, localResult.data, 'application/json', { forbidOverwrite: true })
    if (writeResult.status === RemoteVaultStatus.Success) continue
    if (writeResult.status !== RemoteVaultStatus.Conflict) {
      throw new Error(String(writeResult.content || `附件上传失败：${reference.name}`))
    }
    const existing = await remote.readObject(objectName, MAX_ATTACHMENT_OBJECT_TEXT_BYTES)
    if (existing.status !== RemoteVaultStatus.Success || typeof existing.content !== 'string') {
      throw new Error(`无法验证已存在的云端附件：${reference.name}`)
    }
    await verifyAttachmentCiphertext(reference, existing.content)
  }
  return references.length
}

export function collectAttachmentReferences(entries: VaultEntry[]) {
  const references = new Map<string, VaultAttachment>()
  const visit = (items: VaultEntry[]) => {
    for (const entry of items) {
      for (const reference of entry.attachments || []) {
        const previous = references.get(reference.id)
        if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) {
          throw new Error(`附件引用冲突：${reference.name}`)
        }
        references.set(reference.id, reference)
      }
      visit(entry.children || [])
    }
  }
  visit(entries)
  return [...references.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function attachmentRemoteObjectName(vaultObjectName: string, attachmentId: string) {
  return `${normalizeObjectName(vaultObjectName)}.attachments/v1/${attachmentId}.json`
}

function entriesForAttachment(entries: VaultEntry[], attachmentId: string): VaultEntry[] {
  return [{
    id: `attachment-sync-${attachmentId}`,
    kind: 'secure-note',
    title: 'Attachment sync',
    domains: [],
    attachments: collectAttachmentReferences(entries).filter((item) => item.id === attachmentId)
  }]
}
