export const PASSKEY_OPERATION_PROTOCOL_VERSION = 1

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
const ANDROID_ORIGIN_PREFIX = 'android:apk-key-hash:'
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const UTF8_ENCODER = new TextEncoder()
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_ORIGIN_BYTES = 2 * 1024
const MAX_CHALLENGE_BYTES = 1024
const MIN_CHALLENGE_BYTES = 16
const MAX_CREDENTIAL_ID_BYTES = 2048
const MAX_CREDENTIAL_DESCRIPTORS = 100
const MAX_USER_ID_BYTES = 64
const MAX_USER_TEXT_BYTES = 512
const MAX_RP_TEXT_BYTES = 512
const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 120_000
const MIN_OPERATION_ID_BYTES = 16
const MAX_OPERATION_ID_BYTES = 64
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

export type PasskeyOperationKind = 'create' | 'get'
export type PasskeyOperationErrorCode =
  | 'INVALID_REQUEST_JSON'
  | 'INVALID_ORIGIN'
  | 'INVALID_CLIENT_DATA_HASH'
  | 'INVALID_CHALLENGE'
  | 'INVALID_RP'
  | 'INVALID_RP_ID'
  | 'RP_ID_ORIGIN_MISMATCH'
  | 'INVALID_USER'
  | 'UNSUPPORTED_ALGORITHM'
  | 'INVALID_CREDENTIAL_DESCRIPTOR'
  | 'DUPLICATE_CREDENTIAL_ID'
  | 'INVALID_TIMEOUT'
  | 'UNSUPPORTED_RESIDENT_KEY'
  | 'UNSUPPORTED_AUTHENTICATOR_ATTACHMENT'
  | 'INVALID_USER_VERIFICATION'
  | 'INVALID_OPERATION_ID'
  | 'INVALID_OPERATION_TICKET'
  | 'INVALID_PLATFORM_RESPONSE'

export class PasskeyOperationError extends Error {
  readonly code: PasskeyOperationErrorCode

  constructor(code: PasskeyOperationErrorCode) {
    super(code)
    this.name = 'PasskeyOperationError'
    this.code = code
  }
}

export type PasskeyOperationInput = {
  requestJson: string
  trustedOrigin: string
  clientDataHash: string
}

export type PasskeyCreateUser = {
  id: string
  name: string
  displayName: string
}

type PasskeyOperationBase = {
  protocolVersion: typeof PASSKEY_OPERATION_PROTOCOL_VERSION
  kind: PasskeyOperationKind
  origin: string
  rpId: string
  challenge: string
  clientDataHash: string
  timeoutMs: number
  credentialIds: string[]
  requiresUserVerification: true
}

export type PasskeyCreateOperation = PasskeyOperationBase & {
  kind: 'create'
  rpName: string
  user: PasskeyCreateUser
  algorithm: -7
  discoverable: true
}

export type PasskeyGetOperation = PasskeyOperationBase & {
  kind: 'get'
}

export type PasskeyOperation = PasskeyCreateOperation | PasskeyGetOperation

export type NativePasskeyOperation = {
  operation: PasskeyOperation
  operationId: string
  issuedAt: number
  expiresAt: number
}

export type PasskeyOperationOutcome =
  | {
    kind: PasskeyOperationKind
    operationId: string
    status: 'succeeded'
    platformResponseJson: string
  }
  | {
    kind: PasskeyOperationKind
    operationId: string
    status: 'cancelled' | 'rejected' | 'failed'
  }

export type PasskeyOperationDiagnostic = {
  kind: PasskeyOperationKind
  status: PasskeyOperationOutcome['status']
  code: 'SUCCESS' | 'CANCELLED' | 'REJECTED' | 'FAILED'
}

