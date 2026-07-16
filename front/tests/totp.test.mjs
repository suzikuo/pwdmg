import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import { generateTotp, readTotpAlgorithm, readTotpPeriod } from '../src/services/totp.ts'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes) {
  let buffer = 0
  let bits = 0
  let result = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits) result += BASE32[(buffer << (5 - bits)) & 31]
  return result
}

function referenceTotp(secret, timestampMs, period, digits, algorithm) {
  const counter = Math.floor(timestampMs / 1000 / period)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac(algorithm, secret).update(message).digest()
  const offset = digest.at(-1) & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

test('matches the RFC 6238 SHA-1 vector', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(await generateTotp(secret, { timestamp: 59_000, digits: 8 }), '94287082')
})

for (const [uriAlgorithm, nodeAlgorithm] of [['SHA256', 'sha256'], ['SHA512', 'sha512']]) {
  test(`supports ${uriAlgorithm}, custom digits, and custom period`, async () => {
    const secretBytes = Buffer.from(`mypwdmg-${uriAlgorithm}-totp-secret-material`)
    const secret = base32Encode(secretBytes)
    const timestamp = 1_234_567_890_000
    const uri = `otpauth://totp/Test?secret=${secret}&algorithm=${uriAlgorithm}&digits=8&period=45`
    const expected = referenceTotp(secretBytes, timestamp, 45, 8, nodeAlgorithm)
    assert.equal(await generateTotp(uri, { timestamp }), expected)
    assert.equal(readTotpPeriod(uri), 45)
    assert.equal(readTotpAlgorithm(uri), uriAlgorithm === 'SHA256' ? 'SHA-256' : 'SHA-512')
  })
}

test('rejects invalid Base32 instead of silently dropping characters', async () => {
  assert.equal(await generateTotp('NOT-A-VALID-SECRET!'), '')
})

test('supports long periods and rejects unsupported URI parameters', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const longPeriod = `otpauth://totp/Test?secret=${secret}&period=180`
  assert.equal(readTotpPeriod(longPeriod), 180)
  await assert.rejects(() => generateTotp(`otpauth://totp/Test?secret=${secret}&period=301`), /period/i)
  await assert.rejects(() => generateTotp(`otpauth://totp/Test?secret=${secret}&algorithm=MD5`), /algorithm/i)
  await assert.rejects(() => generateTotp(`otpauth://hotp/Test?secret=${secret}`), /TOTP URI/i)
})
