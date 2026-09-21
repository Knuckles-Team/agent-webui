/** Deterministic JSON and SHA-256 helpers for bounded WebMCP protocol claims. */

export const WEBMCP_ARGUMENT_BYTE_BUDGET = 8_192

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

function canonicalString(value: string): string {
  if (hasLoneSurrogate(value)) throw new Error('WebMCP digest input contains a lone surrogate')
  return value
}

function canonicalArray(value: readonly unknown[], ancestors: Set<object>): unknown[] {
  const keys = Object.keys(value)
  const propertyNames = Object.getOwnPropertyNames(value)
  if (
    keys.length !== value.length ||
    keys.some((key, index) => key !== String(index)) ||
    propertyNames.length !== value.length + 1 ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new Error('WebMCP digest input contains a sparse or extended array')
  }
  return value.map((item) => canonicalValue(item, ancestors))
}

function canonicalRecord(value: object, ancestors: Set<object>): Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('WebMCP digest input contains a non-JSON object')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('WebMCP digest input contains a symbol key')
  const keys = Object.keys(value)
  if (
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return !descriptor?.enumerable || !('value' in descriptor)
    })
  ) {
    throw new Error('WebMCP digest input contains a non-data property')
  }
  return Object.fromEntries(
    keys
      .map(canonicalString)
      .sort()
      .map((key) => [key, canonicalValue(Reflect.get(value, key), ancestors)]),
  )
}

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return canonicalString(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('WebMCP digest input contains a non-safe integer')
    return value
  }
  if (typeof value !== 'object') throw new Error('WebMCP digest input is not JSON compatible')
  if (ancestors.has(value)) throw new Error('WebMCP digest input is cyclic')
  ancestors.add(value)
  try {
    return Array.isArray(value) ? canonicalArray(value, ancestors) : canonicalRecord(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set()))
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Digest(value: string): Promise<string> {
  const cryptoLike = globalThis.crypto as Crypto | undefined
  if (!cryptoLike?.subtle) throw new Error('Secure SHA-256 is unavailable')
  const encoded = new TextEncoder().encode(value)
  return `sha256:${toHex(await cryptoLike.subtle.digest('SHA-256', encoded))}`
}

export async function digestJson(value: unknown): Promise<string> {
  return sha256Digest(canonicalJson(value))
}

export async function digestBoundedArguments(value: unknown): Promise<string> {
  const canonical = canonicalJson(value)
  if (utf8ByteLength(canonical) > WEBMCP_ARGUMENT_BYTE_BUDGET) {
    throw new Error('WebMCP tool arguments exceeded the public byte budget')
  }
  return sha256Digest(canonical)
}
