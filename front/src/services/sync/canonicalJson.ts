type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') throw new Error('Canonical JSON supports JSON values only')

  const result: { [key: string]: JsonValue } = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key]
    if (item !== undefined) result[key] = canonicalize(item)
  }
  return result
}
