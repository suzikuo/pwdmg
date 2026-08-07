import type { EntryKind, VaultCustomField } from '../types.ts'

export const CONTENT_ENTRY_KINDS: EntryKind[] = ['login', 'secure-note', 'card', 'identity', 'api-key']

export const ENTRY_KIND_OPTIONS: Array<{
  kind: EntryKind
  label: string
  description: string
  icon: string
}> = [
  { kind: 'login', label: '登录', description: '账号、密码、TOTP', icon: 'records-o' },
  { kind: 'secure-note', label: '安全备注', description: '加密保存私密文本', icon: 'description-o' },
  { kind: 'card', label: '银行卡', description: '卡号、有效期、安全码', icon: 'credit-pay' },
  { kind: 'identity', label: '身份', description: '证件与联系信息', icon: 'contact-o' },
  { kind: 'api-key', label: 'API 密钥', description: '密钥、端点与到期日', icon: 'closed-eye' },
  { kind: 'folder', label: '分组', description: '整理一组条目', icon: 'cluster-o' }
]

export function entryKindLabel(kind: EntryKind) {
  return ENTRY_KIND_OPTIONS.find((option) => option.kind === kind)?.label || '条目'
}

export function entryKindIcon(kind: EntryKind) {
  return ENTRY_KIND_OPTIONS.find((option) => option.kind === kind)?.icon || 'records-o'
}

export function starterCustomFields(kind: EntryKind, createId: () => string): VaultCustomField[] {
  const field = (
    label: string,
    type: VaultCustomField['type'] = 'text',
    protectedValue = type === 'secret'
  ): VaultCustomField => ({ id: createId(), label, value: '', type, protected: protectedValue })

  if (kind === 'card') {
    return [field('持卡人'), field('卡号', 'secret'), field('有效期', 'date'), field('安全码', 'secret')]
  }
  if (kind === 'identity') {
    return [field('姓名'), field('邮箱', 'email'), field('电话', 'phone'), field('地址'), field('证件号码', 'secret')]
  }
  if (kind === 'api-key') {
    return [field('Key ID'), field('Secret', 'secret'), field('服务端点', 'url'), field('到期日', 'date')]
  }
  return []
}
