import type { PasskeyTransport, VaultEntry, VaultPasskey } from '../types'

export type PasskeyPresentationItem = {
  id: string
  displayLabel: string
  userLabel: string
  rpId: string
  rpLabel: string
  accountLabel: string
  linkedEntryId: string | null
  linkedEntryTitle: string | null
  transports: string[]
  discoverable: boolean
  backupEligible: boolean
  backupState: boolean
  createdAt: number
  updatedAt: number
}

export type PasskeyLoginOption = {
  id: string
  title: string
}

const TRANSPORT_ORDER: PasskeyTransport[] = ['internal', 'usb', 'nfc', 'ble', 'hybrid', 'smart-card']

const TRANSPORT_LABELS: Record<PasskeyTransport, string> = {
  internal: '设备内置',
  usb: 'USB',
  nfc: 'NFC',
  ble: '蓝牙',
  hybrid: '混合设备',
  'smart-card': '智能卡'
}

export function buildPasskeyPresentationItems(
  passkeys: readonly VaultPasskey[],
  entries: readonly VaultEntry[]
): PasskeyPresentationItem[] {
  const entryTitles = new Map<string, string>()
  collectEntryTitles(entries, entryTitles)

  return passkeys.map((passkey) => ({
    id: passkey.id,
    displayLabel: passkey.label?.trim() || passkey.rpName?.trim() || passkey.rpId,
    userLabel: passkey.label?.trim() || '',
    rpId: passkey.rpId,
    rpLabel: passkey.rpName?.trim() || passkey.rpId,
    accountLabel: passkey.userDisplayName?.trim() || passkey.userName,
    linkedEntryId: passkey.entryId || null,
    linkedEntryTitle: passkey.entryId ? entryTitles.get(passkey.entryId) || null : null,
    transports: displayPasskeyTransports(passkey.transports),
    discoverable: passkey.discoverable,
    backupEligible: passkey.backupEligible,
    backupState: passkey.backupState,
    createdAt: passkey.createdAt,
    updatedAt: passkey.updatedAt
  }))
}

export function displayPasskeyTransports(transports: readonly PasskeyTransport[]): string[] {
  const available = new Set(transports)
  return TRANSPORT_ORDER.filter((transport) => available.has(transport)).map((transport) => TRANSPORT_LABELS[transport])
}

export function buildPasskeyLoginOptions(entries: readonly VaultEntry[]): PasskeyLoginOption[] {
  const options: PasskeyLoginOption[] = []
  collectActiveLoginOptions(entries, [], options)
  return options
}

function collectEntryTitles(entries: readonly VaultEntry[], titles: Map<string, string>) {
  for (const entry of entries) {
    if (entry.kind === 'login') titles.set(entry.id, entry.title || '未命名登录')
    if (entry.children?.length) collectEntryTitles(entry.children, titles)
  }
}

function collectActiveLoginOptions(
  entries: readonly VaultEntry[],
  parentPath: readonly string[],
  options: PasskeyLoginOption[]
) {
  for (const entry of entries) {
    if (entry.status && entry.status !== 'active') continue
    const title = entry.title?.trim() || (entry.kind === 'folder' ? '未命名分组' : '未命名登录')
    if (entry.kind === 'folder') {
      collectActiveLoginOptions(entry.children || [], [...parentPath, title], options)
    } else if (entry.kind === 'login') {
      options.push({ id: entry.id, title: [...parentPath, title].join(' / ') })
    }
  }
}
