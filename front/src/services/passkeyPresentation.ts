import type { PasskeyTransport, VaultEntry, VaultPasskey } from '../types'

export type PasskeyPresentationItem = {
  id: string
  rpLabel: string
  accountLabel: string
  linkedEntryTitle: string | null
  transports: string[]
  createdAt: number
  updatedAt: number
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
    rpLabel: passkey.rpName?.trim() || passkey.rpId,
    accountLabel: passkey.userDisplayName?.trim() || passkey.userName,
    linkedEntryTitle: passkey.entryId ? entryTitles.get(passkey.entryId) || null : null,
    transports: displayPasskeyTransports(passkey.transports),
    createdAt: passkey.createdAt,
    updatedAt: passkey.updatedAt
  }))
}

export function displayPasskeyTransports(transports: readonly PasskeyTransport[]): string[] {
  const available = new Set(transports)
  return TRANSPORT_ORDER.filter((transport) => available.has(transport)).map((transport) => TRANSPORT_LABELS[transport])
}

function collectEntryTitles(entries: readonly VaultEntry[], titles: Map<string, string>) {
  for (const entry of entries) {
    if (entry.kind === 'login') titles.set(entry.id, entry.title || '未命名登录')
    if (entry.children?.length) collectEntryTitles(entry.children, titles)
  }
}
