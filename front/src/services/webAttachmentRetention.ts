import { MAX_ATTACHMENT_OBJECT_BYTES, validateAttachmentId } from './attachmentCrypto.ts'

export const WEB_ATTACHMENT_ORPHAN_GRACE_SECONDS = 24 * 60 * 60
export const WEB_ATTACHMENT_RETAIN_SECONDS = 7 * 24 * 60 * 60

export type WebAttachmentManifestItem = {
  objectBytes: number
  retained: boolean
  createdAt?: number
  deletedAt?: number
}

export type WebAttachmentManifest = Record<string, WebAttachmentManifestItem>

export type WebAttachmentCollectionPlan = {
  manifest: WebAttachmentManifest
  restoreIds: string[]
  retainIds: string[]
  deleteIds: string[]
}

export function normalizeWebAttachmentManifest(value: unknown): WebAttachmentManifest {
  if (value === null || value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Attachment manifest is malformed')

  const normalized: WebAttachmentManifest = {}
  for (const [rawId, rawItem] of Object.entries(value)) {
    const id = validateAttachmentId(rawId)
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error('Attachment manifest is malformed')
    const item = rawItem as Record<string, unknown>
    const objectBytes = Number(item.objectBytes)
    if (!Number.isSafeInteger(objectBytes) || objectBytes < 1 || objectBytes > MAX_ATTACHMENT_OBJECT_BYTES) {
      throw new Error('Attachment manifest size is invalid')
    }
    if (typeof item.retained !== 'boolean') throw new Error('Attachment manifest is malformed')

    normalized[id] = {
      objectBytes,
      retained: item.retained,
      ...optionalTimestamp('createdAt', item.createdAt),
      ...optionalTimestamp('deletedAt', item.deletedAt)
    }
  }
  return normalized
}

export function planWebAttachmentCollection(
  manifestValue: unknown,
  referencedValues: string[],
  nowSeconds = Math.floor(Date.now() / 1000)
): WebAttachmentCollectionPlan {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1) throw new Error('Attachment collection timestamp is invalid')
  if (!Array.isArray(referencedValues)) throw new Error('Attachment references are invalid')
  const referenced = new Set(referencedValues.map(validateAttachmentId))
  const manifest = normalizeWebAttachmentManifest(manifestValue)
  const restoreIds: string[] = []
  const retainIds: string[] = []
  const deleteIds: string[] = []

  for (const [id, item] of Object.entries(manifest)) {
    if (referenced.has(id)) {
      if (item.retained) {
        restoreIds.push(id)
        manifest[id] = { ...item, retained: false, createdAt: item.createdAt || nowSeconds }
        delete manifest[id].deletedAt
      } else if (!item.createdAt) {
        manifest[id] = { ...item, createdAt: nowSeconds }
      }
      continue
    }

    if (item.retained) {
      if (!item.deletedAt) {
        manifest[id] = { ...item, deletedAt: nowSeconds }
      } else if (nowSeconds - item.deletedAt >= WEB_ATTACHMENT_RETAIN_SECONDS) {
        deleteIds.push(id)
        delete manifest[id]
      }
      continue
    }

    if (!item.createdAt) {
      manifest[id] = { ...item, createdAt: nowSeconds }
    } else if (nowSeconds - item.createdAt >= WEB_ATTACHMENT_ORPHAN_GRACE_SECONDS) {
      retainIds.push(id)
      manifest[id] = { ...item, retained: true, deletedAt: nowSeconds }
    }
  }

  return { manifest, restoreIds, retainIds, deleteIds }
}

function optionalTimestamp(key: 'createdAt' | 'deletedAt', value: unknown) {
  if (value === undefined) return {}
  const timestamp = Number(value)
  if (!Number.isSafeInteger(timestamp) || timestamp < 1) throw new Error(`Attachment manifest ${key} is invalid`)
  return { [key]: timestamp }
}
