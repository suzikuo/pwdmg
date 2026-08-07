import type { VaultEntry } from '../types.ts'

export type ImportItemKind = 'login' | 'secure-note' | 'card' | 'identity' | 'api-key'
export type ImportFieldType = 'text' | 'secret' | 'date' | 'url' | 'email' | 'phone'

export interface ImportedCustomField {
  label: string
  value: string
  type: ImportFieldType
  protected: boolean
}

export interface ImportedVaultRecord {
  importId: string
  kind: ImportItemKind
  title: string
  folderPath: string
  domains: string[]
  username: string
  email: string
  password: string
  phone: string
  note: string
  totpSecret: string
  customFields: ImportedCustomField[]
}

export interface VaultImportPreview {
  format: string
  records: ImportedVaultRecord[]
  warnings: string[]
}

const MAX_IMPORT_CHARACTERS = 16 * 1024 * 1024
const MAX_IMPORT_ROWS = 50_000
const MAX_IMPORT_COLUMNS = 128

export function parseVaultImport(content: string, fileName = ''): VaultImportPreview {
  const text = String(content ?? '').replace(/^\uFEFF/, '')
  if (!text.trim()) throw new Error('导入文件为空。')
  if (text.length > MAX_IMPORT_CHARACTERS) throw new Error('导入文件超过 16 MB 限制。')
  if (looksLikeJson(text, fileName)) return parseJsonImport(text)
  return parseCsvImport(text)
}

export function parseCsv(content: string, delimiter = ',') {
  if (!delimiter || delimiter.length !== 1) throw new Error('CSV 分隔符无效。')
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
      continue
    }

    if (character === '"' && value.length === 0) {
      quoted = true
    } else if (character === delimiter) {
      row.push(value)
      value = ''
      if (row.length > MAX_IMPORT_COLUMNS) throw new Error('CSV 列数超过限制。')
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      row.push(value)
      value = ''
      if (row.some((item) => item.length > 0)) rows.push(row)
      row = []
      if (rows.length > MAX_IMPORT_ROWS) throw new Error('CSV 行数超过限制。')
    } else {
      value += character
    }
  }
  if (quoted) throw new Error('CSV 包含未闭合的引号。')
  row.push(value)
  if (row.some((item) => item.length > 0)) rows.push(row)
  if (rows.length > MAX_IMPORT_ROWS) throw new Error('CSV 行数超过限制。')
  return rows
}

export function importRecordFingerprint(record: Omit<ImportedVaultRecord, 'importId' | 'folderPath'>) {
  return JSON.stringify({
    kind: record.kind,
    title: normalizeComparable(record.title),
    domains: [...record.domains].map(normalizeComparable).sort(),
    username: normalizeComparable(record.username),
    email: normalizeComparable(record.email),
    password: record.password,
    phone: normalizeComparable(record.phone),
    note: record.note,
    totpSecret: record.totpSecret,
    customFields: record.customFields.map((field) => ({
      label: normalizeComparable(field.label),
      value: field.value,
      type: field.type,
      protected: field.protected
    }))
  })
}

export function existingImportFingerprints(entries: readonly VaultEntry[]) {
  const result = new Set<string>()
  const visit = (items: readonly VaultEntry[]) => {
    for (const entry of items) {
      if (entry.kind === 'folder') {
        visit(entry.children || [])
        continue
      }
      result.add(importRecordFingerprint({
        kind: importKind(entry.kind),
        title: entry.title,
        domains: entry.domains || [],
        username: entry.username || '',
        email: entry.email || '',
        password: entry.password || '',
        phone: entry.phone || '',
        note: entry.note || '',
        totpSecret: entry.totpSecret || '',
        customFields: (entry.customFields || []).map((field) => ({
          label: field.label,
          value: field.value,
          type: field.type,
          protected: field.protected
        }))
      }))
    }
  }
  visit(entries)
  return result
}

