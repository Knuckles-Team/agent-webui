import { describe, expect, it } from 'vitest'

import { defaultAdapterId } from '../useAtlas'
import { atlasReducer, initialAtlasState, type AtlasState } from '../workbench'
import { EMPTY_FILTER_SET, type Pivot, type Selection } from '../types'
import { createClause } from '../filters'

const selection: Selection = { kind: 'node', id: 'n1', label: 'N1', data: {} }

function withFilters(state: AtlasState): AtlasState {
  return atlasReducer(state, {
    type: 'setFilters',
    filters: { ...EMPTY_FILTER_SET, clauses: [createClause('name', 'eq', 'x')] },
  })
}

describe('atlasReducer', () => {
  const base = initialAtlasState('graph')

  it('starts on the first adapter with nothing submitted', () => {
    expect(base.adapterId).toBe('graph')
    expect(base.submitted).toBeNull()
  })

  it('drops filters when the modality changes, because fields are modality-scoped', () => {
    const filtered = withFilters(base)
    const switched = atlasReducer(filtered, { type: 'selectAdapter', adapterId: 'sparql' })
    expect(switched.filters.clauses).toHaveLength(0)
    expect(switched.consoleDirty).toBe(false)
    expect(switched.submitted).toBeNull()
  })

  it('marks the console dirty only once the user edits it', () => {
    expect(base.consoleDirty).toBe(false)
    expect(atlasReducer(base, { type: 'setConsoleText', text: 'SELECT 1' }).consoleDirty).toBe(true)
  })

  it('sends edited text with the run, and null when the facets built the query', () => {
    const edited = atlasReducer(base, { type: 'setConsoleText', text: 'SELECT 1' })
    expect(atlasReducer(edited, { type: 'run' }).submitted?.text).toBe('SELECT 1')
    expect(atlasReducer(base, { type: 'run' }).submitted?.text).toBeNull()
  })

  it('bumps the nonce on every run so an identical query re-runs', () => {
    const once = atlasReducer(base, { type: 'run' })
    const twice = atlasReducer(once, { type: 'run' })
    expect(twice.submitted?.nonce).toBe((once.submitted?.nonce ?? 0) + 1)
  })

  it('resets a filter edit back to the compiled console text', () => {
    const edited = atlasReducer(base, { type: 'setConsoleText', text: 'SELECT 1' })
    expect(withFilters(edited).consoleDirty).toBe(false)
  })

  it('applies a pivot as switch + filters + seed + run, and clears the selection', () => {
    const pivot: Pivot = {
      id: 'p1',
      label: 'Describe',
      targetAdapterId: 'sparql',
      filters: EMPTY_FILTER_SET,
      seedQuery: 'SELECT ?p ?o WHERE { <x> ?p ?o }',
    }
    const selected = atlasReducer(base, { type: 'select', selection })
    const pivoted = atlasReducer(selected, { type: 'applyPivot', pivot })
    expect(pivoted.adapterId).toBe('sparql')
    expect(pivoted.consoleDirty).toBe(true)
    expect(pivoted.consoleText).toBe(pivot.seedQuery)
    expect(pivoted.selection).toBeNull()
    expect(pivoted.submitted?.text).toBe(pivot.seedQuery)
  })

  it('keeps counting nonces across a pivot so the new query is not a cache hit', () => {
    const ran = atlasReducer(base, { type: 'run' })
    const pivoted = atlasReducer(ran, {
      type: 'applyPivot',
      pivot: { id: 'p', label: 'p', targetAdapterId: 'graph', filters: EMPTY_FILTER_SET },
    })
    expect(pivoted.submitted?.nonce).toBe(2)
  })

  it('merges a partial context rather than replacing it', () => {
    const next = atlasReducer(base, { type: 'setContext', ctx: { graph: '__commons__' } })
    expect(next.ctx.graph).toBe('__commons__')
    expect(next.ctx.limit).toBe(base.ctx.limit)
  })

  it('records an explicit renderer choice and a selection', () => {
    expect(atlasReducer(base, { type: 'setRenderer', rendererId: 'graph3d' }).rendererId).toBe('graph3d')
    expect(atlasReducer(base, { type: 'select', selection }).selection).toEqual(selection)
  })

  it('seeds a query from the source tree', () => {
    const seeded = atlasReducer(base, { type: 'seedQuery', text: 'SELECT 2' })
    expect(seeded.consoleText).toBe('SELECT 2')
    expect(seeded.consoleDirty).toBe(true)
  })
})

describe('defaultAdapterId', () => {
  it('prefers the graph adapter regardless of discovery order', () => {
    expect(defaultAdapterId([{ id: 'cypher' }, { id: 'sparql' }, { id: 'graph' }])).toBe('graph')
  })

  it('falls back to the first available adapter when graph is unavailable', () => {
    expect(defaultAdapterId([{ id: 'sparql' }, { id: 'sql' }])).toBe('sparql')
  })

  it('returns the empty adapter id when nothing was discovered', () => {
    expect(defaultAdapterId([])).toBe('')
  })
})
