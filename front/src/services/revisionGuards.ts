export function readPersistedRevision(value: unknown, exists = true): number {
  if (!exists) return 0
  const revision = Number((value as { revision?: unknown } | null | undefined)?.revision ?? 1)
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Vault revision metadata is invalid')
  }
  return revision
}

export function requireCurrentRevision(value: unknown, exists: boolean, expectedRevision: number): number {
  const currentRevision = readPersistedRevision(value, exists)
  if (currentRevision !== expectedRevision) throw new Error('Vault revision conflict; reload before replacing')
  return currentRevision
}

export function requireNextRevision(value: unknown, currentRevision: number): number {
  const nextRevision = readPersistedRevision(value)
  if (nextRevision !== currentRevision + 1) throw new Error('Vault revision must advance by exactly one')
  return nextRevision
}
