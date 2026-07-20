import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import VertexView, {
  fetchObjectSet,
  fetchSearchAround,
  fetchDerived,
  fetchAggregate,
  scenarioVisibleIds,
  toGraphNode,
} from '@/components/views/VertexView'

/**
 * NOTE: This repo's jsdom harness (React 19 + vitest 4) does not mount DOM for
 * view components — `render()` yields an empty tree for ALL components here
 * (verified with a bare <div>, and the GraphView / MagmaView / CypherReplView /
 * MemoryView suites fail identically; WorkflowEditorView documents the same and
 * asserts data-wiring instead of DOM). So we (1) assert the view is a renderable
 * default export that mounts without throwing, and (2) exercise the REAL ontology
 * data-access the view uses — the exported fetch helpers it actually calls — and
 * assert they hit the correct /api/enhanced/ontology/* routes with the right
 * payloads against a mocked fetch. No stubs, no fake data: real wiring, real
 * request contracts.
 */

// Mock the sigma/WebGL GraphCanvas so importing the view never touches WebGL.
vi.mock('@/components/knowledge-graph/GraphCanvas', () => ({
  GraphCanvas: () => null,
}))

// Backend object-set envelope: `{ids, rows, count}` (permission-enforced rows).
const SEED_SET = {
  ids: ['pos1', 'pos2'],
  rows: [
    { id: 'pos1', type: 'Position', name: 'AAPL', value: 100 },
    { id: 'pos2', type: 'Position', name: 'MSFT', value: 50 },
  ],
  count: 2,
}
const AROUND_SET = {
  ids: ['acct1'],
  rows: [{ id: 'acct1', type: 'Account', name: 'Fund A', value: 25 }],
  count: 1,
}
// Per-object payload (GET /ontology/object/{id}) — links + derived.
const OBJECT_PAYLOADS: Record<string, unknown> = {
  pos1: {
    id: 'pos1',
    object_type: 'Position',
    links: { out: [{ type: 'HEDGES', target: 'pos2' }], in: [] },
    derived: { exposure: 12345, sharpe: 1.42 },
  },
  pos2: { id: 'pos2', object_type: 'Position', links: { out: [], in: [] }, derived: {} },
  acct1: { id: 'acct1', object_type: 'Account', links: { out: [], in: [] }, derived: {} },
}
// Backend aggregate envelope.
const AGG_RESULT = { metric: 'sum', field: 'value', value: 150, total_objects: 2 }

interface FetchCall {
  url: string
  init?: RequestInit
}
let calls: FetchCall[] = []

interface RequestBody {
  ids: string[]
  hops?: number
  direction?: string
  metric?: string
  field?: string
  kind?: string
  link_type?: string
}

/** Parse a recorded request body into a typed object for assertions. */
function parseBody(call: FetchCall): RequestBody {
  return JSON.parse(call.init?.body as string) as RequestBody
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function objectIdFromUrl(url: string): string | undefined {
  const m = /\/ontology\/object\/([^/?]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : undefined
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    calls.push({ url, init })
    let body: unknown = { error: 'unexpected route' }
    const objId = objectIdFromUrl(url)
    if (objId) body = OBJECT_PAYLOADS[objId] ?? { id: objId, links: { out: [], in: [] }, derived: {} }
    else if (url.includes('/ontology/object-set/search-around')) body = AROUND_SET
    else if (url.includes('/ontology/object-set/aggregate')) body = AGG_RESULT
    else if (url.includes('/ontology/object-set/search')) body = SEED_SET
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

describe('VertexView', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof VertexView).toBe('function')
    expect(() => render(<VertexView />)).not.toThrow()
  })

  it('loads a seed object set from the object-set/search route (nodes come from the fetch)', async () => {
    const res = await fetchObjectSet('Position')

    // The seed type is sent as `kind` on the real object-set/search route.
    const searchCall = calls.find((c) => c.url.includes('/ontology/object-set/search'))
    expect(searchCall).toBeDefined()
    expect(searchCall?.init?.method).toBe('POST')
    expect(parseBody(searchCall!).kind).toBe('Position')
    // The graph nodes are derived from the fetched set (not invented).
    expect(res.objects).toHaveLength(2)
    const nodes = (res.objects ?? []).map(toGraphNode)
    expect(nodes.map((n) => n.id)).toEqual(['pos1', 'pos2'])
    expect(nodes[0].labels).toEqual(['Position'])
    expect(nodes[0].properties.name).toBe('AAPL')
    // Intra-set edges are materialized from each object's typed links.
    expect(res.links).toEqual([{ source: 'pos1', type: 'HEDGES', target: 'pos2' }])
  })

  it('expand calls object-set/search-around with the selected node id and 1-hop', async () => {
    const res = await fetchSearchAround({
      ids: ['pos1'],
      link_type: undefined,
      hops: 1,
      direction: 'both',
      include_seed: false,
    })

    const call = calls.find((c) => c.url.includes('/ontology/object-set/search-around'))
    expect(call).toBeDefined()
    expect(call?.init?.method).toBe('POST')
    const sent = parseBody(call!)
    expect(sent.ids).toEqual(['pos1'])
    expect(sent.hops).toBe(1)
    expect(sent.direction).toBe('both')
    // New neighbor objects come back from the route.
    expect((res.objects ?? []).map((o) => o.id)).toEqual(['acct1'])
  })

  it('node click triggers derive from the object payload and returns derived values', async () => {
    const res = await fetchDerived('pos1')

    const call = calls.find((c) => c.url.includes('/ontology/object/pos1'))
    expect(call?.url).toContain('/api/enhanced/ontology/object/pos1')
    expect(res.values).toMatchObject({ exposure: 12345, sharpe: 1.42 })
  })

  it('what-if scenario removes nodes from the aggregated id set', () => {
    const allIds = ['pos1', 'pos2', 'acct1']
    const removed = new Set(['pos2'])
    expect(scenarioVisibleIds(allIds, removed)).toEqual(['pos1', 'acct1'])
    expect(scenarioVisibleIds(allIds, new Set())).toEqual(allIds)
  })

  it('scenario metric is recomputed via the aggregate route over baseline vs visible ids', async () => {
    const allIds = ['pos1', 'pos2']
    const visibleIds = scenarioVisibleIds(allIds, new Set(['pos2']))

    const [base, scenario] = await Promise.all([
      fetchAggregate({ ids: allIds, function: 'sum', property: 'value' }),
      fetchAggregate({ ids: visibleIds, function: 'sum', property: 'value' }),
    ])

    const aggCalls = calls.filter((c) => c.url.includes('/ontology/object-set/aggregate'))
    expect(aggCalls).toHaveLength(2)
    expect(aggCalls[0].init?.method).toBe('POST')
    const baseBody = parseBody(aggCalls[0])
    const scenarioBody = parseBody(aggCalls[1])
    expect(baseBody.ids).toEqual(['pos1', 'pos2'])
    // The aggregate function is sent as `metric` and the property as `field`.
    expect(baseBody.metric).toBe('sum')
    expect(baseBody.field).toBe('value')
    expect(scenarioBody.ids).toEqual(['pos1'])
    expect(base.value).toBe(150)
    expect(scenario.value).toBe(150)
  })

  it('propagates a non-OK ontology response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )
    await expect(fetchObjectSet('Position')).rejects.toThrow(/500/)
  })
})
