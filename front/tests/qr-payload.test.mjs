import assert from 'node:assert/strict'
import test from 'node:test'

import { parseQrPayload, parseTotpQrPayload } from '../src/services/qrPayload.ts'

test('parses and canonicalizes a TOTP QR payload', () => {
  const result = parseTotpQrPayload(
    'otpauth://totp/Example%3Aalice%40example.com?secret=jbsw-y3dp ehpk3pxp====&issuer=Example&algorithm=SHA256&digits=8&period=45'
  )
  assert.deepEqual(result, {
    kind: 'totp',
    uri: 'otpauth://totp/Example%3Aalice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45',
    secret: 'JBSWY3DPEHPK3PXP',
    label: 'Example:alice@example.com',
    issuer: 'Example',
    algorithm: 'SHA-256',
    digits: 8,
    period: 45
  })
})

test('omits default TOTP parameters from the canonical URI', () => {
  const result = parseTotpQrPayload('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30')
  assert.equal(result.uri, 'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP')
  assert.equal(result.algorithm, 'SHA-1')
  assert.equal(result.digits, 6)
  assert.equal(result.period, 30)
})

test('recognizes FIDO hybrid payloads without treating them as TOTP', () => {
  assert.deepEqual(parseQrPayload('FIDO:/1234567890'), { kind: 'passkey-hybrid' })
})

for (const [label, value] of [
  ['HOTP', 'otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=1'],
  ['missing secret', 'otpauth://totp/alice?issuer=Example'],
  ['short secret', 'otpauth://totp/alice?secret=JBSWY3DP'],
  ['invalid base32', 'otpauth://totp/alice?secret=JBSWY3DPEHPK3PX1'],
  ['unsupported algorithm', 'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'],
  ['unsupported parameter', 'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&image=https%3A%2F%2Fexample.com'],
  ['non-canonical parameter casing', 'otpauth://totp/alice?Secret=JBSWY3DPEHPK3PXP'],
  ['duplicate secret', 'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&secret=JBSWY3DPEHPK3PXP'],
  ['arbitrary text', 'hello world']
]) {
  test(`rejects ${label} QR payload`, () => {
    assert.throws(() => parseQrPayload(value))
  })
}
