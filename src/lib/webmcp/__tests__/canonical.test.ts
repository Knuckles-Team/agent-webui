import { describe, expect, it } from 'vitest'
import { canonicalJson, digestJson } from '../canonical'

const CANONICAL_VECTOR = {
  z: [true, null, 9_007_199_254_740_991, -9_007_199_254_740_991],
  a: 'café 雪 😀',
  '\uE000': 'bmp-private-use',
  '😀': 'astral',
  nested: { beta: 2, alpha: 1 },
}

const CANONICAL_JSON =
  '{"a":"café 雪 😀","nested":{"alpha":1,"beta":2},"z":[true,null,9007199254740991,-9007199254740991],"😀":"astral","":"bmp-private-use"}'

describe('cross-language WebMCP canonical JSON', () => {
  it('matches the shared UTF-16 key ordering and safe-integer digest vector', async () => {
    expect(canonicalJson(CANONICAL_VECTOR)).toBe(CANONICAL_JSON)
    await expect(digestJson(CANONICAL_VECTOR)).resolves.toBe(
      'sha256:d8fc415c3a0c2de5f586eed3e8a6be46807b24ef0110f398e8a2157425df1862',
    )
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_992])(
    'rejects a non-safe integer value %s',
    (value) => {
      expect(() => canonicalJson({ value })).toThrow('non-safe integer')
    },
  )

  it('rejects lone surrogates and structures JSON cannot represent exactly', () => {
    const invalidKey = Object.fromEntries([['\uDC00', 'invalid-key']])
    const sparse = Array<unknown>(2)
    sparse[1] = 'sparse'
    expect(() => canonicalJson({ value: '\uD800' })).toThrow('lone surrogate')
    expect(() => canonicalJson(invalidKey)).toThrow('lone surrogate')
    expect(() => canonicalJson(new Date(0))).toThrow('non-JSON object')
    expect(() => canonicalJson(sparse)).toThrow('sparse or extended array')
  })
})
