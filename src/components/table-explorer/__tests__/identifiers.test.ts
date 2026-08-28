import { describe, expect, it } from 'vitest'
import { escapeSqlLiteral, isSafeIdentifier, quoteIdentifier, quoteLiteral, quoteRelation } from '../identifiers'

describe('isSafeIdentifier', () => {
  it('accepts plain alphanumeric/underscore tokens', () => {
    expect(isSafeIdentifier('widgets')).toBe(true)
    expect(isSafeIdentifier('Widget_2')).toBe(true)
  })

  it('rejects anything with punctuation, quotes, or whitespace', () => {
    expect(isSafeIdentifier('widgets; DROP TABLE x')).toBe(false)
    expect(isSafeIdentifier('wid"gets')).toBe(false)
    expect(isSafeIdentifier('wid gets')).toBe(false)
    expect(isSafeIdentifier('')).toBe(false)
  })
})

describe('quoteIdentifier', () => {
  it('double-quotes a safe identifier', () => {
    expect(quoteIdentifier('widgets')).toBe('"widgets"')
  })

  it('throws rather than quoting an unsafe identifier', () => {
    expect(() => quoteIdentifier('widgets"; DROP TABLE x --')).toThrow()
  })
})

describe('quoteRelation', () => {
  it('dot-joins two quoted identifiers', () => {
    expect(quoteRelation('public', 'widgets')).toBe('"public"."widgets"')
  })

  it('throws on an unsafe schema or table name', () => {
    expect(() => quoteRelation('public; --', 'widgets')).toThrow()
  })
})

describe('escapeSqlLiteral / quoteLiteral', () => {
  it('doubles embedded single quotes', () => {
    expect(escapeSqlLiteral("o'brien")).toBe("o''brien")
  })

  it('strips embedded NUL bytes', () => {
    const withNul = `a${String.fromCharCode(0)}b`
    expect(escapeSqlLiteral(withNul)).toBe('ab')
  })

  it('quoteLiteral wraps the escaped text in single quotes', () => {
    expect(quoteLiteral("'; DROP TABLE widgets; --")).toBe("'''; DROP TABLE widgets; --'")
  })
})
