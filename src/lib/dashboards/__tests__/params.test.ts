import { describe, expect, it } from 'vitest'
import { placeholders, resolveQuery } from '../params'

// spec: OVERSTORY-DASH-R013
describe('dashboard parameters (OVERSTORY-DASH-R013)', () => {
  const params = [
    { name: 'kind', label: 'Kind', type: 'text' as const, value: 'Agent' },
    { name: 'top', label: 'Top', type: 'number' as const, value: 5 },
  ]

  it('substitutes typed values', () => {
    expect(resolveQuery('MATCH (:T) |> WHERE kind = {{kind}} |> LIMIT {{ top }}', params)).toBe(
      'MATCH (:T) |> WHERE kind = "Agent" |> LIMIT 5',
    )
    expect(placeholders('{{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('refuses unknown names, quote injection and non-numbers', () => {
    expect(() => resolveQuery('{{nope}}', params)).toThrow(/unknown parameter/)
    expect(() => resolveQuery('{{kind}}', [{ ...params[0], value: 'x" |> DELETE' }])).toThrow(/unsupported/)
    expect(() => resolveQuery('{{top}}', [{ ...params[1], value: Number.NaN }])).toThrow(/number/)
  })
})
