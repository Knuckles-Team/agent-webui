import { describe, expect, it } from 'vitest'

import {
  applyFilterSet,
  createClause,
  describeFilterSet,
  isValuelessOperator,
  matchesClause,
  matchesFilterSet,
  operatorsForType,
  readField,
} from '../filters'
import { ALL_FILTER_OPERATORS, EMPTY_FILTER_SET, type FilterSet, type Row } from '../types'

const rows: Row[] = [
  { id: 'a', name: 'Alpha', size: 10, nested: { deep: 'yes' } },
  { id: 'b', name: 'Beta', size: 2, nested: { deep: 'no' } },
  { id: 'c', name: 'Gamma', size: 30 },
]

function filters(overrides: Partial<FilterSet>): FilterSet {
  return { ...EMPTY_FILTER_SET, ...overrides }
}

describe('readField', () => {
  it('reads a flat key', () => {
    expect(readField(rows[0], 'name')).toBe('Alpha')
  })

  it('reads a dotted path', () => {
    expect(readField(rows[0], 'nested.deep')).toBe('yes')
  })

  it('returns undefined for a missing path', () => {
    expect(readField(rows[2], 'nested.deep')).toBeUndefined()
  })
})

describe('matchesClause', () => {
  const cases: [string, Row, ReturnType<typeof createClause>, boolean][] = [
    ['eq hit', rows[0], createClause('name', 'eq', 'Alpha'), true],
    ['eq miss', rows[1], createClause('name', 'eq', 'Alpha'), false],
    ['neq', rows[1], createClause('name', 'neq', 'Alpha'), true],
    ['contains is case-insensitive', rows[0], createClause('name', 'contains', 'lph'), true],
    ['startsWith', rows[2], createClause('name', 'startsWith', 'gam'), true],
    ['gt compares numerically', rows[2], createClause('size', 'gt', 20), true],
    ['gt does not compare "30" < "4" lexically', rows[2], createClause('size', 'gt', 4), true],
    ['lte', rows[1], createClause('size', 'lte', 2), true],
    ['in', rows[1], createClause('name', 'in', ['Beta', 'Gamma']), true],
    ['exists', rows[0], createClause('nested', 'exists'), true],
    ['missing', rows[2], createClause('nested', 'missing'), true],
  ]

  it.each(cases)('%s', (_label, row, clause, expected) => {
    expect(matchesClause(row, clause)).toBe(expected)
  })
})

describe('matchesFilterSet', () => {
  it('ANDs clauses by default', () => {
    const set = filters({ clauses: [createClause('name', 'contains', 'a'), createClause('size', 'gt', 20)] })
    expect(rows.filter((row) => matchesFilterSet(row, set))).toHaveLength(1)
  })

  it('ORs when the combinator says so', () => {
    const set = filters({
      combinator: 'or',
      clauses: [createClause('name', 'eq', 'Alpha'), createClause('name', 'eq', 'Beta')],
    })
    expect(rows.filter((row) => matchesFilterSet(row, set))).toHaveLength(2)
  })

  it('ANDs free-text search on top of the clauses rather than widening them', () => {
    const set = filters({ search: 'gamma', combinator: 'or', clauses: [createClause('name', 'eq', 'Alpha')] })
    expect(rows.filter((row) => matchesFilterSet(row, set))).toHaveLength(0)
  })

  it('matches everything when empty', () => {
    expect(rows.every((row) => matchesFilterSet(row, EMPTY_FILTER_SET))).toBe(true)
  })
})

describe('applyFilterSet', () => {
  it('filters, sorts and caps', () => {
    const set = filters({ sort: { field: 'size', direction: 'desc' }, limit: 2 })
    expect(applyFilterSet(rows, set).map((row) => row.id)).toEqual(['c', 'a'])
  })
})

describe('operator metadata', () => {
  it('offers ordered operators for numbers and text operators for strings', () => {
    expect(operatorsForType('number', ALL_FILTER_OPERATORS)).toContain('gte')
    expect(operatorsForType('string', ALL_FILTER_OPERATORS)).not.toContain('gte')
  })

  it('intersects with what the adapter supports', () => {
    expect(operatorsForType('string', ['eq'])).toEqual(['eq'])
  })

  it('knows which operators take no value', () => {
    expect(isValuelessOperator('exists')).toBe(true)
    expect(isValuelessOperator('eq')).toBe(false)
  })
})

describe('describeFilterSet', () => {
  it('renders a readable line for a non-textual modality', () => {
    const set = filters({ search: 'x', clauses: [createClause('name', 'contains', 'al')], limit: 50 })
    expect(describeFilterSet(set)).toBe('search "x" name contains "al" limit 50')
  })
})
