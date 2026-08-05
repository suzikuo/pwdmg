type SecureRandomSource = {
  randomUUID?: () => string
  getRandomValues?: (values: Uint8Array) => Uint8Array
}

export function secureRandomId(source: SecureRandomSource = globalThis.crypto as SecureRandomSource) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') throw new Error('Secure random generation is unavailable')
  const bytes = source.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