export function parsePasskeyOperation(
  kind: PasskeyOperationKind,
  input: PasskeyOperationInput
): PasskeyOperation {
  const origin = readTrustedOrigin(input.trustedOrigin)
  const clientDataHash = readBase64Url(
    input.clientDataHash,
    'INVALID_CLIENT_DATA_HASH',
    32,
    32
  )
  const request = readRequestJson(input.requestJson)
  const base = {
    protocolVersion: 1 as const,
    origin: origin.value,
    rpId: readRpId(kind === 'create' ? readObject(request.rp, 'INVALID_RP').id : request.rpId, origin.host),
    challenge: readBase64Url(request.challenge, 'INVALID_CHALLENGE', MIN_CHALLENGE_BYTES, MAX_CHALLENGE_BYTES),
    clientDataHash,
    timeoutMs: readTimeout(request.timeout),
    credentialIds: readCredentialDescriptors(
      kind === 'create' ? request.excludeCredentials : request.allowCredentials
    ),
    requiresUserVerification: true as const
  }

  if (kind === 'get') {
    readUserVerification(request.userVerification)
    return { ...base, kind: 'get' }
  }

  const rp = readObject(request.rp, 'INVALID_RP')
  const user = readObject(request.user, 'INVALID_USER')
  readCreateSelection(request.authenticatorSelection)
  requireEs256(request.pubKeyCredParams)
  return {
    ...base,
    kind: 'create',
    rpName: readWireText(rp.name, 'INVALID_RP', MAX_RP_TEXT_BYTES),
    user: {
      id: readBase64Url(user.id, 'INVALID_USER', 1, MAX_USER_ID_BYTES),
      name: readWireText(user.name, 'INVALID_USER', MAX_USER_TEXT_BYTES),
      displayName: readWireText(user.displayName, 'INVALID_USER', MAX_USER_TEXT_BYTES)
    },
    algorithm: -7,
    discoverable: true
  }
}

export function bindNativePasskeyOperation(
  operation: PasskeyOperation,
  operationId: string,
  issuedAt: number
): NativePasskeyOperation {
  const canonicalId = readBase64Url(
    operationId,
    'INVALID_OPERATION_ID',
    MIN_OPERATION_ID_BYTES,
    MAX_OPERATION_ID_BYTES
  )
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > MAX_SAFE_INTEGER - operation.timeoutMs) {
    fail('INVALID_OPERATION_TICKET')
  }
  return {
    operation,
    operationId: canonicalId,
    issuedAt,
    expiresAt: issuedAt + operation.timeoutMs
  }
}

export function isPasskeyOperationExpired(ticket: NativePasskeyOperation, now: number): boolean {
  if (!Number.isSafeInteger(now) || now <= 0) fail('INVALID_OPERATION_TICKET')
  return now >= ticket.expiresAt
}

export function createSucceededPasskeyOperationOutcome(
  ticket: NativePasskeyOperation,
  platformResponseJson: string
): PasskeyOperationOutcome {
  readPlatformResponseJson(platformResponseJson)
  return {
    kind: ticket.operation.kind,
    operationId: ticket.operationId,
    status: 'succeeded',
    platformResponseJson
  }
}

export function createCancelledPasskeyOperationOutcome(ticket: NativePasskeyOperation): PasskeyOperationOutcome {
  return createTerminalPasskeyOperationOutcome(ticket, 'cancelled')
}

export function createRejectedPasskeyOperationOutcome(ticket: NativePasskeyOperation): PasskeyOperationOutcome {
  return createTerminalPasskeyOperationOutcome(ticket, 'rejected')
}

export function createFailedPasskeyOperationOutcome(ticket: NativePasskeyOperation): PasskeyOperationOutcome {
  return createTerminalPasskeyOperationOutcome(ticket, 'failed')
}

export function toPasskeyOperationDiagnostic(outcome: PasskeyOperationOutcome): PasskeyOperationDiagnostic {
  const code = outcome.status === 'succeeded'
    ? 'SUCCESS'
    : outcome.status === 'cancelled'
      ? 'CANCELLED'
      : outcome.status === 'rejected'
        ? 'REJECTED'
        : 'FAILED'
  return {
    kind: outcome.kind,
    status: outcome.status,
    code
  }
}

function createTerminalPasskeyOperationOutcome(
  ticket: NativePasskeyOperation,
  status: 'cancelled' | 'rejected' | 'failed'
): PasskeyOperationOutcome {
  return {
    kind: ticket.operation.kind,
    operationId: ticket.operationId,
    status
  }
}

function readRequestJson(value: unknown): Record<string, unknown> {
  const requestJson = readWireText(value, 'INVALID_REQUEST_JSON', MAX_REQUEST_BYTES)
  try {
    return readObject(JSON.parse(requestJson), 'INVALID_REQUEST_JSON')
  } catch (error) {
    if (error instanceof PasskeyOperationError) throw error
    fail('INVALID_REQUEST_JSON')
  }
}

function readTrustedOrigin(value: unknown): { value: string, host: string | null } {
  const origin = readWireText(value, 'INVALID_ORIGIN', MAX_ORIGIN_BYTES)
  if (origin.startsWith(ANDROID_ORIGIN_PREFIX)) {
    readBase64Url(origin.slice(ANDROID_ORIGIN_PREFIX.length), 'INVALID_ORIGIN', 32, 32)
    return { value: origin, host: null }
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    fail('INVALID_ORIGIN')
  }
  if (url.origin === 'null' || origin !== url.origin) fail('INVALID_ORIGIN')
  const scheme = url.protocol
  const host = url.hostname
  if ((scheme !== 'https:' && scheme !== 'http:') || !isWebAuthnDomain(host)) {
    fail('INVALID_ORIGIN')
  }
  if (scheme === 'http:' && host !== 'localhost') fail('INVALID_ORIGIN')
  return { value: origin, host }
}

