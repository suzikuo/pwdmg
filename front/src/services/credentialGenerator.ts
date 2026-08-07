export type GeneratorMode = 'password' | 'passphrase' | 'username'
export type UsernameMode = 'random' | 'plus-address'

export interface RandomSource {
  getRandomValues(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer>
}

export interface PasswordGeneratorOptions {
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  digits?: boolean
  symbols?: boolean
  excludeAmbiguous?: boolean
}

export interface PassphraseGeneratorOptions {
  words?: number
  separator?: string
  capitalize?: boolean
  includeNumber?: boolean
}

export interface UsernameGeneratorOptions {
  mode?: UsernameMode
  email?: string
  digits?: number
}

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?'
const AMBIGUOUS = new Set('Il1O0o|`\'"')
const ONSETS = ['b', 'br', 'c', 'ch', 'd', 'dr', 'f', 'g', 'gr', 'h', 'j', 'k', 'kr', 'l', 'm', 'n', 'p', 'pr', 'qu', 'r', 's', 'sh', 'st', 't', 'tr', 'v', 'w', 'z']
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'io', 'oa']
const CODAS = ['', 'd', 'k', 'l', 'm', 'n', 'r', 's', 't', 'x']

export function generatePassword(
  options: PasswordGeneratorOptions = {},
  source: RandomSource = secureRandomSource()
) {
  const requestedLength = clampInteger(options.length, 20, 8, 128)
  const sets = [
    options.uppercase === false ? '' : UPPERCASE,
    options.lowercase === false ? '' : LOWERCASE,
    options.digits === false ? '' : DIGITS,
    options.symbols === false ? '' : SYMBOLS
  ]
    .map((characters) => options.excludeAmbiguous === false ? characters : removeAmbiguous(characters))
    .filter(Boolean)

  if (!sets.length) throw new Error('At least one character set is required.')
  const length = Math.max(requestedLength, sets.length)
  const combined = sets.join('')
  const result = sets.map((characters) => randomCharacter(characters, source))
  while (result.length < length) result.push(randomCharacter(combined, source))
  secureShuffle(result, source)
  return result.join('')
}

export function generatePassphrase(
  options: PassphraseGeneratorOptions = {},
  source: RandomSource = secureRandomSource()
) {
  const wordCount = clampInteger(options.words, 5, 3, 10)
  const separator = String(options.separator ?? '-').slice(0, 3) || '-'
  const words = Array.from({ length: wordCount }, () => {
    const value = `${randomItem(ONSETS, source)}${randomItem(NUCLEI, source)}${randomItem(CODAS, source)}${randomItem(ONSETS, source)}${randomItem(NUCLEI, source)}${randomItem(CODAS, source)}`
    return options.capitalize === false ? value : `${value[0].toUpperCase()}${value.slice(1)}`
  })
  if (options.includeNumber !== false) words.push(String(randomInteger(90, source) + 10))
  return words.join(separator)
}

export function generateUsername(
  options: UsernameGeneratorOptions = {},
  source: RandomSource = secureRandomSource()
) {
  const digits = clampInteger(options.digits, 4, 2, 8)
  const suffix = Array.from({ length: digits }, () => String(randomInteger(10, source))).join('')
  const word = `${randomItem(ONSETS, source)}${randomItem(NUCLEI, source)}${randomItem(CODAS, source)}${randomItem(ONSETS, source)}${randomItem(NUCLEI, source)}${randomItem(CODAS, source)}`.toLowerCase()
  if (options.mode !== 'plus-address') return `${word}${suffix}`

  const email = normalizeEmail(options.email)
  if (!email) throw new Error('A valid email address is required for plus addressing.')
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at).split('+', 1)[0]
  return `${local}+${word}${suffix}${email.slice(at)}`
}

export function randomInteger(maxExclusive: number, source: RandomSource = secureRandomSource()) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
    throw new RangeError('Random range is invalid.')
  }
  const range = 0x100000000
  const limit = Math.floor(range / maxExclusive) * maxExclusive
  const values = new Uint32Array(1)
  do {
    source.getRandomValues(values)
  } while (values[0] >= limit)
  return values[0] % maxExclusive
}

function secureRandomSource(): RandomSource {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable.')
  }
  return globalThis.crypto
}

function randomCharacter(characters: string, source: RandomSource) {
  return characters[randomInteger(characters.length, source)]
}

function randomItem<T>(values: readonly T[], source: RandomSource) {
  return values[randomInteger(values.length, source)]
}

function secureShuffle(values: string[], source: RandomSource) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = randomInteger(index + 1, source)
    ;[values[index], values[target]] = [values[target], values[index]]
  }
}

function removeAmbiguous(value: string) {
  return [...value].filter((character) => !AMBIGUOUS.has(character)).join('')
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ''
  return email
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}
