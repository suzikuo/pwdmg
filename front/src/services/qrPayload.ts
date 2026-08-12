import type { TotpAlgorithm } from './totp.ts'

const MAX_QR_PAYLOAD_CHARS = 4096
const MAX_TOTP_SECRET_CHARS = 1024
const MAX_LABEL_CHARS = 512
const ALLOWED_TOTP_PARAMS = new Set(['secret', 'issuer', 'algorithm', 'digits', 'period'])

export type TotpQrPayload = {
  kind: 'totp'
  uri: string
  secret: string
  label: string
  issuer: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
}

export type PasskeyHybridQrPayload = {
  kind: 'passkey-hybrid'
}

export type RecognizedQrPayload = TotpQrPayload | PasskeyHybridQrPayload

export function parseQrPayload(value: string): RecognizedQrPayload {
  const raw = String(value || '').trim()
  if (!raw || raw.length > MAX_QR_PAYLOAD_CHARS) throw new Error('二维码内容无效或过长')
  if (/^FIDO:\//i.test(raw)) return { kind: 'passkey-hybrid' }
  return parseTotpQrPayload(raw)
}

export function parseTotpQrPayload(value: string): TotpQrPayload {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('二维码不是有效的 TOTP 配置')
  }
  if (parsed.protocol.toLowerCase() !== 'otpauth:' || parsed.hostname.toLowerCase() !== 'totp') {
    throw new Error('仅支持 otpauth://totp 二维码')
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error('TOTP 二维码包含不支持的内容')
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_TOTP_PARAMS.has(key)) throw new Error(`TOTP 参数不受支持: ${key}`)
  }

  const secretValues = parsed.searchParams.getAll('secret')
  if (secretValues.length !== 1) throw new Error('TOTP 二维码必须包含一个密钥')
  const secret = normalizeBase32(secretValues[0])
  if (secret.length < 16 || secret.length > MAX_TOTP_SECRET_CHARS || !/^[A-Z2-7]+$/.test(secret)) {
    throw new Error('TOTP 密钥不是有效的 Base32')
  }

  const label = decodeLabel(parsed.pathname)
  const issuer = readSingleTextParam(parsed, 'issuer', MAX_LABEL_CHARS)
  const algorithm = readAlgorithm(parsed)
  const digits = readIntegerParam(parsed, 'digits', 6, 6, 8)
  const period = readIntegerParam(parsed, 'period', 30, 1, 300)

  const canonical = new URL('otpauth://totp/' + encodeURIComponent(label))
  canonical.searchParams.set('secret', secret)
  if (issuer) canonical.searchParams.set('issuer', issuer)
  if (algorithm !== 'SHA-1') canonical.searchParams.set('algorithm', algorithm.replace('-', ''))
  if (digits !== 6) canonical.searchParams.set('digits', String(digits))
  if (period !== 30) canonical.searchParams.set('period', String(period))

  return {
    kind: 'totp',
    uri: canonical.toString(),
    secret,
    label,
    issuer,
    algorithm,
    digits,
    period
  }
}

function normalizeBase32(value: string) {
  return String(value || '').replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase()
}

function decodeLabel(pathname: string) {
  const encoded = pathname.replace(/^\/+/, '')
  if (!encoded) return ''
  let label: string
  try {
    label = decodeURIComponent(encoded)
  } catch {
    throw new Error('TOTP 账号标签编码无效')
  }
  if (label.length > MAX_LABEL_CHARS) throw new Error('TOTP 账号标签过长')
  return label
}

function readSingleTextParam(parsed: URL, key: string, maxLength: number) {
  const values = parsed.searchParams.getAll(key)
  if (values.length > 1) throw new Error(`TOTP ${key} 参数重复`)
  const value = String(values[0] || '').trim()
  if (value.length > maxLength) throw new Error(`TOTP ${key} 参数过长`)
  return value
}

function readAlgorithm(parsed: URL): TotpAlgorithm {
  const raw = readSingleTextParam(parsed, 'algorithm', 16).replace(/[-_]/g, '').toUpperCase()
  if (!raw || raw === 'SHA1') return 'SHA-1'
  if (raw === 'SHA256') return 'SHA-256'
  if (raw === 'SHA512') return 'SHA-512'
  throw new Error('TOTP 算法不受支持')
}

function readIntegerParam(parsed: URL, key: string, fallback: number, minimum: number, maximum: number) {
  const raw = readSingleTextParam(parsed, key, 8)
  if (!raw) return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`TOTP ${key} 参数无效`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`TOTP ${key} 参数超出范围`)
  }
  return value
}
