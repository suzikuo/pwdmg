import type { RemoteVaultStore } from '../cloud/remoteVaultStore.ts'
import { newDeviceSyncId, publishDeviceVault } from './deviceRemoteVault.ts'
import { updateSyncWriterState, type SyncWriterState } from './syncCheckpointStore.ts'

const CLAIM_TIMEOUT_MS = 120_000
const sessionWriters = new Map<string, SyncWriterState>()

type PublicationArgs = [store: RemoteVaultStore, baseObjectName: string, content: string, expectedHeadIds: string[]]

export async function publishLocalDeviceVault(...args: PublicationArgs): ReturnType<typeof publishDeviceVault> {
  const [store, baseObjectName] = args
  const key = JSON.stringify([store.cacheScope, baseObjectName])
  const locks = globalThis.navigator?.locks
  if (locks?.request) {
    let lockGranted = false
    try {
      return await locks.request(`mypwdmg-sync-v4:${key}`, () => {
        lockGranted = true
        return publishWithClaim(key, args)
      })
    } catch (error) {
      if (lockGranted) throw error
      // Some native WebViews expose Web Locks but reject requests for file URLs.
    }
  }
  return publishWithClaim(key, args)
}

async function publishWithClaim(key: string, args: PublicationArgs): ReturnType<typeof publishDeviceVault> {
  const expectedHeadIds = args[3]
  const initializing = expectedHeadIds.length === 0
  const claimId = newDeviceSyncId()
  const update = (change: Parameters<typeof updateSyncWriterState>[1]) => {
    if (globalThis.indexedDB) return updateSyncWriterState(key, change)
    const next = change(sessionWriters.get(key))
    if (next) sessionWriters.set(key, next)
    return Promise.resolve(next)
  }
  const claimed = await update((previous) => {
    const active = previous?.phase === 'staging' || previous?.phase === 'publishing'
    if (active && Date.now() - (previous.claimedAt ?? 0) < CLAIM_TIMEOUT_MS) return previous
    const uncertain = previous?.phase === 'uncertain' || previous?.phase === 'publishing'
    if (uncertain && previous.initializing && initializing) return previous
    return {
      id: previous && !uncertain ? previous.id : newDeviceSyncId(),
      phase: 'staging',
      claimId,
      claimedAt: Date.now(),
      initializing
    }
  })
  if (!claimed || claimed.claimId !== claimId) {
    const message = claimed?.initializing && initializing && (claimed.phase === 'uncertain' || claimed.phase === 'publishing')
      ? '上次初始化的索引写入结果未知，请先回读 OSS 确认，以免创建两个独立的云端基线'
      : '本安装有另一项同步正在发布，请稍后重试'
    return { status: 'error', message }
  }

  let indexWriteConfirmed = false
  try {
    return await publishDeviceVault(...args, {
      deviceId: claimed.id,
      startIndexWrite: async () => {
        const publishing = await update((previous) => previous?.claimId === claimId
          ? { ...previous, phase: 'publishing', claimedAt: Date.now() }
          : previous)
        if (publishing?.claimId !== claimId) throw new Error('同步发布已失去设备写入权限，请重试')
      },
      confirmIndexWrite: () => { indexWriteConfirmed = true }
    })
  } finally {
    await update((previous) => {
      if (previous?.claimId !== claimId) return previous
      return previous.phase === 'publishing' && !indexWriteConfirmed
        ? { id: previous.id, phase: 'uncertain', initializing }
        : { id: previous.id, phase: 'idle' }
    }).catch(() => {
      // A failed local write leaves the durable claim for safe recovery.
    })
  }
}
