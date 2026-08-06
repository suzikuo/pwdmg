import type { VaultPasskey, VaultPasskeyTombstone, VaultPayload, VaultPayloadVersion } from '../../types'
import { RemoteVaultStatus, type RemoteVaultResult } from '../cloud/remoteVaultStore.ts'
import { canonicalJson } from './canonicalJson.ts'

export const PASSKEY_VAULT_OBJECT_SUFFIX = '.passkeys-v2'

export type ResolvedPasskeyState = {
  status: 'same' | 'local' | 'remote' | 'conflict'
  version: VaultPayloadVersion
  passkeys: VaultPasskey[]
  passkeyTombstones: VaultPasskeyTombstone[]
  conflicts: PasskeyMergeConflict[]
}

export type PasskeyMergeConflict = {
  id: string
  field: string
  reason: 'concurrent-update' | 'delete-update' | 'identity-collision'
}

export function versionedVaultObjectName(configuredObjectName: string, version: VaultPayloadVersion): string {
  return version === 2 ? `${configuredObjectName}${PASSKEY_VAULT_OBJECT_SUFFIX}` : configuredObjectName
}

export function canonicalVaultReadCandidates(configuredObjectName: string, requestedObjectName: string): string[] {
  const v2ObjectName = versionedVaultObjectName(configuredObjectName, 2)
  if (requestedObjectName !== configuredObjectName && requestedObjectName !== v2ObjectName) {
    return [requestedObjectName]
  }
  return [v2ObjectName, configuredObjectName]
}

export async function loadPreferredVaultObject<T>(
  configuredObjectName: string,
  requestedObjectName: string,
  load: (objectName: string) => Promise<RemoteVaultResult<T>>
): Promise<{ objectName: string; response: RemoteVaultResult<T> }> {
  const candidates = canonicalVaultReadCandidates(configuredObjectName, requestedObjectName)
  let fallback: { objectName: string; response: RemoteVaultResult<T> } | null = null
  for (const objectName of candidates) {
    const response = await load(objectName)
    fallback = { objectName, response }
    if (response.status !== RemoteVaultStatus.NotFound) return fallback
  }
  return fallback as { objectName: string; response: RemoteVaultResult<T> }
}

export function resolvePasskeyState(
  local: VaultPayload,
  remote: VaultPayload,
  ancestor?: VaultPayload | null
): ResolvedPasskeyState {
  if (passkeyStateFingerprint(local) === passkeyStateFingerprint(remote)) {
    const preferred = local.version === 2 ? local : remote
    return stateFrom('same', preferred)
  }
  if (local.version === 2 && remote.version === 1) return stateFrom('local', local)
  if (local.version === 1 && remote.version === 2) return stateFrom('remote', remote)
  if (ancestor) return mergePasskeyState(ancestor, local, remote)
  return stateFrom('conflict', local)
}

export function applyResolvedPasskeyState(payload: VaultPayload, state: ResolvedPasskeyState): void {
  payload.version = state.version
  payload.passkeys = structuredCloneValue(state.passkeys)
  payload.passkeyTombstones = structuredCloneValue(state.passkeyTombstones)
}

export function passkeyStateFingerprint(payload: VaultPayload): string {
  return canonicalJson([
    payload.version,
    payload.passkeySchemaVersion ?? null,
    [...payload.passkeys]
      .map((item) => ({
        ...item,
        transports: Array.isArray(item.transports) ? [...item.transports].sort() : []
      }))
      .sort(compareIdentity),
    [...payload.passkeyTombstones].sort(compareIdentity)
  ])
}

export function mergePasskeyState(
  ancestor: VaultPayload,
  local: VaultPayload,
  remote: VaultPayload
): ResolvedPasskeyState {
  const baseStates = indexCredentialStates(ancestor)
  const localStates = indexCredentialStates(local)
  const remoteStates = indexCredentialStates(remote)
  const ids = new Set([...baseStates.keys(), ...localStates.keys(), ...remoteStates.keys()])
  const passkeys: VaultPasskey[] = []
  const passkeyTombstones: VaultPasskeyTombstone[] = []
  const conflicts: PasskeyMergeConflict[] = []

  for (const id of [...ids].sort()) {
    const base = baseStates.get(id)
    const left = localStates.get(id)
    const right = remoteStates.get(id)
    const merged = mergeCredentialState(id, base, left, right, conflicts)
    if (merged?.kind === 'live') passkeys.push(merged.value)
    if (merged?.kind === 'deleted') passkeyTombstones.push(merged.value)
  }

  const credentialOwners = new Map<string, string>()
  for (const state of [...passkeys, ...passkeyTombstones]) {
    const owner = credentialOwners.get(state.credentialId)
    if (owner && owner !== state.id) {
      conflicts.push({ id: state.id, field: 'credentialId', reason: 'identity-collision' })
    } else {
      credentialOwners.set(state.credentialId, state.id)
    }
  }

  const version: VaultPayloadVersion = (
    ancestor.version === 2 ||
    local.version === 2 ||
    remote.version === 2 ||
    passkeys.length > 0 ||
    passkeyTombstones.length > 0
  ) ? 2 : 1
  const mergedPayload = {
    ...local,
    version,
    passkeySchemaVersion: version === 2 ? 1 as const : undefined,
    passkeys,
    passkeyTombstones
  }
  const mergedFingerprint = passkeyStateFingerprint(mergedPayload)

  return {
    status: conflicts.length
      ? 'conflict'
      : passkeyStateFingerprint(local) === mergedFingerprint
        ? 'local'
        : passkeyStateFingerprint(remote) === mergedFingerprint
          ? 'remote'
          : 'same',
    version,
    passkeys: structuredCloneValue(passkeys),
    passkeyTombstones: structuredCloneValue(passkeyTombstones),
    conflicts
  }
}

