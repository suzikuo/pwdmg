import type { VaultEntry, VaultEntrySnapshot } from '../types'

const OPTIONAL_SNAPSHOT_FIELDS: Array<keyof VaultEntrySnapshot> = [
  'status', 'statusReason', 'statusUpdatedAt', 'deletedAt', 'username', 'email',
  'password', 'phone', 'loginAccountSource', 'note', 'totpSecret'
]

export function createEntrySnapshot(entry: VaultEntry): VaultEntrySnapshot {
  const copy = JSON.parse(JSON.stringify(entry)) as VaultEntry
  delete copy.history
  delete copy.children
  return copy as VaultEntrySnapshot
}

export function restoreEntrySnapshot(entry: VaultEntry, snapshot: VaultEntrySnapshot): void {
  for (const field of OPTIONAL_SNAPSHOT_FIELDS) {
    if (!(field in snapshot)) delete entry[field]
  }
  entry.title = snapshot.title
  entry.domains = [...(snapshot.domains || [])]
  for (const field of OPTIONAL_SNAPSHOT_FIELDS) {
    if (field in snapshot) (entry as unknown as Record<string, unknown>)[field] = snapshot[field]
  }
}
