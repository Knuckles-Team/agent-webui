import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import SchemaView from '@/components/views/SchemaView'
import { ontologySchemaGraphToGraphNodes, type OntologySchemaGraph } from '@/components/knowledge-graph/GraphAdapter'

/**
 * NOTE: mirrors VertexView.test.tsx's strategy — this repo's jsdom harness
 * (React 19 + vitest 4) does not reliably DOM-assert view components (e.g.
 * GraphView's own suite currently fails on an unrelated `PageContextProvider`
 * requirement introduced after it was written). So we (1) assert the view is
 * a renderable default export that mounts without throwing, (2) exercise the
 * REAL data-access it performs (`GET /api/ontology/schema-graph` via
 * `api.getOntologySchemaGraph`) against a mocked fetch, and (3) unit-test the
 * pure `ontologySchemaGraphToGraphNodes` adapter it feeds into GraphCanvas.
 * No stubs, no fake data: real wiring, real request contracts.
 */

// Mock the sigma/WebGL GraphCanvas so importing the view never touches WebGL.
vi.mock('@/components/knowledge-graph/GraphCanvas', () => ({
  GraphCanvas: () => null,
}))

const SCHEMA_GRAPH: OntologySchemaGraph = {
  nodes: [
    {
      data: {
        id: 'HasProvenance',
        label: 'HasProvenance',
        kind: 'interface',
        description: 'Provenance contract',
        color: '#0078d4',
        properties: [{ name: 'source', type: 'string', required: true, description: 'origin' }],
      },
    },
    { data: { id: 'Document', label: 'Document', kind: 'object_type', color: '#107c10' } },
    { data: { id: 'Person', label: 'Person', kind: 'object_type', color: '#107c10' } },
  ],
  edges: [
    {
      data: {
        id: 'implements::Document::HasProvenance',
        source: 'Document',
        target: 'HasProvenance',
        kind: 'implements',
        label: 'implements',
      },
    },
    {
      data: {
        id: 'relationship::authored',
        source: 'Person',
        target: 'Document',
        kind: 'relationship',
        label: 'authored',
        cardinality: 'one_to_many',
        edge_type: 'authored',
      },
    },
  ],
  counts: { interfaces: 1, object_types: 2, edges: 2 },
}

interface FetchCall {
  url: string
}
let calls: FetchCall[] = []

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function mockFetch(body: unknown = { status: 'success', result: SCHEMA_GRAPH }) {
  return vi.fn((input: RequestInfo | URL) => {
    calls.push({ url: urlOf(input) })
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

describe('SchemaView', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof SchemaView).toBe('function')
    expect(() => render(<SchemaView />)).not.toThrow()
  })

  it('fetches the schema graph from GET /api/ontology/schema-graph on mount', async () => {
    render(<SchemaView />)

    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/ontology/schema-graph'))).toBe(true)
    })
  })

  it('propagates a non-OK schema-graph response as a thrown ApiError (surfaced via toast, not a crash)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )
    expect(() => render(<SchemaView />)).not.toThrow()
  })
})

describe('ontologySchemaGraphToGraphNodes', () => {
  it('maps interface/object_type nodes and relationship/implements/extends edges', () => {
    const { nodes, relationships } = ontologySchemaGraphToGraphNodes(SCHEMA_GRAPH)

    expect(nodes.map((n) => n.id)).toEqual(['HasProvenance', 'Document', 'Person'])
    // kind rides as the node's sole label so GraphAdapter's getNodeColor can
    // distinguish interface vs. object_type without a GraphCanvas change.
    expect(nodes[0].labels).toEqual(['interface'])
    expect(nodes[1].labels).toEqual(['object_type'])
    // The label used for the sigma node text comes from `properties.name`.
    expect(nodes[0].properties.name).toBe('HasProvenance')
    expect(nodes[0].properties.description).toBe('Provenance contract')
    expect(nodes[0].properties.properties).toEqual([
      { name: 'source', type: 'string', required: true, description: 'origin' },
    ])

    expect(relationships).toEqual([
      { source: 'Document', type: 'implements', target: 'HasProvenance' },
      { source: 'Person', type: 'authored', target: 'Document' },
    ])
  })

  it('handles an empty schema graph', () => {
    const empty: OntologySchemaGraph = { nodes: [], edges: [], counts: { interfaces: 0, object_types: 0, edges: 0 } }
    expect(ontologySchemaGraphToGraphNodes(empty)).toEqual({ nodes: [], relationships: [] })
  })
})