type CredentialState =
  | { kind: 'live'; value: VaultPasskey }
  | { kind: 'deleted'; value: VaultPasskeyTombstone }

function indexCredentialStates(payload: VaultPayload): Map<string, CredentialState> {
  const states = new Map<string, CredentialState>()
  for (const passkey of payload.passkeys) states.set(passkey.id, { kind: 'live', value: passkey })
  for (const tombstone of payload.passkeyTombstones) states.set(tombstone.id, { kind: 'deleted', value: tombstone })
  return states
}

function mergeCredentialState(
  id: string,
  base: CredentialState | undefined,
  local: CredentialState | undefined,
  remote: CredentialState | undefined,
  conflicts: PasskeyMergeConflict[]
): CredentialState | undefined {
  if (sameState(local, remote)) return cloneState(local)
  if (sameState(local, base)) return cloneState(remote)
  if (sameState(remote, base)) return cloneState(local)

  if (local?.kind === 'live' && remote?.kind === 'live') {
    if (local.value.credentialId !== remote.value.credentialId) {
      conflicts.push({ id, field: 'credentialId', reason: 'identity-collision' })
      return cloneState(local)
    }
    const baseValue = base?.kind === 'live' ? base.value : undefined
    return { kind: 'live', value: mergeLiveCredential(id, baseValue, local.value, remote.value, conflicts) }
  }

  if (local?.kind === 'deleted' && remote?.kind === 'deleted') {
    return {
      kind: 'deleted',
      value: local.value.deletedAt >= remote.value.deletedAt
        ? structuredCloneValue(local.value)
        : structuredCloneValue(remote.value)
    }
  }

  const deleted = local?.kind === 'deleted' ? local : remote?.kind === 'deleted' ? remote : undefined
  const live = local?.kind === 'live' ? local : remote?.kind === 'live' ? remote : undefined
  if (deleted && live) {
    if (deleted.value.credentialId === live.value.credentialId && deleted.value.deletedAt >= live.value.updatedAt) {
      return cloneState(deleted)
    }
    conflicts.push({ id, field: '*', reason: 'delete-update' })
    return cloneState(live)
  }

  conflicts.push({ id, field: '*', reason: 'concurrent-update' })
  return cloneState(local || remote)
}

function mergeLiveCredential(
  id: string,
  base: VaultPasskey | undefined,
  local: VaultPasskey,
  remote: VaultPasskey,
  conflicts: PasskeyMergeConflict[]
): VaultPasskey {
  const result = structuredCloneValue(local) as unknown as Record<string, unknown>
  const left = local as unknown as Record<string, unknown>
  const right = remote as unknown as Record<string, unknown>
  const common = (base || {}) as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right), ...Object.keys(common)])

  for (const key of keys) {
    if (key === 'updatedAt') continue
    const baseValue = common[key]
    const localValue = left[key]
    const remoteValue = right[key]
    if (sameValue(localValue, remoteValue)) result[key] = structuredCloneValue(localValue)
    else if (sameValue(localValue, baseValue)) result[key] = structuredCloneValue(remoteValue)
    else if (sameValue(remoteValue, baseValue)) result[key] = structuredCloneValue(localValue)
    else {
      conflicts.push({ id, field: key, reason: 'concurrent-update' })
      result[key] = structuredCloneValue(localValue)
    }
  }
  result.updatedAt = Math.max(local.updatedAt, remote.updatedAt)
  return result as unknown as VaultPasskey
}

function sameState(left: CredentialState | undefined, right: CredentialState | undefined): boolean {
  return sameValue(left, right)
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left === undefined ? null : left) === canonicalJson(right === undefined ? null : right)
}

function cloneState(value: CredentialState | undefined): CredentialState | undefined {
  return value ? structuredCloneValue(value) : undefined
}

function compareIdentity(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

function stateFrom(status: ResolvedPasskeyState['status'], payload: VaultPayload): ResolvedPasskeyState {
  return {
    status,
    version: payload.version,
    passkeys: structuredCloneValue(payload.passkeys),
    passkeyTombstones: structuredCloneValue(payload.passkeyTombstones),
    conflicts: []
  }
}

function structuredCloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
