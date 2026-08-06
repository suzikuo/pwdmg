import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CloudSyncDirection, CloudSyncPreview } from '../services/sync/legacyDiff'

export type CloudBackupInfo = {
  name: string
  exists: boolean
  size: number
  lastModified: string
}

export type CloudSyncLogStatus = 'started' | 'success' | 'review' | 'error' | 'skipped'
export type CloudSyncLogEntry = {
  id: string
  at: number
  direction: CloudSyncDirection | 'backup'
  automatic: boolean
  status: CloudSyncLogStatus
  objectName: string
  message: string
  added: number
  modified: number
  deleted: number
  selected: number
  total: number
}

export type CloudOperationKind = 'inspect' | 'list' | 'backup' | 'review' | 'apply' | 'password-rewrite'
export type CloudOperationDirection = 'upload' | 'download' | 'backup'
export type CloudOperationStage =
  | 'idle'
  | 'validating'
  | 'persisting-settings'
  | 'exporting'
  | 'reading-remote'
  | 'decrypting'
  | 'building-diff'
  | 'waiting-review'
  | 'applying-local'
  | 'writing-remote'
  | 'recording-checkpoint'
  | 'success'
  | 'error'
  | 'cancelled'

export type CloudOperationState = {
  id: number
  kind: CloudOperationKind
  direction?: CloudOperationDirection
  automatic: boolean
  stage: CloudOperationStage
  message: string
}

export type CloudOperationHandle = {
  id: number
  signal: AbortSignal
}

export type CloudSyncRuntime = {
  busy: ComputedRef<boolean>
  state: Readonly<Ref<CloudOperationState>>
  status: Ref<string>
  info: Ref<CloudBackupInfo | null>
  backups: Ref<CloudBackupInfo[]>
  selectedObjectName: Ref<string>
  reviewOpen: Ref<boolean>
  preview: Ref<CloudSyncPreview | null>
  logs: Ref<CloudSyncLogEntry[]>
  logLimit: Ref<number>
  begin: (kind: CloudOperationKind, options?: { direction?: CloudOperationDirection; automatic?: boolean; message?: string }) => CloudOperationHandle | null
  stage: (handle: CloudOperationHandle | null, stage: CloudOperationStage, message?: string) => boolean
  isCurrent: (handle: CloudOperationHandle | null) => boolean
  finish: (handle: CloudOperationHandle | null, stage?: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'>, message?: string) => void
  cancel: () => void
  signal: () => AbortSignal | undefined
  requireInitialDownload: () => void
  releaseInitialDownloadBarrier: () => void
  canScheduleAutomaticUpload: () => boolean
}

export function useCloudSync(options: { initialLogs?: CloudSyncLogEntry[]; initialLogLimit?: number } = {}): CloudSyncRuntime {
  const current = ref<CloudOperationState>({
    id: 0,
    kind: 'inspect',
    automatic: false,
    stage: 'idle',
    message: ''
  })
  const controller = ref<AbortController | null>(null)
  const status = ref('')
  const info = ref<CloudBackupInfo | null>(null)
  const backups = ref<CloudBackupInfo[]>([])
  const selectedObjectName = ref('')
  const reviewOpen = ref(false)
  const preview = ref<CloudSyncPreview | null>(null)
  const logs = ref<CloudSyncLogEntry[]>(options.initialLogs || [])
  const logLimit = ref(Number(options.initialLogLimit || 0))
  const initialDownloadRequired = ref(false)
  let nextId = 0

  const busy = computed(() => !['idle', 'success', 'error', 'cancelled'].includes(current.value.stage))

  function begin(
    kind: CloudOperationKind,
    options: { direction?: CloudOperationDirection; automatic?: boolean; message?: string } = {}
  ) {
    if (busy.value) return null
    const nextController = new AbortController()
    const id = ++nextId
    controller.value = nextController
    current.value = {
      id,
      kind,
      direction: options.direction,
      automatic: options.automatic === true,
      stage: 'validating',
      message: options.message || ''
    }
    return { id, signal: nextController.signal }
  }

  function isCurrent(handle: CloudOperationHandle | null) {
    return Boolean(handle && controller.value && controller.value.signal === handle.signal && current.value.id === handle.id && !handle.signal.aborted)
  }

  function stage(handle: CloudOperationHandle | null, nextStage: CloudOperationStage, message = '') {
    if (!isCurrent(handle)) return false
    current.value = { ...current.value, stage: nextStage, message }
    return true
  }

  function finish(
    handle: CloudOperationHandle | null,
    nextStage: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'> = 'success',
    message = ''
  ) {
    if (!handle || current.value.id !== handle.id || controller.value?.signal !== handle.signal) return
    if (handle.signal.aborted || current.value.stage === 'cancelled') {
      controller.value = null
      return
    }
    current.value = { ...current.value, stage: nextStage, message }
    controller.value = null
  }

  function cancel() {
    const activeController = controller.value
    if (!activeController) return
    activeController.abort()
    current.value = { ...current.value, stage: 'cancelled', message: '云端操作已取消' }
    controller.value = null
  }

  function signal() {
    return controller.value?.signal
  }

  function requireInitialDownload() {
    initialDownloadRequired.value = true
  }

  function releaseInitialDownloadBarrier() {
    initialDownloadRequired.value = false
  }

  function canScheduleAutomaticUpload() {
    return !initialDownloadRequired.value
  }

  return {
    busy,
    state: current,
    status,
    info,
    backups,
    selectedObjectName,
    reviewOpen,
    preview,
    logs,
    logLimit,
    begin,
    stage,
    isCurrent,
    finish,
    cancel,
    signal,
    requireInitialDownload,
    releaseInitialDownloadBarrier,
    canScheduleAutomaticUpload
  }
}
