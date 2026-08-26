import { describe, expect, it } from 'vitest'

import { defaultNodeSize } from '@/components/knowledge-graph-3d/scene'

import type { ClustersResponse, ExpandResponse } from '../contract'
import { clustersToScope, emptyScope, expandToScope, mergeScopes, removeClusterNode } from '../lodGraph'

function clustersResponse(overrides: Partial<ClustersResponse> = {}): ClustersResponse {
  return {
    level: 0,
    clusters: [
      { id: 'c0', label: 'Cluster 0', node_count: 100, edge_count: 180, centroid: { x: 1, y: 2, z: 3 }, top_node_types: ['Skill'] },
      { id: 'c1', label: 'Cluster 1', node_count: 900, edge_count: 1620, centroid: { x: -4, y: 5, z: -6 }, top_node_types: ['Agent'] },
      { id: 'c2', label: 'Cluster 2', node_count: 30, edge_count: 54, centroid: { x: 10, y: -2, z: 1 }, top_node_types: [] },
    ],
    inter_cluster_edges: [
      { src_idx: 0, dst_idx: 1, weight: 2 },
      { src_idx: 1, dst_idx: 2, weight: 1 },
    ],
    ...overrides,
  }
}

describe('clustersToScope', () => {
  it('produces one Graph3DModel node per cluster, with edges preserved by index', () => {
    const scope = clustersToScope(clustersResponse())
    expect(scope.model.nodes).toHaveLength(3)
    expect(scope.model.nodes[0].id).toBe('c0')
    expect(scope.model.edges).toHaveLength(2)
    expect(scope.meta).toEqual([
      { kind: 'cluster', clusterId: 'c0', nodeCount: 100, edgeCount: 180, level: 0 },
      { kind: 'cluster', clusterId: 'c1', nodeCount: 900, edgeCount: 1620, level: 0 },
      { kind: 'cluster', clusterId: 'c2', nodeCount: 30, edgeCount: 54, level: 0 },
    ])
  })

  it('sizes clusters by node_count, monotonically', () => {
    const scope = clustersToScope(clustersResponse())
    // c1 (900 nodes) > c0 (100 nodes) > c2 (30 nodes)
    expect(scope.sizeHints[1]).toBeGreaterThan(scope.sizeHints[0])
    expect(scope.sizeHints[0]).toBeGreaterThan(scope.sizeHints[2])
  })

  it('falls back to type "Cluster" when a cluster has no top_node_types', () => {
    const scope = clustersToScope(clustersResponse())
    expect(scope.model.nodes[2].type).toBe('Cluster')
  })

  it('returns normalized fixedPositions when every cluster has a centroid', () => {
    const scope = clustersToScope(clustersResponse())
    expect(scope.fixedPositions).not.toBeNull()
    expect(scope.fixedPositions!.length).toBe(9)
  })

  it('falls back to fixedPositions = null when any centroid is missing', () => {
    const resp = clustersResponse()
    resp.clusters[1].centroid = null
    const scope = clustersToScope(resp)
    expect(scope.fixedPositions).toBeNull()
  })
})

describe('expandToScope', () => {
  const leafResponse: ExpandResponse = {
    nodes: [
      { id: 'n0', type: 'Skill', name: 'Skill 0' },
      { id: 'n1', type: 'Skill', name: 'Skill 1' },
      { id: 'n2', type: 'Agent', name: 'Agent 2' },
    ],
    edges: [
      { src_idx: 1, dst_idx: 0, type: 'CALLS' },
      { src_idx: 2, dst_idx: 0, type: 'BINDS' },
    ],
    child_clusters: [],
  }

  it('builds a scope of real leaf nodes, sized like the default (non-LOD) view', () => {
    const scope = expandToScope(leafResponse, 2)
    expect(scope.model.nodes).toHaveLength(3)
    expect(scope.meta.every((m) => m.kind === 'leaf')).toBe(true)
    // n0 has degree 2 (both edges land on it) — size must match scene.ts's own formula.
    expect(scope.sizeHints[0]).toBeCloseTo(defaultNodeSize(2), 5)
  })

  it('has no fixedPositions for real nodes (they never carry a centroid)', () => {
    const scope = expandToScope(leafResponse, 2)
    expect(scope.fixedPositions).toBeNull()
  })

  it('appends child_clusters after real nodes and offsets nothing (edges already index only into `nodes`)', () => {
    const resp: ExpandResponse = {
      nodes: [{ id: 'n0', type: 'Skill', name: 'Skill 0' }],
      edges: [],
      child_clusters: [
        { id: 'c0.0', label: 'sub', node_count: 40, edge_count: 60, centroid: null, top_node_types: ['Skill'] },
      ],
    }
    const scope = expandToScope(resp, 0)
    expect(scope.model.nodes).toHaveLength(2)
    expect(scope.model.nodes[1].id).toBe('c0.0')
    expect(scope.meta[1]).toMatchObject({ kind: 'cluster', clusterId: 'c0.0', level: 1 })
  })

  it('a pure-cluster expansion (no real nodes) with every child centroid present yields fixedPositions', () => {
    const resp: ExpandResponse = {
      nodes: [],
      edges: [],
      child_clusters: [
        { id: 'a', label: 'a', node_count: 5, edge_count: 5, centroid: { x: 1, y: 0, z: 0 }, top_node_types: [] },
        { id: 'b', label: 'b', node_count: 5, edge_count: 5, centroid: { x: -1, y: 0, z: 0 }, top_node_types: [] },
      ],
    }
    const scope = expandToScope(resp, 3)
    expect(scope.fixedPositions).not.toBeNull()
  })
})

