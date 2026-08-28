/**
 * Both reference adapters, end to end over a stubbed transport.
 *
 * They are deliberate opposites — `graph` has no query language and filters
 * client-side; `sparql` has one and pushes filters down — so between them these tests
 * exercise every branch of `ModalityAdapter`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import graphAdapter from '../adapters/graph'
import sparqlAdapter, { compileSparql, escapeSparqlLiteral } from '../adapters/sparql'
import { createClause } from '../filters'
import { DEFAULT_ATLAS_CONTEXT, EMPTY_FILTER_SET, type FilterSet } from '../types'

const ctx = DEFAULT_ATLAS_CONTEXT
const signal = new AbortController().signal

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function stubFetch(handler: (url: string) => Response): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch
}

const graph3dBody = {
  nodes: [
    { id: 'n1', type: 'Service', name: 'alpha' },
    { id: 'n2', type: 'Host', name: 'beta' },
  ],
  edges: [{ s: 0, t: 1, r: 'RUNS_ON', w: 1 }],
  total_nodes: 2,
  total_relationships: 1,
  engine_total_nodes: 2,
  engine_total_relationships: 1,
  connected_nodes: 2,
  isolated_nodes: 0,
  truncated: false,
  source_graphs: ['__commons__'],
  degraded_graphs: [],
  available: true,
}

const sparqlBody = {
  status: 'success',
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [{ s: { value: 'http://x/a' }, p: { value: 'http://x/p' }, o: { value: 'literal' } }],
  },
}

/** Compile-then-execute the graph adapter, which every graph case below does. */
function runGraph(filters: FilterSet) {
  return graphAdapter.execute({ query: graphAdapter.compile({ filters, ctx }), ctx, signal })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('capability declarations are structurally honest', () => {
  it.each([
    ['graph', graphAdapter],
    ['sparql', sparqlAdapter],
  ])('%s promises only what it implements', (_name, adapter) => {
    const capabilities = adapter.capabilities()
    expect(capabilities.graphProjection).toBe(adapter.toGraph !== undefined)
    expect(capabilities.rawQuery).toBe(adapter.parse !== undefined)
    expect(capabilities.pivots).toBe(adapter.pivots !== undefined)
    expect(capabilities.live).toBe(adapter.live !== undefined)
    expect(capabilities.filters.length).toBeGreaterThan(0)
  })
})

describe('graph adapter', () => {
  it('introspects node types into a searchable tree', async () => {
    stubFetch(() => jsonResponse({ by_type: { Service: 3, Host: 1 }, available: true }))
    const tree = await graphAdapter.introspect({ ctx, signal })
    expect(tree.unavailable).toBe(false)
    expect(tree.roots[0].children?.map((child) => child.label)).toEqual(['Service', 'Host'])
  })

  it('reports a missing introspection route as a stated absence, not an empty tree', async () => {
    stubFetch(() => jsonResponse({}, 404))
    const tree = await graphAdapter.introspect({ ctx, signal })
    expect(tree.unavailable).toBe(true)
    expect(tree.note).toContain('404')
  })

  it('executes and projects nodes, edges and rows', async () => {
    stubFetch(() => jsonResponse(graph3dBody))
    const result = await runGraph(EMPTY_FILTER_SET)
    expect(result.degraded).toBeNull()
    expect(result.stats.rowCount).toBe(2)
    expect(result.sources).toEqual(['__commons__'])
    expect(graphAdapter.toRows(result).rows[0].name).toBe('alpha')
    const projection = graphAdapter.toGraph?.(result)
    expect(projection?.nodes).toHaveLength(2)
    expect(projection?.edges).toEqual([{ source: 'n1', target: 'n2', type: 'RUNS_ON', weight: 1 }])
  })

  it('applies its client-side residual and drops edges whose endpoint was filtered out', async () => {
    stubFetch(() => jsonResponse(graph3dBody))
    const filters: FilterSet = { ...EMPTY_FILTER_SET, clauses: [createClause('type', 'eq', 'Service')] }
    const result = await runGraph(filters)
    expect(result.payload.nodes).toHaveLength(1)
    expect(result.payload.edges).toHaveLength(0)
    expect(result.stats.note).toContain('1 of 2')
  })

  it('degrades rather than throwing when the engine is unreachable', async () => {
    stubFetch(() => jsonResponse({}, 404))
    const result = await runGraph(EMPTY_FILTER_SET)
    expect(result.degraded).toContain('404')
    expect(result.payload.nodes).toHaveLength(0)
  })

  it('names the graphs it could not read', async () => {
    stubFetch(() => jsonResponse({ ...graph3dBody, degraded_graphs: ['agent:x'] }))
    const result = await runGraph(EMPTY_FILTER_SET)
    expect(result.degraded).toContain('agent:x')
  })

  it('describes the compiled query in plain language, since it has no query text', () => {
    expect(graphAdapter.describe(graphAdapter.compile({ filters: EMPTY_FILTER_SET, ctx }))).toContain('nodes')
    expect(graphAdapter.parse).toBeUndefined()
  })

  it('offers a same-modality type pivot and a cross-modality SPARQL pivot', () => {
    const pivots = graphAdapter.pivots?.({
      selection: { kind: 'node', id: 'http://x/a', label: 'a', type: 'Service', data: { type: 'Service' } },
      result: {} as never,
    })
    expect(pivots?.map((pivot) => pivot.targetAdapterId)).toEqual(['graph', 'sparql'])
    expect(pivots?.[1].seedQuery).toContain('<http://x/a>')
  })

  it('offers no SPARQL pivot for a non-IRI id', () => {
    const pivots = graphAdapter.pivots?.({
      selection: { kind: 'node', id: 'n1', label: 'n1', type: 'Service', data: {} },
      result: {} as never,
    })
    expect(pivots?.map((pivot) => pivot.targetAdapterId)).toEqual(['graph'])
  })

  it('offers nothing at all for a selection with neither a type nor an IRI', () => {
    const pivots = graphAdapter.pivots?.({
      selection: { kind: 'node', id: 'n1', label: 'n1', data: {} },
      result: {} as never,
    })
    expect(pivots).toEqual([])
  })
})

describe('sparql adapter', () => {
  it('escapes literals so a quote cannot terminate the query', () => {
    expect(escapeSparqlLiteral('a"b\\c')).toBe('a\\"b\\\\c')
  })

  it('pushes filters down into FILTER clauses', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      search: 'needle',
      clauses: [createClause('o', 'contains', 'x'), createClause('s', 'eq', 'y')],
      limit: 25,
    }
    const query = compileSparql({ filters, ctx })
    expect(query.text).toContain('CONTAINS(LCASE(STR(?o)), LCASE("x"))')
    expect(query.text).toContain('STR(?s) = "y"')
    expect(query.text).toContain('needle')
    expect(query.text).toContain('LIMIT 25')
  })

  it('joins clauses with || when the combinator is or', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      combinator: 'or',
      clauses: [createClause('o', 'eq', 'a'), createClause('o', 'eq', 'b')],
    }
    expect(compileSparql({ filters, ctx }).text).toContain(' || ')
  })

  it('emits no FILTER at all when there is nothing to filter', () => {
    expect(compileSparql({ filters: EMPTY_FILTER_SET, ctx }).text).not.toContain('FILTER')
  })

  it('clamps the limit to the context', () => {
    const filters: FilterSet = { ...EMPTY_FILTER_SET, limit: 100000 }
    expect(compileSparql({ filters, ctx: { ...ctx, limit: 10 } }).text).toContain('LIMIT 10')
  })

  it('round-trips describe -> parse', () => {
    const query = compileSparql({ filters: EMPTY_FILTER_SET, ctx })
    expect(sparqlAdapter.parse?.({ text: sparqlAdapter.describe(query), ctx })).toEqual(query)
  })

  it('introspects classes and seeds a query from each', async () => {
    stubFetch(() =>
      jsonResponse({
        status: 'success',
        head: { vars: ['class'] },
        results: { bindings: [{ class: { value: 'http://x/C' } }] },
      }),
    )
    const tree = await sparqlAdapter.introspect({ ctx, signal })
    expect(tree.roots[0].children?.[0].seedQuery).toContain('<http://x/C>')
  })

  it('executes, tabulates and projects triples into a graph', async () => {
    stubFetch(() => jsonResponse(sparqlBody))
    const result = await sparqlAdapter.execute({ query: { text: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }' }, ctx, signal })
    expect(result.stats.rowCount).toBe(1)
    expect(sparqlAdapter.toRows(result).columns.map((column) => column.label)).toEqual(['?s', '?p', '?o'])
    const projection = sparqlAdapter.toGraph?.(result)
    expect(projection?.nodes.map((node) => node.type)).toEqual(['Resource', 'Literal'])
  })

  it('declines to invent edges when the result is not triple-shaped', async () => {
    stubFetch(() => jsonResponse({ status: 'success', head: { vars: ['a', 'b'] }, results: { bindings: [] } }))
    const result = await sparqlAdapter.execute({ query: { text: 'SELECT ?a ?b WHERE {}' }, ctx, signal })
    const projection = sparqlAdapter.toGraph?.(result)
    expect(projection?.nodes).toHaveLength(0)
    expect(projection?.note).toContain('triple-shaped')
  })

  it('surfaces a backend error as degraded rather than throwing', async () => {
    stubFetch(() => jsonResponse({ status: 'error', message: 'bad syntax' }))
    const result = await sparqlAdapter.execute({ query: { text: 'NOPE' }, ctx, signal })
    expect(result.degraded).toBe('bad syntax')
    expect(result.stats.rowCount).toBe(0)
  })

  it('offers a describe pivot only for an IRI selection', () => {
    expect(
      sparqlAdapter.pivots?.({
        selection: { kind: 'cell', id: 'literal', label: 'l', data: {} },
        result: {} as never,
      }),
    ).toHaveLength(0)
    const pivots = sparqlAdapter.pivots?.({
      selection: { kind: 'cell', id: 'http://x/a', label: 'a', data: {} },
      result: {} as never,
    })
    expect(pivots?.[0].seedQuery).toContain('<http://x/a>')
  })
})
