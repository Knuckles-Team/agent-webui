import { afterEach, describe, expect, it, vi } from 'vitest'

import cypherAdapter, { compileCypher, CypherCompileError, CypherSafetyError } from '../adapters/cypher'
import { createClause } from '../filters'
import { DEFAULT_ATLAS_CONTEXT, EMPTY_FILTER_SET, type FilterSet } from '../types'

const signal = new AbortController().signal

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Cypher Atlas adapter', () => {
  it('declares only capabilities backed by adapter members', () => {
    const capabilities = cypherAdapter.capabilities()
    expect(capabilities.rawQuery).toBe(cypherAdapter.parse !== undefined)
    expect(capabilities.graphProjection).toBe(cypherAdapter.toGraph !== undefined)
    expect(capabilities.pivots).toBe(cypherAdapter.pivots !== undefined)
    expect(capabilities.live).toBe(cypherAdapter.live !== undefined)
    expect(capabilities.rawQueryLanguage).toBe('cypher')
  })

  it('compiles bounded, parameterized filters and graph context', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      search: 'needle',
      clauses: [createClause('type', 'eq', 'Service'), createClause('name', 'contains', 'api')],
      sort: { field: 'name', direction: 'asc' },
      limit: 25,
    }
    const query = compileCypher({ filters, ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: 'team:demo' } })
    expect(query.graph).toBe('team:demo')
    expect(query.text).toContain('n.node_type = $atlas_filter_0')
    expect(query.text).toContain('toLower(n.name) CONTAINS toLower($atlas_filter_1)')
    expect(query.text).toContain('ORDER BY n.name ASC')
    expect(query.text).toContain('LIMIT 25')
    expect(query.params).toEqual({ atlas_filter_0: 'Service', atlas_filter_1: 'api', atlas_search: 'needle' })
  })

  it('parses raw console text while carrying the active graph context', () => {
    const query = cypherAdapter.parse?.({
      text: 'MATCH (n) RETURN n LIMIT 100',
      ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: 'team:demo' },
    })
    expect(query).toEqual({ text: 'MATCH (n) RETURN n LIMIT 100', params: {}, graph: 'team:demo', limit: 100 })
  })

  it('rejects unsupported filter fields and operators instead of dropping them', () => {
    expect(() =>
      compileCypher({
        filters: { ...EMPTY_FILTER_SET, clauses: [createClause('created_at', 'eq', 'today')] },
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(CypherCompileError)
    expect(() =>
      compileCypher({
        filters: { ...EMPTY_FILTER_SET, clauses: [createClause('name', 'startsWith', 'api')] },
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(/Unsupported Cypher filter operator/)
  })

  it('rejects unsafe raw text before the network boundary', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    expect(() => cypherAdapter.parse?.({ text: 'MATCH (n) RETURN n', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(
      CypherSafetyError,
    )
    const result = await cypherAdapter.execute({
      query: { text: 'MATCH (n) RETURN n', params: {}, graph: null, limit: null },
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.degraded).toContain('terminal literal LIMIT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects write and procedure clauses without treating quoted text as executable', () => {
    expect(() =>
      cypherAdapter.parse?.({
        text: 'MATCH (n) DETACH DELETE n RETURN n LIMIT 1',
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(/read-only Cypher/)
    expect(() =>
      cypherAdapter.parse?.({
        text: 'CALL db.labels() YIELD label RETURN label LIMIT 10',
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(/read-only Cypher/)
    expect(
      cypherAdapter.parse?.({
        text: "MATCH (n) WHERE n.name = 'create' RETURN n LIMIT 1",
        ctx: DEFAULT_ATLAS_CONTEXT,
      }).limit,
    ).toBe(1)
  })

  it('rejects a raw limit above the active cap', () => {
    expect(() => cypherAdapter.parse?.({ text: 'MATCH (n) RETURN n LIMIT 501', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(
      /exceeds the active cap/,
    )
  })

  it('executes the governed graph-query route and forwards an explicit graph', async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('/api/graph/query')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.query).toBe('MATCH (n) RETURN n.id AS id LIMIT 1')
      expect(body.params).toBe('{}')
      expect(body.scope).toBe('local')
      expect(body.graph).toBe('__commons__')
      return jsonResponse({
        status: 'success',
        result: {
          claims: [],
          error: null,
          reasoning_trace: [
            {
              step: 'graph_query',
              payload: {
                rows: [{ id: 'n1', name: 'one', type: 'Thing' }],
                connection: 'default',
                graph: '__commons__',
              },
            },
          ],
        },
      })
    })
    const query = {
      text: 'MATCH (n) RETURN n.id AS id LIMIT 1',
      params: {},
      graph: 'stale-context',
      limit: 1,
    }
    const result = await cypherAdapter.execute({
      query,
      ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: '__commons__' },
      signal,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.degraded).toBeNull()
    expect(result.payload.rows).toEqual([{ id: 'n1', name: 'one', type: 'Thing' }])
    expect(result.sources).toEqual(['__commons__'])
    expect(result.stats.truncated).toBe(false)
    expect(result.payload.metadata?.claims).toEqual([])
    expect(result.payload.metadata?.reasoningTrace).toHaveLength(1)
  })

  it('keeps a genuine empty result distinct from an unavailable route', async () => {
    stubFetch(() =>
      jsonResponse({
        status: 'success',
        result: {
          claims: [],
          error: null,
          reasoning_trace: [{ step: 'graph_query', payload: { rows: [], graph: '' } }],
        },
      }),
    )
    const query = { text: 'MATCH (n) RETURN n LIMIT 1', params: {}, graph: null, limit: 1 }
    const empty = await cypherAdapter.execute({ query, ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(empty.shape).toBe('empty')
    expect(empty.degraded).toBeNull()

    stubFetch(() => jsonResponse({}, 404))
    const unavailable = await cypherAdapter.execute({ query, ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(unavailable.shape).toBe('empty')
    expect(unavailable.degraded).toContain('404')
  })

  it('uses explicit backend truncation metadata instead of row-count equality', async () => {
    stubFetch(() => jsonResponse({ rows: [{ id: 'n1' }], graph: '__commons__', has_more: true }))
    const result = await cypherAdapter.execute({
      query: { text: 'MATCH (n) RETURN n.id AS id LIMIT 1', params: {}, graph: null, limit: 1 },
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.stats.truncated).toBe(true)
    expect(result.payload.metadata?.hasMore).toBe(true)
    expect(result.sources).toEqual(['__commons__'])
  })

  it('degrades on a response shape violation instead of coercing it to empty rows', async () => {
    stubFetch(() => jsonResponse(42))
    const result = await cypherAdapter.execute({
      query: { text: 'MATCH (n) RETURN n.id AS id LIMIT 1', params: {}, graph: null, limit: 1 },
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.payload.rows).toEqual([])
    expect(result.degraded).toContain('API shape violation')
  })

  it('introspects node types through the union route and reports partial reads', async () => {
    stubFetch((url) => {
      expect(url).toBe('/api/enhanced/graph/node-types')
      return jsonResponse({
        by_type: { Service: 3, Host: 1 },
        available: true,
        partial: true,
        degraded_graphs: ['agent:x'],
      })
    })
    const tree = await cypherAdapter.introspect({ ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(tree.unavailable).toBe(false)
    expect(tree.roots[0].children?.map((node) => node.label)).toEqual(['Service', 'Host'])
    expect(tree.note).toContain('agent:x')
  })

  it('does not treat a missing node-type breakdown as an empty catalog', async () => {
    stubFetch(() => jsonResponse({}))
    const tree = await cypherAdapter.introspect({ ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(tree.unavailable).toBe(true)
    expect(tree.note).toContain('no breakdown')
  })

  it('uses the explicit-graph query route for scoped introspection', async () => {
    stubFetch((url, init) => {
      expect(url).toBe('/api/graph/query')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.graph).toBe('agent:one')
      return jsonResponse({
        status: 'success',
        result: {
          claims: [],
          error: null,
          reasoning_trace: [
            { step: 'graph_query', payload: { rows: [{ type: 'Service', count: 2 }], graph: 'agent:one' } },
          ],
        },
      })
    })
    const tree = await cypherAdapter.introspect({ ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: 'agent:one' }, signal })
    expect(tree.unavailable).toBe(false)
    expect(tree.roots[0].children?.[0].count).toBe(2)
  })

  it('tabulates rows, projects matching _id links, and offers pivots', () => {
    const result = {
      adapterId: 'cypher',
      shape: 'rows' as const,
      payload: {
        rows: [
          { id: 'n1', name: 'one', type: 'Thing', parent_id: 'n2' },
          { id: 'n2', name: 'two', type: 'Thing', parent_id: '' },
        ],
        connection: null,
        graph: null,
        errors: null,
      },
      stats: { elapsedMs: 1, rowCount: 2, truncated: false },
      degraded: null,
      sources: [],
    }
    expect(cypherAdapter.toRows(result).columns.map((column) => column.key)).toEqual([
      'id',
      'name',
      'type',
      'parent_id',
    ])
    const projection = cypherAdapter.toGraph?.(result)
    expect(projection?.edges).toEqual([{ source: 'n1', target: 'n2', type: 'parent_id' }])
    const pivots = cypherAdapter.pivots?.({
      selection: {
        kind: 'node',
        id: 'http://example.test/n1',
        label: 'one',
        type: 'Thing',
        data: { type: 'Thing' },
      },
      result,
    })
    expect(pivots?.map((pivot) => pivot.targetAdapterId)).toEqual(['cypher', 'cypher', 'sparql'])
    expect(pivots?.[0].seedQuery).toContain("n.id = 'http://example.test/n1'")
  })
})
