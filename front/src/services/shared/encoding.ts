export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function sha256Bytes(input: Uint8Array | string): Promise<Uint8Array> {
  const isString = typeof input === 'string'
  const bytes = isString ? new TextEncoder().encode(input) : input
  const buffer = toArrayBuffer(bytes)
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
    return new Uint8Array(digest)
  } finally {
    if (isString) {
      bytes.fill(0)
      new Uint8Array(buffer).fill(0)
    }
  }
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const digest = await sha256Bytes(input)
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Base64(input: Uint8Array | string): Promise<string> {
  return bytesToBase64(await sha256Bytes(input))
}
