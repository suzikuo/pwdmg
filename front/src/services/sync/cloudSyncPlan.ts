import type { VaultPayload } from '../../types.ts'
import { buildCloudSyncDiff, type CloudSyncDiffItem, type CloudSyncDirection } from './legacyDiff.ts'
import { resolvePasskeyState, type ResolvedPasskeyState } from './passkeyRemoteGate.ts'
import { mergeVaultPayloads } from './threeWayVaultMerge.ts'

export type CloudSyncPlan = {
  direction: CloudSyncDirection
  sourcePayload: VaultPayload
  basePayload: VaultPayload
  items: CloudSyncDiffItem[]
  resolvedPasskeyState: ResolvedPasskeyState
  usedAncestor: boolean
  localChangedSinceBase: boolean
  remoteChangedSinceBase: boolean
  targetNeedsWrite: boolean
}

export type CloudSyncPlanResult =
  | { ok: true; plan: CloudSyncPlan }
  | { ok: false; code: 'conflict' | 'pull-required'; message: string }

export type CloudPullStrategy = 'snapshot' | 'integrate'

export function hasLocalCloudChanges(input: {
  localFingerprint: string
  remoteFingerprint: string
  checkpointLocalFingerprint?: string
  localUpdatedAt: number
  remoteUpdatedAt: number
}) {
  if (input.localFingerprint === input.remoteFingerprint) return false
  if (input.checkpointLocalFingerprint) {
    return input.localFingerprint !== input.checkpointLocalFingerprint
  }
  return input.localUpdatedAt > 0 && (
    input.remoteUpdatedAt <= 0 || input.localUpdatedAt > input.remoteUpdatedAt
  )
}

export async function createCloudSyncPlan(input: {
  requestedDirection: CloudSyncDirection
  localPayload: VaultPayload
  remotePayload: VaultPayload
  ancestorPayload: VaultPayload | null
  pullStrategy?: CloudPullStrategy
  fingerprint: (payload: VaultPayload) => Promise<string>
}): Promise<CloudSyncPlanResult> {
  const {
    requestedDirection,
    localPayload,
    remotePayload,
    ancestorPayload,
    pullStrategy = 'snapshot',
    fingerprint
  } = input
  let convergedPayload: VaultPayload | null = null
  let localChangedSinceBase = false
  let remoteChangedSinceBase = false

  if (ancestorPayload) {
    const [ancestorFingerprint, localFingerprint, remoteFingerprint] = await Promise.all([
      fingerprint(ancestorPayload),
      fingerprint(localPayload),
      fingerprint(remotePayload)
    ])
    localChangedSinceBase = localFingerprint !== ancestorFingerprint
    remoteChangedSinceBase = remoteFingerprint !== ancestorFingerprint
    if (requestedDirection === 'upload' && remoteChangedSinceBase && localFingerprint !== remoteFingerprint) {
      return {
        ok: false,
        code: 'pull-required',
        message: '云端已在上次同步后发生变化，请先下载校验，再重新上传'
      }
    }

    if (requestedDirection === 'download' && pullStrategy === 'integrate') {
      const merged = mergeVaultPayloads(ancestorPayload, localPayload, remotePayload)
      if (merged.conflicts.length) {
        return {
          ok: false,
          code: 'conflict',
          message: `检测到 ${merged.conflicts.length} 项真实三方冲突，已停止自动覆盖`
        }
      }
      convergedPayload = merged.payload
    }
  }

  const direction = requestedDirection
  const sourcePayload = convergedPayload || (direction === 'download' ? remotePayload : localPayload)
  const basePayload = direction === 'download' ? localPayload : remotePayload
  const passkeyTargetPayload = convergedPayload || remotePayload
  const resolvedPasskeyState = resolvePasskeyState(localPayload, passkeyTargetPayload, ancestorPayload)
  if (resolvedPasskeyState.status === 'conflict') {
    return {
      ok: false,
      code: 'conflict',
      message: '两端通行密钥状态均已变化且缺少可验证共同祖先，已停止同步'
    }
  }

  const items = buildCloudSyncDiff(sourcePayload, basePayload)
  const plannedPayload = {
    ...sourcePayload,
    version: resolvedPasskeyState.version,
    passkeySchemaVersion: resolvedPasskeyState.version === 2 ? 1 as const : undefined,
    passkeys: resolvedPasskeyState.passkeys,
    passkeyTombstones: resolvedPasskeyState.passkeyTombstones
  }
  const targetNeedsWrite = await fingerprint(plannedPayload) !== await fingerprint(basePayload)

  return {
    ok: true,
    plan: {
      direction,
      sourcePayload,
      basePayload,
      items,
      resolvedPasskeyState,
      usedAncestor: Boolean(ancestorPayload),
      localChangedSinceBase,
      remoteChangedSinceBase,
      targetNeedsWrite
    }
  }
}
