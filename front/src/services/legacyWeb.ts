import type { VaultEntry, VaultPayload } from '../types'
import { defaultVaultPayload } from './vaultDefaults'

const STORAGE_KEY = 'cardData'
const OSS_BUCKET_NAME = 'OSS_BUCKET_NAME'
const OSS_ACCESS_KEY_ID = 'OSS_ACCESS_KEY_ID'
const OSS_ACCESS_KEY_SECRET = 'OSS_ACCESS_KEY_SECRET'
const OSS_REGION = 'OSS_REGION'
const LEGACY_KEYS = [STORAGE_KEY, OSS_BUCKET_NAME, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_REGION]
const ORIG_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const FORWARD_ALPHABETS: Record<string, string> = {
  QzA9J: 'f7Yemasx9Xl6ZgwrR2bUQtpPnMBikN0H83CKcFvDdLIVyTOhJWoq5EAjS4Guz1',
  eJoFO: 'mTsCKrcUxfeG178gyWdzuMOQPkJwSnNE6LvYaDh4F0qbj lZA253XpB9VitRHIo'.replace(/\s/g, ''),
  ZguKa: 'rLsupq10Ulw2kcajiZK5NC4ty8EFPhxdMz9ToA7mOIvbWXYQBeGHVSDR63nJgf'
}
const HOST_TOKEN_RE = /(?:(?:https?:\/\/)?)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/gi

type LegacyCard = {
  appName?: string
  appUser?: string
  appPwd?: string
  appPhone?: string
  appNote?: string
  appTotpSecret?: string
  type?: string
  subCards?: LegacyCard[]
}

export function hasLegacyWebData() {
  return Boolean(localStorage.getItem(STORAGE_KEY))
}

export function currentLegacyStorageSnapshot() {
  return {
    [STORAGE_KEY]: localStorage.getItem(STORAGE_KEY) || '',
    [OSS_BUCKET_NAME]: localStorage.getItem(OSS_BUCKET_NAME) || '',
    [OSS_ACCESS_KEY_ID]: localStorage.getItem(OSS_ACCESS_KEY_ID) || '',
    [OSS_ACCESS_KEY_SECRET]: localStorage.getItem(OSS_ACCESS_KEY_SECRET) || '',
    [OSS_REGION]: localStorage.getItem(OSS_REGION) || ''
  }
}

export function clearLegacyWebData() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
}

export function migrateLegacyWebData(): { payload: VaultPayload; migrated: number; failed: number } {
  return migrateLegacyStorageSnapshot(currentLegacyStorageSnapshot())
}

export function migrateLegacyStorageText(text: string): { payload: VaultPayload; migrated: number; failed: number } {
  if (!text || !text.trim()) return { payload: defaultVaultPayload(), migrated: 0, failed: 0 }
  try {
    return migrateLegacyStorageSnapshot(JSON.parse(text) as Record<string, string>)
  } catch {
    return { payload: defaultVaultPayload(), migrated: 0, failed: 1 }
  }
}

export function migrateLegacyStorageSnapshot(snapshot: Record<string, string>): { payload: VaultPayload; migrated: number; failed: number } {
  const loaded = loadLegacyCards(snapshot)
  const cards = loaded.cards
  const payload = defaultVaultPayload(convertLegacyCards(cards))
  const legacyOss = loadLegacyOssSettings(snapshot)
  payload.settings.oss = {
    ...payload.settings.oss,
    ...legacyOss.settings
  }
  return { payload, migrated: flattenEntries(payload.entries).length, failed: loaded.failed + legacyOss.failed }
}

function loadLegacyCards(snapshot: Record<string, string>) {
  const rawCardData = snapshot[STORAGE_KEY]
  if (!rawCardData) return { cards: [] as LegacyCard[], failed: 0 }

  try {
    const encodedItems = JSON.parse(rawCardData)
    if (!Array.isArray(encodedItems)) return { cards: [] as LegacyCard[], failed: 1 }
    const cards: LegacyCard[] = []
    let failed = 0
    for (const encoded of encodedItems) {
      try {
        const raw = deobfuscate(String(encoded || ''))
        const card = raw ? JSON.parse(raw) as LegacyCard : null
        if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Invalid legacy card')
        cards.push(card)
      } catch {
        failed += 1
      }
    }
    return { cards, failed }
  } catch {
    return { cards: [] as LegacyCard[], failed: 1 }
  }
}

function convertLegacyCards(cards: LegacyCard[]): VaultEntry[] {
  return cards.map(convertLegacyCard).filter((entry): entry is VaultEntry => Boolean(entry))
}

function convertLegacyCard(card: LegacyCard): VaultEntry {
  const title = card.appName || 'Untitled'
  if (card.type === 'fold') {
    return {
      id: makeId(),
      kind: 'folder',
      title,
      domains: extractDomains(title, card.appNote || ''),
      children: convertLegacyCards(card.subCards || [])
    }
  }
  return {
    id: makeId(),
    kind: 'login',
    title,
    domains: extractDomains(title, card.appNote || ''),
    username: card.appUser || '',
    email: '',
    password: card.appPwd || '',
    phone: card.appPhone || '',
    loginAccountSource: 'auto',
    note: card.appNote || '',
    totpSecret: card.appTotpSecret || '',
    children: []
  }
}

function loadLegacyOssSettings(snapshot: Record<string, string>) {
  let failed = 0
  const decode = (key: string) => {
    const encoded = snapshot[key] || ''
    const decoded = deobfuscate(encoded)
    if (encoded && !decoded) failed += 1
    return decoded
  }
  return {
    settings: {
      bucketName: decode(OSS_BUCKET_NAME),
      accessKeyId: decode(OSS_ACCESS_KEY_ID),
      accessKeySecret: decode(OSS_ACCESS_KEY_SECRET),
      region: decode(OSS_REGION)
    },
    failed
  }
}

function deobfuscate(value: string) {
  if (!value || value.length < 5) return ''
  const prefix = value.slice(0, 5)
  const mapped = FORWARD_ALPHABETS[prefix]
  if (!mapped) return ''

  let restored = ''
  for (const char of value.slice(5)) {
    const index = mapped.indexOf(char)
    restored += index >= 0 ? ORIG_ALPHABET[index] : char
  }

  try {
    return new TextDecoder().decode(base64ToBytes(restored))
  } catch {
    return ''
  }
}

function extractDomains(...values: string[]) {
  const domains: string[] = []
  for (const value of values) {
    for (const match of value.matchAll(HOST_TOKEN_RE)) {
      const domain = normalizeDomain(match[1])
      if (domain && !domains.includes(domain)) domains.push(domain)
    }
  }
  return domains
}

function normalizeDomain(value: string) {
  let result = String(value || '').trim().toLowerCase()
  const schemeIndex = result.indexOf('://')
  if (schemeIndex >= 0) result = result.slice(schemeIndex + 3)
  result = result.split('/', 1)[0].replace(/^\.+|\.+$/g, '')
  return result.startsWith('www.') ? result.slice(4) : result
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children || [])])
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function makeId() {
  return crypto.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
