import { describe, expect, it } from 'vitest'
import { RouteCensusError, validateRouteCensusEntry } from '@/lib/graphos-api/route-census'

describe('route census entry validation', () => {
  it('accepts a generated-operation row that names its owning operation', () => {
    const entry = validateRouteCensusEntry({
      route: 'GET /api/ontology/classes',
      disposition: 'generated-operation',
      owning_operation: 'ontology.classes.list',
      caller: 'src/lib/graphos-api/ontology.ts',
      scope: 'ontology:read',
    })
    expect(entry.disposition).toBe('generated-operation')
  })

  it('accepts a ui-local row with no owning operation', () => {
    const entry = validateRouteCensusEntry({
      route: 'GET /favicon.ico',
      disposition: 'ui-local',
      owning_operation: null,
      caller: 'static',
      scope: null,
    })
    expect(entry.disposition).toBe('ui-local')
  })

  it('refuses a generated-operation row with no owning operation named', () => {
    expect(() =>
      validateRouteCensusEntry({
        route: 'GET /api/ontology/classes',
        disposition: 'generated-operation',
        owning_operation: null,
        caller: 'src/lib/graphos-api/ontology.ts',
        scope: 'ontology:read',
      }),
    ).toThrow(RouteCensusError)
  })

  it('refuses an unclassified disposition outright', () => {
    expect(() =>
      validateRouteCensusEntry({
        route: 'GET /api/prompts',
        disposition: 'unclassified',
        owning_operation: null,
        caller: 'unknown',
        scope: null,
      }),
    ).toThrow(RouteCensusError)
  })
})
