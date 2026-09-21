import { afterEach, describe, expect, it, vi } from 'vitest'

import uqlAdapter, { compileUql, parseUql, UqlCompileError, UqlSafetyError } from '../adapters/uql'
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

function completeBundle(): Record<string, unknown> {
  return {
    answer_candidate: 'one result',
    claims: [{ id: 'n1', text: 'one' }],
    evidence_spans: [{ ref: 'source:n1' }],
    source_authority: { source: 'graph-os' },
    contradictions: [],
    confidence: null,
    freshness: { observed_at: '2026-08-29T00:00:00Z' },
    policy_exclusions: [],
    reasoning_trace: [],
    next_actions: [],
    error: null,
  }
}

function query(text: string, ctx = DEFAULT_ATLAS_CONTEXT) {
  return parseUql({ text, ctx })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UQL Atlas adapter', () => {
  it('declares the native UQL capabilities it implements', () => {
    const capabilities = uqlAdapter.capabilities()
    expect(capabilities.filters).toEqual(['eq', 'gt', 'lt'])
    expect(capabilities.rawQuery).toBe(uqlAdapter.parse !== undefined)
    expect(capabilities.rawQueryLanguage).toBe('uql')
    expect(capabilities.graphProjection).toBe(uqlAdapter.toGraph !== undefined)
    expect(capabilities.pivots).toBe(false)
    expect(capabilities.live).toBe(false)
  })

  it('compiles filters to native UQL and clamps the terminal limit', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      search: "graph's",
      clauses: [createClause('score', 'gt', 0.5), createClause('kind', 'eq', 'Tool')],
      limit: 99,
    }
    const compiled = compileUql({
      filters,
      ctx: {
        ...DEFAULT_ATLAS_CONTEXT,
        graph: '__commons__',
        limit: 12,
        options: { uqlLabel: 'Entity' },
      },
    })
    expect(compiled).toEqual({
      text: "MATCH (:Entity) |> WHERE score > 0.5 AND kind = 'Tool' |> TEXT 'graph''s' |> LIMIT 12",
      graph: '__commons__',
      limit: 12,
    })
    expect(compiled.text).not.toMatch(/\b(?:SELECT|RETURN)\b/i)
  })

  it('rejects filters that have no native UQL equivalent', () => {
    expect(() =>
      compileUql({
        filters: { ...EMPTY_FILTER_SET, clauses: [createClause('name', 'contains', 'api')] },
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(UqlCompileError)
    expect(() =>
      compileUql({
        filters: {
          ...EMPTY_FILTER_SET,
          combinator: 'or',
          clauses: [createClause('kind', 'eq', 'A'), createClause('kind', 'eq', 'B')],
        },
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(/conjunctions only/)
    expect(() =>
      compileUql({
        filters: { ...EMPTY_FILTER_SET, sort: { field: 'score', direction: 'desc' } },
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(/RANK/)
  })

  it('retains native source text and accepts native REASON and FOREIGN stages', () => {
    const raw = '  MATCH (:Entity) |> FOREIGN "postgres" |> LIMIT 3  '
    expect(query(raw)).toEqual({ text: raw, graph: null, limit: 3 })
    expect(query('MATCH (:Service) |> REASON Mammal |> LIMIT 1').limit).toBe(1)
    expect(query('MATCH (:Service) |> TEXT "api" |> LIMIT 2').limit).toBe(2)
    expect(() => query('FOREIGN "postgres" |> LIMIT 1')).toThrow(/native MATCH source/)
  })

  it('enforces the inclusive 1..1000 LIMIT contract', () => {
    expect(() => query('MATCH (:Entity) |> LIMIT 0')).toThrow(/at least 1/)
    expect(
      query('MATCH (:Entity) |> LIMIT 1000', {
        ...DEFAULT_ATLAS_CONTEXT,
        limit: 1000,
      }).limit,
    ).toBe(1000)
    expect(() =>
      query('MATCH (:Entity) |> LIMIT 1001', {
        ...DEFAULT_ATLAS_CONTEXT,
        limit: 1000,
      }),
    ).toThrow(/exceeds the active cap/)
  })

  it('rejects unsafe or unbounded console text before transport', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    expect(() =>
      parseUql({
        text: 'MATCH (:Entity) |> DELETE x |> LIMIT 1',
        ctx: DEFAULT_ATLAS_CONTEXT,
      }),
    ).toThrow(UqlSafetyError)
    expect(() => parseUql({ text: 'MATCH (:Entity) |> LOAD "file" |> LIMIT 1', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(
      UqlSafetyError,
    )
    expect(() => parseUql({ text: 'MATCH (:SET) |> LIMIT 1', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(UqlSafetyError)
    expect(() => parseUql({ text: 'MATCH (:Entity) SET x = 1 |> LIMIT 1', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(
      UqlSafetyError,
    )
    expect(() =>
      parseUql({ text: "MATCH (:Entity) |> TEXT 'DELETE' |> LIMIT 1", ctx: DEFAULT_ATLAS_CONTEXT }),
    ).not.toThrow()
    expect(() => parseUql({ text: 'MATCH (:Entity) |> LIMIT 501', ctx: DEFAULT_ATLAS_CONTEXT })).toThrow(
      /exceeds the active cap/,
    )
    const result = await uqlAdapter.execute({
      query: { text: 'MATCH (:Entity)', graph: null, limit: 0 },
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.degraded).toContain('terminal literal LIMIT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts unchanged UQL to the governed route and keeps bundle, plan, and provenance', async () => {
    const plan = { grammar_version: 'eg-plan.uql.v1', bounded: true }
    const provenance = {
      source_graphs: ['__commons__'],
      graph: '__commons__',
      connection: 'graph-os',
      citations: ['source:n1'],
    }
    const bundle = completeBundle()
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('/api/graph/query')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toEqual({
        query: 'MATCH (:Entity) |> LIMIT 1',
        params: '{}',
        scope: 'uql',
        graph: '__commons__',
      })
      return jsonResponse({
        status: 'success',
        result: {
          rows: [{ id: 'n1', score: 0.9, name: 'one' }],
          evidence_bundle: bundle,
          plan,
          provenance,
        },
      })
    })
    const result = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1', { ...DEFAULT_ATLAS_CONTEXT, graph: 'stale' }),
      ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: '__commons__' },
      signal,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.degraded).toBeNull()
    expect(result.payload.rows).toEqual([{ id: 'n1', score: 0.9, name: 'one' }])
    expect(result.payload.metadata.evidenceBundle).toEqual(bundle)
    expect(result.payload.metadata.plan).toEqual(plan)
    expect(result.payload.metadata.provenance).toMatchObject({
      sourceGraphs: ['__commons__'],
      graph: '__commons__',
      connection: 'graph-os',
      citations: ['source:n1'],
    })
    expect(result.sources).toEqual(['__commons__'])
    expect(result.stats).toMatchObject({ rowCount: 1, truncated: false })
    expect(uqlAdapter.toRows(result).rows).toEqual(result.payload.rows)
    const projection = uqlAdapter.toGraph?.(result)
    expect(projection?.nodes).toHaveLength(1)
    expect(projection?.edges).toEqual([])
    expect(projection?.note).toContain('unconnected')
  })

  it('recovers rows and sidecars from the complete EvidenceBundle trace', async () => {
    const plan = { stage: 'uql', limit: 1 }
    stubFetch(() =>
      jsonResponse({
        status: 'success',
        result: {
          ...completeBundle(),
          reasoning_trace: [
            {
              step: 'graph_query',
              payload: {
                rows: [{ id: 'n1', score: 0.7 }],
                plan,
                provenance: {
                  source_graphs: ['foreign:postgres'],
                  graph: 'foreign:postgres',
                },
              },
            },
          ],
        },
      }),
    )
    const result = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.payload.rows).toEqual([{ id: 'n1', score: 0.7 }])
    expect(result.payload.metadata.rowSource).toBe('trace')
    expect(result.payload.metadata.plan).toEqual(plan)
    expect(result.payload.metadata.provenance.sourceGraphs).toEqual(['foreign:postgres'])
    expect(result.payload.metadata.provenance.graph).toBe('foreign:postgres')
    expect(result.payload.metadata.evidenceBundle?.reasoning_trace).toHaveLength(1)
    expect(uqlAdapter.toGraph?.(result)?.edges).toEqual([])
  })

  it('flattens governed fan-out targets and retains partial-target evidence', async () => {
    const targetRows = {
      'graph:one': [{ id: 'n1', score: 0.9 }],
      'graph:two': [{ id: 'n2', score: 0.8 }],
    }
    stubFetch(() =>
      jsonResponse({
        status: 'success',
        result: {
          ...completeBundle(),
          reasoning_trace: [
            {
              step: 'graph_query',
              payload: {
                targets: targetRows,
                errors: { 'graph:three': { code: 'unavailable' } },
                graph: 'union',
              },
            },
          ],
        },
      }),
    )
    const result = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.payload.rows).toEqual([
      { id: 'n1', score: 0.9 },
      { id: 'n2', score: 0.8 },
    ])
    expect(result.payload.metadata.rowSource).toBe('targets')
    expect(result.payload.metadata.provenance.sourceGraphs).toEqual(
      expect.arrayContaining(['graph:one', 'graph:two', 'union']),
    )
    expect(result.payload.metadata.provenance.degradedGraphs).toContain('graph:three')
    expect(result.degraded).toContain('graph:three')
  })

  it('keeps degraded native FOREIGN and REASON results explicit', async () => {
    stubFetch(() => jsonResponse({ status: 'degraded', message: 'FOREIGN source unavailable' }))
    const foreign = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> FOREIGN "postgres" |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(foreign.payload.rows).toEqual([])
    expect(foreign.degraded).toBe('FOREIGN source unavailable')

    stubFetch(() => jsonResponse({ status: 'degraded', message: 'REASON capability unavailable' }))
    const reason = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> REASON Mammal |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(reason.payload.rows).toEqual([])
    expect(reason.degraded).toBe('REASON capability unavailable')
  })

  it('does not expose raw credential-bearing metadata and keeps claims table-only', async () => {
    const secret = 'postgres://user:password@db.example.test:5432/catalog?token=abc'
    stubFetch(() =>
      jsonResponse({
        status: 'success',
        result: {
          rows: [{ id: 'n1' }],
          provenance: {
            source_graphs: ['safe-graph'],
            graph: 'safe-graph',
            connection: 'graph-os',
            dsn: secret,
            endpoint: 'https://db.example.test/query',
            citations: [secret, 'source:n1'],
          },
          plan: { grammar_version: 'eg-plan.uql.v1', password: secret },
          leaked: secret,
        },
      }),
    )
    const rowResult = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(JSON.stringify(rowResult.payload.metadata)).not.toContain(secret)
    expect(rowResult.payload.metadata.provenance.citations).toEqual(['source:n1'])
    expect(rowResult.payload.metadata.provenance).not.toHaveProperty('raw')
    expect(rowResult.payload.metadata).not.toHaveProperty('raw')

    stubFetch(() => jsonResponse({ status: 'success', result: completeBundle() }))
    const claims = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(claims.payload.metadata.rowSource).toBe('claims')
    expect(uqlAdapter.toGraph?.(claims)).toMatchObject({ nodes: [], edges: [] })
    expect(uqlAdapter.toGraph?.(claims)?.note).toContain('not projectable')
  })

  it('returns a stated unavailable result for an absent UQL capability', async () => {
    stubFetch(() => jsonResponse({}, 404))
    const result = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(result.shape).toBe('empty')
    expect(result.payload.rows).toEqual([])
    expect(result.degraded).toContain('404')
  })

  it('degrades on status errors and malformed row payloads without coercion', async () => {
    stubFetch(() => jsonResponse({ status: 'error', message: 'UQL parser unavailable' }))
    const statusError = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(statusError.degraded).toBe('UQL parser unavailable')

    stubFetch(() => jsonResponse({ rows: [{ id: 'valid' }, 42] }))
    const malformed = await uqlAdapter.execute({
      query: query('MATCH (:Entity) |> LIMIT 1'),
      ctx: DEFAULT_ATLAS_CONTEXT,
      signal,
    })
    expect(malformed.payload.rows).toEqual([])
    expect(malformed.degraded).toContain('API shape violation')
  })

  it('reports introspection absence separately from an empty label catalog', async () => {
    stubFetch((url) => {
      expect(url).toBe('/api/enhanced/graph/node-types')
      return jsonResponse({ by_type: { Service: 3 }, available: true, partial: true })
    })
    const tree = await uqlAdapter.introspect({ ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(tree.unavailable).toBe(false)
    expect(tree.roots[0].children?.[0].seedQuery).toBe('MATCH (:Service) |> LIMIT 200')
    expect(tree.roots[1].children?.map((child) => child.id)).toEqual(['id', 'score'])
    expect(tree.note).toContain('partial')

    stubFetch(() => jsonResponse({}, 404))
    const unavailable = await uqlAdapter.introspect({ ctx: DEFAULT_ATLAS_CONTEXT, signal })
    expect(unavailable.unavailable).toBe(true)
    expect(unavailable.note).toContain('404')

    stubFetch((url) => {
      expect(url).toBe('/api/enhanced/graph/node-types?graph=agent%3Aone')
      return jsonResponse({ by_type: { Service: 1 }, available: true })
    })
    const scoped = await uqlAdapter.introspect({
      ctx: { ...DEFAULT_ATLAS_CONTEXT, graph: 'agent:one' },
      signal,
    })
    expect(scoped.unavailable).toBe(false)
  })
})
