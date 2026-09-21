const MAX_JSON_DEPTH = 64

function invalidJson(): never {
  throw new Error('WebMCP JSON is invalid or contains duplicate keys')
}

/** Bounded callers use this parser to reject duplicate decoded object keys before JSON.parse. */
export function parseStrictJson(text: string): unknown {
  return new StrictJsonScanner(text).parse()
}

class StrictJsonScanner {
  private index = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  parse(): unknown {
    this.scanValue(0)
    this.skipWhitespace()
    if (this.index !== this.text.length) invalidJson()
    return JSON.parse(this.text) as unknown
  }

  private scanValue(depth: number): void {
    if (depth > MAX_JSON_DEPTH) invalidJson()
    this.skipWhitespace()
    const character = this.text[this.index]
    if (character === '{') this.scanObject(depth + 1)
    else if (character === '[') this.scanArray(depth + 1)
    else if (character === '"') void this.scanString()
    else if (character === 't') this.scanLiteral('true')
    else if (character === 'f') this.scanLiteral('false')
    else if (character === 'n') this.scanLiteral('null')
    else this.scanNumber()
  }

  private scanObject(depth: number): void {
    this.index += 1
    this.skipWhitespace()
    if (this.consume('}')) return
    const keys = new Set<string>()
    for (;;) {
      this.skipWhitespace()
      const key = this.scanString()
      if (keys.has(key)) invalidJson()
      keys.add(key)
      this.skipWhitespace()
      if (!this.consume(':')) invalidJson()
      this.scanValue(depth)
      this.skipWhitespace()
      if (this.consume('}')) return
      if (!this.consume(',')) invalidJson()
    }
  }

  private scanArray(depth: number): void {
    this.index += 1
    this.skipWhitespace()
    if (this.consume(']')) return
    for (;;) {
      this.scanValue(depth)
      this.skipWhitespace()
      if (this.consume(']')) return
      if (!this.consume(',')) invalidJson()
    }
  }

  private scanString(): string {
    const start = this.index
    if (!this.consume('"')) invalidJson()
    for (;;) {
      const character = this.text.charAt(this.index)
      if (character === '' || character.charCodeAt(0) < 0x20) invalidJson()
      this.index += 1
      if (character === '"') {
        const value: unknown = JSON.parse(this.text.slice(start, this.index))
        if (typeof value !== 'string') invalidJson()
        return value
      }
      if (character === '\\') this.scanEscape()
    }
  }

  private scanEscape(): void {
    const escaped = this.text[this.index]
    if (escaped === 'u') {
      const digits = this.text.slice(this.index + 1, this.index + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) invalidJson()
      this.index += 5
      return
    }
    if (!escaped || !'"\\/bfnrt'.includes(escaped)) invalidJson()
    this.index += 1
  }

  private scanNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index))
    if (!match) invalidJson()
    this.index += match[0].length
  }

  private scanLiteral(literal: string): void {
    if (!this.text.startsWith(literal, this.index)) invalidJson()
    this.index += literal.length
  }

  private consume(character: string): boolean {
    if (this.text[this.index] !== character) return false
    this.index += 1
    return true
  }

  private skipWhitespace(): void {
    while (' \n\r\t'.includes(this.text[this.index] ?? 'x')) this.index += 1
  }
}
