import { describe, expect, it } from 'vitest'

import {
  graphProjectionToGraph3DPayload,
  graphProjectionToSigma,
  inferKeyColumn,
  rowsToGraph,
  shortenIri,
  treeToGraph,
  triplesToGraph,
} from '../projection'
import type { RowSet, SchemaNode } from '../types'

const orders: RowSet = {
  columns: [
    { key: 'id', label: 'id', type: 'string' },
    { key: 'customer_id', label: 'customer_id', type: 'string' },
    { key: 'kind', label: 'kind', type: 'string' },
  ],
  rows: [
    { id: 'o1', customer_id: 'o2', kind: 'Order' },
    { id: 'o2', customer_id: '', kind: 'Customer' },
  ],
}

describe('rowsToGraph', () => {
  it('makes a node per row and an edge per matching link column', () => {
    const graph = rowsToGraph(orders, { linkColumns: ['customer_id'], typeColumn: 'kind' })
    expect(graph.nodes.map((node) => node.id)).toEqual(['o1', 'o2'])
    expect(graph.edges).toEqual([{ source: 'o1', target: 'o2', type: 'customer_id' }])
    expect(graph.nodes[1].type).toBe('Customer')
  })

  it('says so, rather than pretending, when no link columns are declared', () => {
    const graph = rowsToGraph(orders)
    expect(graph.edges).toHaveLength(0)
    expect(graph.note).toContain('unconnected node cloud')
  })

  it('drops a link whose target is not a known row', () => {
    const graph = rowsToGraph(
      { columns: orders.columns, rows: [{ id: 'o1', customer_id: 'nope', kind: 'Order' }] },
      { linkColumns: ['customer_id'] },
    )
    expect(graph.edges).toHaveLength(0)
  })

  it('honours the node budget and reports truncation', () => {
    const many: RowSet = {
      columns: [{ key: 'id', label: 'id', type: 'string' }],
      rows: Array.from({ length: 10 }, (_, i) => ({ id: `n${String(i)}` })),
    }
    const graph = rowsToGraph(many, { budget: 4 })
    expect(graph.nodes).toHaveLength(4)
    expect(graph.truncated).toBe(true)
  })

  it('returns the empty projection for no rows', () => {
    expect(rowsToGraph({ columns: [], rows: [] }).nodes).toHaveLength(0)
  })

  it('infers the key column from a hint', () => {
    expect(inferKeyColumn(orders)).toBe('id')
  })
})

describe('triplesToGraph', () => {
  it('shares one node between two rows that mention the same literal', () => {
    const graph = triplesToGraph([
      { subject: 'http://x/a', predicate: 'http://x/p', object: 'shared' },
      { subject: 'http://x/b', predicate: 'http://x/p', object: 'shared' },
    ])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes.filter((node) => node.type === 'Literal')).toHaveLength(1)
  })

  it('shortens IRIs for the label', () => {
    expect(shortenIri('http://example.org/onto#Thing')).toBe('Thing')
    expect(shortenIri('http://example.org/Thing')).toBe('Thing')
    expect(shortenIri('bare')).toBe('bare')
  })
})

describe('treeToGraph', () => {
  const roots: SchemaNode[] = [
    { id: 'ns', label: 'ns', kind: 'source', children: [{ id: 'ns/a', label: 'a', kind: 'collection', count: 3 }] },
  ]

  it('makes a contains edge per parent/child', () => {
    const graph = treeToGraph(roots)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toEqual([{ source: 'ns', target: 'ns/a', type: 'contains' }])
  })

  it('stops at the budget', () => {
    expect(treeToGraph(roots, 1).truncated).toBe(true)
  })
})

describe('renderer bridges', () => {
  const projection = {
    nodes: [
      { id: 'a', label: 'A', type: 'T' },
      { id: 'b', label: 'B', type: 'T' },
    ],
    edges: [
      { source: 'a', target: 'b', type: 'R' },
      { source: 'a', target: 'ghost', type: 'R' },
    ],
    truncated: false,
  }

  it('writes node_type into sigma properties and drops dangling edges', () => {
    const sigma = graphProjectionToSigma(projection)
    expect(sigma.nodes[0].properties.node_type).toBe('T')
    expect(sigma.relationships).toHaveLength(1)
  })

  it('drops dangling edges on the 3D path too, and counts isolation honestly', () => {
    const payload = graphProjectionToGraph3DPayload(projection)
    expect(payload.edges).toEqual([{ s: 0, t: 1, r: 'R', w: 1 }])
    expect(payload.connected_nodes).toBe(2)
    expect(payload.isolated_nodes).toBe(0)
  })
})