function parseJsonImport(text: string): VaultImportPreview {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('JSON 文件格式无效。')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('不支持该 JSON 导出格式。')
  const root = payload as Record<string, unknown>
  if (root.encrypted === true || typeof root.encKeyValidation_DO_NOT_EDIT === 'string') {
    throw new Error('暂不支持加密的 Bitwarden JSON，请导出未加密 JSON 并在导入后立即删除。')
  }
  const items = Array.isArray(root.items) ? root.items : null
  if (!items) throw new Error('未识别到 Bitwarden items 数组。')

  const warnings: string[] = []
  const records: ImportedVaultRecord[] = []
  items.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(`第 ${index + 1} 项不是有效对象，已跳过。`)
      return
    }
    const item = raw as Record<string, unknown>
    const type = Number(item.type || 1)
    const kind = bitwardenKind(type)
    if (!kind) {
      warnings.push(`「${cleanText(item.name) || `第 ${index + 1} 项`}」类型暂不支持，已跳过。`)
      return
    }
    const login = objectValue(item.login)
    const secureNote = objectValue(item.secureNote)
    const card = objectValue(item.card)
    const identity = objectValue(item.identity)
    const uris = Array.isArray(login.uris) ? login.uris : []
    const urlValues = uris.map((uri) => cleanText(objectValue(uri).uri)).filter(Boolean)
    const customFields = normalizeBitwardenFields(item.fields)
    if (kind === 'card') appendCardFields(customFields, card)
    if (kind === 'identity') appendIdentityFields(customFields, identity)
    records.push(makeRecord({
      importId: `bitwarden-${index}`,
      kind,
      title: cleanText(item.name),
      folderPath: cleanText(item.folderId),
      urls: urlValues,
      username: cleanText(login.username),
      password: cleanText(login.password),
      note: cleanText(item.notes || secureNote.notes),
      totpSecret: cleanText(login.totp),
      customFields
    }))
  })
  return { format: 'Bitwarden JSON', records, warnings }
}

function parseCsvImport(text: string): VaultImportPreview {
  const delimiter = detectDelimiter(text)
  const rows = parseCsv(text, delimiter)
  if (rows.length < 2) throw new Error('CSV 没有可导入的数据行。')
  const headers = rows[0].map(normalizeHeader)
  const format = detectCsvFormat(headers)
  const warnings: string[] = []
  const records: ImportedVaultRecord[] = []

  rows.slice(1).forEach((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, cleanText(values[index])]))
    const title = firstValue(row, ['name', 'title'])
    const username = firstValue(row, ['username', 'loginusername', 'login_username'])
    const email = firstValue(row, ['email']) || (username.includes('@') ? username : '')
    const password = firstValue(row, ['password', 'loginpassword', 'login_password'])
    const note = firstValue(row, ['note', 'notes', 'extra'])
    const urls = splitUrls(firstValue(row, ['url', 'uri', 'loginuri', 'login_uri', 'website']))
    const totpSecret = firstValue(row, ['totp', 'logintotp', 'login_totp', 'otpauth'])
    const kind = csvKind(firstValue(row, ['type']))
    const customFields = parseCsvCustomFields(firstValue(row, ['fields']))
    if (!title && !username && !password && !note && !urls.length) return
    if (kind === null) {
      warnings.push(`第 ${rowIndex + 2} 行类型不支持，已跳过。`)
      return
    }
    records.push(makeRecord({
      importId: `csv-${rowIndex}`,
      kind,
      title,
      folderPath: firstValue(row, ['folder', 'group', 'category']),
      urls,
      username,
      email,
      password,
      phone: firstValue(row, ['phone', 'telephone']),
      note,
      totpSecret,
      customFields
    }))
  })
  return { format, records, warnings }
}

function makeRecord(value: Partial<ImportedVaultRecord> & { importId: string; kind: ImportItemKind; urls?: string[] }) {
  const urls = Array.isArray(value.urls) ? value.urls : []
  const domains = [...new Set(urls.map(domainFromUrl).filter(Boolean))]
  const title = cleanText(value.title) || domains[0] || cleanText(value.username || value.email) || '导入条目'
  return {
    importId: value.importId,
    kind: value.kind,
    title,
    folderPath: cleanText(value.folderPath),
    domains,
    username: cleanText(value.username),
    email: cleanText(value.email),
    password: cleanText(value.password),
    phone: cleanText(value.phone),
    note: cleanText(value.note),
    totpSecret: cleanText(value.totpSecret),
    customFields: Array.isArray(value.customFields) ? value.customFields : []
  }
}

