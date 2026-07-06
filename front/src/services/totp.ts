type TotpOptions = {
  timestamp?: number
  digits?: number
  period?: number
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DEFAULT_DIGITS = 6
const DEFAULT_PERIOD = 30

export async function generateTotp(secretValue: string, options: TotpOptions = {}) {
  const secret = extractTotpSecret(secretValue)
  if (!secret) return ''

  const digits = clampDigits(options.digits ?? readTotpNumberParam(secretValue, 'digits') ?? DEFAULT_DIGITS)
  const period = clampPeriod(options.period ?? readTotpNumberParam(secretValue, 'period') ?? DEFAULT_PERIOD)
  const timestamp = options.timestamp ?? Date.now()
  const keyBytes = base32ToBytes(secret)
  if (!keyBytes.length) return ''

  const counter = Math.floor(timestamp / 1000 / period)
  const hmac = await hmacSha1(keyBytes, counterToBytes(counter))
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) >>> 0

  return String(binary % 10 ** digits).padStart(digits, '0')
}

export function extractTotpSecret(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const urlSecret = readTotpTextParam(raw, 'secret')
  return normalizeBase32(urlSecret || raw)
}

function readTotpNumberParam(value: string, key: string) {
  const raw = readTotpTextParam(value, key)
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readTotpTextParam(value: string, key: string) {
  const raw = String(value || '').trim()
  if (!/^otpauth:\/\//i.test(raw)) return ''

  try {
    return new URL(raw).searchParams.get(key) || ''
  } catch {
    const match = raw.match(new RegExp(`[?&]${key}=([^&]+)`, 'i'))
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : ''
  }
}

function normalizeBase32(value: string) {
  return String(value || '')
    .replace(/[\s-]/g, '')
    .replace(/=+$/g, '')
    .toUpperCase()
}

function clampDigits(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DIGITS
  return Math.min(8, Math.max(6, Math.floor(value)))
}

function clampPeriod(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PERIOD
  return Math.min(120, Math.max(10, Math.floor(value)))
}

function base32ToBytes(secret: string) {
  let buffer = 0
  let bitsLeft = 0
  const bytes: number[] = []

  for (const char of secret) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value < 0) continue
    buffer = (buffer << 5) | value
    bitsLeft += 5

    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff)
      bitsLeft -= 8
    }
  }

  return new Uint8Array(bytes)
}

function counterToBytes(counter: number) {
  const bytes = new Uint8Array(8)
  let value = Math.max(0, Math.floor(counter))
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff
    value = Math.floor(value / 256)
  }
  return bytes
}

async function hmacSha1(key: Uint8Array, message: Uint8Array) {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const cryptoKey = await subtle.importKey('raw', toArrayBuffer(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      return new Uint8Array(await subtle.sign('HMAC', cryptoKey, toArrayBuffer(message)))
    } catch {
      // Fall through to the local implementation for older WebViews.
    }
  }

  return hmacSha1Fallback(key, message)
}

function hmacSha1Fallback(key: Uint8Array, message: Uint8Array) {
  const blockSize = 64
  const normalizedKey = key.length > blockSize ? sha1(key) : key
  const keyBlock = new Uint8Array(blockSize)
  keyBlock.set(normalizedKey)

  const outer = new Uint8Array(blockSize)
  const inner = new Uint8Array(blockSize)
  for (let index = 0; index < blockSize; index += 1) {
    outer[index] = keyBlock[index] ^ 0x5c
    inner[index] = keyBlock[index] ^ 0x36
  }

  return sha1(concatBytes(outer, sha1(concatBytes(inner, message))))
}

function sha1(message: Uint8Array) {
  const bitLength = message.length * 8
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const words = new Uint32Array(80)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let index = 0; index < 80; index += 1) {
      let f = 0
      let k = 0
      if (index < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (index < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const temp = (rotateLeft(a, 5) + f + e + k + words[index]) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const digest = new Uint8Array(20)
  const digestView = new DataView(digest.buffer)
  ;[h0, h1, h2, h3, h4].forEach((word, index) => digestView.setUint32(index * 4, word, false))
  return digest
}

function rotateLeft(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function concatBytes(first: Uint8Array, second: Uint8Array) {
  const output = new Uint8Array(first.length + second.length)
  output.set(first)
  output.set(second, first.length)
  return output
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
