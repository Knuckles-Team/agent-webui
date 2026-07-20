import { describe, expect, it } from 'vitest'

import { normalizeBaseColor } from '../use-theme-colorizer'

describe('normalizeBaseColor', () => {
  it('canonicalizes finite in-range OKLCH components', () => {
    expect(normalizeBaseColor(' 0.52   0.18  260 ')).toBe('0.52 0.18 260')
    expect(normalizeBaseColor('1 .5 -360')).toBe('1 0.5 -360')
  })

  it.each([
    "0.5 0.2 260')/><script>alert(1)</script>",
    'NaN 0.2 260',
    '0.5 Infinity 260',
    '1.1 0.2 260',
    '0.5 0.6 260',
    '0.5 0.2 361',
  ])('rejects unsafe or out-of-range color %s', (value) => {
    expect(normalizeBaseColor(value)).toBeNull()
  })
})