describe('mergeScopes', () => {
  it('concatenates nodes/meta/sizeHints and shifts edge indices from b', () => {
    const a = clustersToScope(clustersResponse())
    const b = expandToScope(
      {
        nodes: [
          { id: 'x0', type: 'Skill', name: 'X0' },
          { id: 'x1', type: 'Skill', name: 'X1' },
        ],
        edges: [{ src_idx: 1, dst_idx: 0, type: 'CALLS' }],
        child_clusters: [],
      },
      0,
    )
    const merged = mergeScopes(a, b)
    expect(merged.model.nodes).toHaveLength(5)
    expect(merged.model.nodes.map((n) => n.id)).toEqual(['c0', 'c1', 'c2', 'x0', 'x1'])
    // b's edge (1 -> 0) becomes (4 -> 3) after the offset.
    const shifted = merged.model.edges.find((e) => e.s === 4 && e.t === 3)
    expect(shifted).toBeDefined()
    // a's original inter-cluster edges must still be present untouched.
    expect(merged.model.edges.some((e) => e.s === 0 && e.t === 1)).toBe(true)
  })

  it('drops a duplicate node from b and any edge that would dangle from it', () => {
    const a = clustersToScope(clustersResponse())
    const dupResp: ExpandResponse = {
      nodes: [
        { id: 'c0', type: 'Skill', name: 'duplicate of an existing cluster id' },
        { id: 'y0', type: 'Skill', name: 'Y0' },
      ],
      edges: [{ src_idx: 1, dst_idx: 0, type: 'CALLS' }],
      child_clusters: [],
    }
    const b = expandToScope(dupResp, 0)
    const merged = mergeScopes(a, b)
    // c0 was NOT duplicated; only y0 was appended.
    expect(merged.model.nodes).toHaveLength(4)
    expect(merged.model.nodes.map((n) => n.id)).toEqual(['c0', 'c1', 'c2', 'y0'])
    // The edge referencing the dropped duplicate (index 0 in b) must not appear.
    expect(merged.model.edges.some((e) => e.r === 'CALLS')).toBe(false)
  })

  it('yields fixedPositions only when BOTH sides have them, else null (documented fallback to local layout)', () => {
    const a = clustersToScope(clustersResponse())
    const bWithCentroids = expandToScope(
      { nodes: [], edges: [], child_clusters: [{ id: 'z', label: 'z', node_count: 5, edge_count: 5, centroid: { x: 0, y: 0, z: 0 }, top_node_types: [] }] },
      0,
    )
    const bWithoutCentroids = expandToScope(
      { nodes: [{ id: 'z0', type: 'Skill', name: 'Z0' }], edges: [], child_clusters: [] },
      0,
    )
    expect(mergeScopes(a, bWithCentroids).fixedPositions).not.toBeNull()
    expect(mergeScopes(a, bWithoutCentroids).fixedPositions).toBeNull()
  })

  it('merging onto an empty scope is the identity', () => {
    const b = clustersToScope(clustersResponse())
    const merged = mergeScopes(emptyScope(), b)
    expect(merged.model.nodes.map((n) => n.id)).toEqual(b.model.nodes.map((n) => n.id))
  })
})

describe('removeClusterNode', () => {
  it('drops the node and every edge touching it, remapping the rest', () => {
    const scope = clustersToScope(clustersResponse())
    const removed = removeClusterNode(scope, 'c1')
    expect(removed.model.nodes.map((n) => n.id)).toEqual(['c0', 'c2'])
    // Both original edges touched c1 (0->1, 1->2), so neither survives.
    expect(removed.model.edges).toHaveLength(0)
    expect(removed.meta).toHaveLength(2)
    expect(removed.sizeHints).toHaveLength(2)
  })

  it('is a no-op when the id is absent', () => {
    const scope = clustersToScope(clustersResponse())
    const removed = removeClusterNode(scope, 'does-not-exist')
    expect(removed).toBe(scope)
  })

  it('remaps fixedPositions in lockstep with the surviving nodes', () => {
    const scope = clustersToScope(clustersResponse())
    const removed = removeClusterNode(scope, 'c0')
    expect(removed.fixedPositions).not.toBeNull()
    expect(removed.fixedPositions!.length).toBe(6) // 2 surviving nodes * 3
  })

  it('composes with mergeScopes to fold a cluster into its children', () => {
    const root = clustersToScope(clustersResponse())
    const children = expandToScope(
      { nodes: [{ id: 'child0', type: 'Skill', name: 'Child 0' }], edges: [], child_clusters: [] },
      0,
    )
    const folded = mergeScopes(removeClusterNode(root, 'c1'), children)
    expect(folded.model.nodes.map((n) => n.id)).toEqual(['c0', 'c2', 'child0'])
  })
})
