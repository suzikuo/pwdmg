import { normalizeDeviceCheckpointBasis, type DeviceCheckpointBasis } from './deviceRemoteVault.ts'

const DATABASE_NAME = 'mypwdmg-sync-v1'
const DATABASE_VERSION = 2
const STORE_NAME = 'checkpoints'
const WRITER_STORE_NAME = 'device-writers'
const MAX_CHECKPOINT_ENVELOPE_LENGTH = 24 * 1024 * 1024
const SHA256_RE = /^[a-f0-9]{64}$/i

export type SyncCheckpoint = {
  key: string
  envelope: string
  payloadFingerprint: string
  remoteHeadIds: string[]
  deviceBasis?: DeviceCheckpointBasis
  recordedAt: number
}

export async function readSyncCheckpoint(key: string): Promise<SyncCheckpoint | null> {
  if (!globalThis.indexedDB) return null
  const database = await openDatabase()
  try {
    const raw = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key))
    return normalizeSyncCheckpoint(raw)
  } finally {
    database.close()
  }
}

export async function writeSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
  const normalized = normalizeSyncCheckpoint(checkpoint)
  if (!normalized) throw new Error('Invalid sync checkpoint')
  if (!globalThis.indexedDB) return
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(normalized)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

type SyncWriterState = {
  id: string
  phase: 'idle' | 'staging' | 'publishing' | 'uncertain'
  claimId?: string
  claimedAt?: number
  initializing?: boolean
}

export async function updateSyncWriterState(
  key: string,
  update: (previous: SyncWriterState | undefined) => SyncWriterState | undefined
): Promise<SyncWriterState | undefined> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(WRITER_STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    void done.catch(() => {})
    const records = transaction.objectStore(WRITER_STORE_NAME)
    const previous = await requestResult(records.get(key)) as SyncWriterState | undefined
    const next = update(previous)
    if (next !== undefined && next !== previous) records.put(next, key)
    await done
    return next
  } finally {
    database.close()
  }
}

export type { SyncWriterState }

export function normalizeSyncCheckpoint(value: unknown): SyncCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<SyncCheckpoint>
  const key = typeof item.key === 'string' ? item.key : ''
  const envelope = typeof item.envelope === 'string' ? item.envelope : ''
  const payloadFingerprint = typeof item.payloadFingerprint === 'string' ? item.payloadFingerprint : ''
  const recordedAt = Number(item.recordedAt || 0)
  if (!key || key.length > 4096) return null
  if (!envelope || envelope.length > MAX_CHECKPOINT_ENVELOPE_LENGTH) return null
  if (!SHA256_RE.test(payloadFingerprint)) return null
  if (!Number.isSafeInteger(recordedAt) || recordedAt <= 0) return null
  if (!Array.isArray(item.remoteHeadIds) || item.remoteHeadIds.some((id) => typeof id !== 'string' || id.length > 512)) {
    return null
  }
  const remoteHeadIds = [...new Set(item.remoteHeadIds)].sort()
  const deviceBasis = normalizeDeviceCheckpointBasis(item.deviceBasis, remoteHeadIds)
  return {
    key,
    envelope,
    payloadFingerprint: payloadFingerprint.toLowerCase(),
    remoteHeadIds,
    ...(deviceBasis ? { deviceBasis } : {}),
    recordedAt
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      if (!database.objectStoreNames.contains(WRITER_STORE_NAME)) database.createObjectStore(WRITER_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open sync checkpoint database'))
    request.onblocked = () => reject(new Error('Sync checkpoint database upgrade is blocked'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Sync checkpoint request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Sync checkpoint transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('Sync checkpoint transaction aborted'))
  })
}