function readRpId(value: unknown, originHost: string | null): string {
  if (value === undefined && !originHost) fail('INVALID_RP_ID')
  const rpId = value === undefined
    ? originHost as string
    : readWireText(value, 'INVALID_RP_ID', 253).toLowerCase()
  if (!isWebAuthnDomain(rpId)) fail('INVALID_RP_ID')
  return rpId
}

function readCredentialDescriptors(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_CREDENTIAL_DESCRIPTORS) {
    fail('INVALID_CREDENTIAL_DESCRIPTOR')
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const descriptor of value) {
    const raw = readObject(descriptor, 'INVALID_CREDENTIAL_DESCRIPTOR')
    if (raw.type !== 'public-key') fail('INVALID_CREDENTIAL_DESCRIPTOR')
    const id = readBase64Url(
      raw.id,
      'INVALID_CREDENTIAL_DESCRIPTOR',
      1,
      MAX_CREDENTIAL_ID_BYTES
    )
    if (seen.has(id)) fail('DUPLICATE_CREDENTIAL_ID')
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function readCreateSelection(value: unknown): void {
  if (value === undefined) return
  const selection = readObject(value, 'UNSUPPORTED_RESIDENT_KEY')
  const residentKey = selection.residentKey
  if (residentKey !== undefined) {
    if (residentKey !== 'required' && residentKey !== 'preferred' && residentKey !== 'discouraged') {
      fail('UNSUPPORTED_RESIDENT_KEY')
    }
    if (residentKey === 'discouraged') fail('UNSUPPORTED_RESIDENT_KEY')
  }
  if (selection.requireResidentKey !== undefined && typeof selection.requireResidentKey !== 'boolean') {
    fail('UNSUPPORTED_RESIDENT_KEY')
  }
  if (selection.authenticatorAttachment !== undefined && selection.authenticatorAttachment !== 'platform') {
    fail('UNSUPPORTED_AUTHENTICATOR_ATTACHMENT')
  }
  readUserVerification(selection.userVerification)
}

function readUserVerification(value: unknown): void {
  if (value === undefined) return
  if (value !== 'required' && value !== 'preferred' && value !== 'discouraged') {
    fail('INVALID_USER_VERIFICATION')
  }
}

function requireEs256(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    fail('UNSUPPORTED_ALGORITHM')
  }
  for (const parameter of value) {
    if (!isObject(parameter)) continue
    if (parameter.type === 'public-key' && parameter.alg === -7) return
  }
  fail('UNSUPPORTED_ALGORITHM')
}

function readTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_TIMEOUT')
  }
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value))
}

function readPlatformResponseJson(value: unknown): void {
  const responseJson = readWireText(value, 'INVALID_PLATFORM_RESPONSE', MAX_REQUEST_BYTES)
  try {
    readObject(JSON.parse(responseJson), 'INVALID_PLATFORM_RESPONSE')
  } catch (error) {
    if (error instanceof PasskeyOperationError) throw error
    fail('INVALID_PLATFORM_RESPONSE')
  }
}

function readObject(value: unknown, code: PasskeyOperationErrorCode): Record<string, unknown> {
  if (!isObject(value)) fail(code)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readWireText(value: unknown, code: PasskeyOperationErrorCode, maxBytes: number): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail(code)
  if (UTF8_ENCODER.encode(value).byteLength > maxBytes) fail(code)
  return value
}

function readBase64Url(
  value: unknown,
  code: PasskeyOperationErrorCode,
  minBytes: number,
  maxBytes: number
): string {
  const text = readWireText(value, code, maxBytes * 2)
  if (!BASE64URL_RE.test(text)) fail(code)
  let decoded: string
  try {
    const padding = '='.repeat((4 - (text.length % 4)) % 4)
    decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/') + padding)
  } catch {
    fail(code)
  }
  const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (canonical !== text || decoded.length < minBytes || decoded.length > maxBytes) fail(code)
  return text
}

function isWebAuthnDomain(value: string): boolean {
  if (!value || value.length > 253 || value.endsWith('.')) return false
  const labels = value.split('.')
  if (value !== 'localhost' && labels.length < 2) return false
  return labels.every((label) => DOMAIN_LABEL_RE.test(label))
}

function fail(code: PasskeyOperationErrorCode): never {
  throw new PasskeyOperationError(code)
}
