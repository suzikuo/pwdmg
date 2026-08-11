import type { EntryKind, VaultEntry, VaultPayload } from '../../types'
import type { ResolvedPasskeyState } from './passkeyRemoteGate'

export type CloudSyncDirection = 'upload' | 'download'
export type CloudSyncChangeType = 'added' | 'modified' | 'deleted'

export type EntryIndexMeta = {
  entry: VaultEntry
  parentId: string
  index: number
  path: string
  ancestorIds: string[]
  siblingIds: string[]
}

export type CloudSyncDiffItem = {
  id: string
  changeType: CloudSyncChangeType
  entryKind: EntryKind
  title: string
  path: string
  checked: boolean
  details: CloudSyncChangeDetail[]
  sourceParentId: string
  sourceIndex: number
}

export type CloudSyncChangeField =
  | 'position'
  | 'kind'
  | 'title'
  | 'status'
  | 'statusReason'
  | 'deletedAt'
  | 'domains'
  | 'autofillMatchMode'
  | 'username'
  | 'email'
  | 'password'
  | 'phone'
  | 'loginAccountSource'
  | 'note'
  | 'totpSecret'
  | 'customFields'
  | 'attachments'

export type CloudSyncEntryChangeField = Exclude<CloudSyncChangeField, 'position'>

export type CloudSyncChangeDetail = {
  key: CloudSyncChangeField
  label: string
  sourceText: string
  baseText: string
  checked: boolean
}

export type CloudSyncPreview = {
  direction: CloudSyncDirection
  objectName: string
  uploadObjectName: string
  uploadTargetWasMissing: boolean
  resolvedPasskeyState: ResolvedPasskeyState
  sourcePayload: VaultPayload
  basePayload: VaultPayload
  remoteBaselinePayload: VaultPayload
  items: CloudSyncDiffItem[]
  automatic: boolean
  sessionGeneration: number
  cloudScopeId: string
  passwordGateScopeKeys: string[]
  localFingerprint: string
  remoteFingerprint: string
  remoteObjectFingerprint: string
  remoteExists: boolean
  managedRemote: boolean
  remoteHeadIds: string[]
  legacyObjectNames: string[]
  remoteEnvelopeText: string
  remoteNeedsSessionKeyRewrite?: boolean
}

export const CLOUD_SYNC_CHANGE_LABELS: Record<CloudSyncChangeField, string> = {
  position: '位置',
  kind: '类型',
  title: '名称',
  status: '状态',
  statusReason: '状态说明',
  deletedAt: '删除时间',
  domains: '域名',
  autofillMatchMode: '自动填充匹配',
  username: '账号',
  email: '邮箱',
  password: '密码',
  phone: '手机',
  loginAccountSource: '自动填充账号',
  note: '备注',
  totpSecret: 'TOTP',
  customFields: '自定义字段',
  attachments: '附件'
}

export const CLOUD_SYNC_ENTRY_CHANGE_FIELDS: CloudSyncEntryChangeField[] = [
  'kind',
  'title',
  'status',
  'statusReason',
  'deletedAt',
  'domains',
  'autofillMatchMode',
  'username',
  'email',
  'password',
  'phone',
  'loginAccountSource',
  'autofillMatchMode',
  'note',
  'totpSecret',
  'customFields',
  'attachments'
]

export const CLOUD_SYNC_MANUAL_REVIEW_FIELDS: ReadonlySet<CloudSyncChangeField> = new Set([
  'kind',
  'status',
  'deletedAt',
  'username',
  'email',
  'password',
  'phone',
  'loginAccountSource',
  'totpSecret',
  'customFields',
  'attachments'
])
