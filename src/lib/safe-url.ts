const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Return a canonical browser-navigation URL or `undefined` when the value
 * could execute script, embed active data, or smuggle credentials.
 */
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (!candidate || hasControlCharacter) return undefined

  try {
    const parsed = new URL(candidate)
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}