function normalizeBitwardenFields(value: unknown): ImportedCustomField[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const field = objectValue(raw)
    const label = cleanText(field.name)
    const fieldValue = cleanText(field.value)
    if (!label && !fieldValue) return []
    return [{
      label: label || '自定义字段',
      value: fieldValue,
      type: Number(field.type) === 1 ? 'secret' as const : 'text' as const,
      protected: Number(field.type) === 1
    }]
  })
}

function appendCardFields(fields: ImportedCustomField[], card: Record<string, unknown>) {
  appendField(fields, '持卡人', card.cardholderName)
  appendField(fields, '卡号', card.number, 'secret', true)
  appendField(fields, '品牌', card.brand)
  appendField(fields, '有效月份', card.expMonth)
  appendField(fields, '有效年份', card.expYear)
  appendField(fields, '安全码', card.code, 'secret', true)
}

function appendIdentityFields(fields: ImportedCustomField[], identity: Record<string, unknown>) {
  appendField(fields, '姓名', [identity.firstName, identity.middleName, identity.lastName].map(cleanText).filter(Boolean).join(' '))
  appendField(fields, '公司', identity.company)
  appendField(fields, '邮箱', identity.email, 'email')
  appendField(fields, '电话', identity.phone, 'phone')
  appendField(fields, '地址', [identity.address1, identity.address2, identity.address3].map(cleanText).filter(Boolean).join(' '))
  appendField(fields, '城市', identity.city)
  appendField(fields, '地区', identity.state)
  appendField(fields, '邮编', identity.postalCode)
  appendField(fields, '国家', identity.country)
  appendField(fields, '证件号', identity.ssn, 'secret', true)
  appendField(fields, '护照号', identity.passportNumber, 'secret', true)
  appendField(fields, '驾照号', identity.licenseNumber, 'secret', true)
}

function appendField(fields: ImportedCustomField[], label: string, value: unknown, type: ImportFieldType = 'text', protectedValue = false) {
  const text = cleanText(value)
  if (text) fields.push({ label, value: text, type, protected: protectedValue })
}

function parseCsvCustomFields(value: string): ImportedCustomField[] {
  if (!value) return []
  try {
    return normalizeBitwardenFields(JSON.parse(value))
  } catch {
    return []
  }
}

function bitwardenKind(type: number): ImportItemKind | null {
  if (type === 1) return 'login'
  if (type === 2) return 'secure-note'
  if (type === 3) return 'card'
  if (type === 4) return 'identity'
  return null
}

function csvKind(value: string): ImportItemKind | null {
  const normalized = normalizeHeader(value)
  if (!normalized || normalized === 'login' || normalized === '1') return 'login'
  if (['securenote', 'note', '2'].includes(normalized)) return 'secure-note'
  if (['card', '3'].includes(normalized)) return 'card'
  if (['identity', '4'].includes(normalized)) return 'identity'
  return null
}

function importKind(value: string): ImportItemKind {
  return ['secure-note', 'card', 'identity', 'api-key'].includes(value) ? value as ImportItemKind : 'login'
}

function detectCsvFormat(headers: string[]) {
  if (headers.includes('loginuri') || headers.includes('login_uri')) return 'Bitwarden CSV'
  if (headers.includes('group') && headers.includes('totp')) return 'KeePassXC CSV'
  if (headers.includes('otpauth') || headers.includes('favorite')) return '1Password CSV'
  if (headers.includes('url') && headers.includes('username') && headers.includes('password')) return 'Chrome / Edge CSV'
  return '通用 CSV'
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const candidates = [',', '\t', ';']
  return candidates.sort((left, right) => countUnquoted(firstLine, right) - countUnquoted(firstLine, left))[0]
}

function countUnquoted(value: string, delimiter: string) {
  let count = 0
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted
    else if (!quoted && value[index] === delimiter) count += 1
  }
  return count
}

function splitUrls(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function domainFromUrl(value: string) {
  const input = cleanText(value)
  if (!input) return ''
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) if (row[key]) return row[key]
  return ''
}

function normalizeHeader(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[\s.-]+/g, '').replace(/[^a-z0-9_]/g, '')
}

function normalizeComparable(value: unknown) {
  return cleanText(value).toLowerCase()
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\u0000/g, '').trim()
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function looksLikeJson(text: string, fileName: string) {
  return fileName.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')
}
