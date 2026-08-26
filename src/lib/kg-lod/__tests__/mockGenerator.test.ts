import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MOCK_CONFIG,
  describeCluster,
  expandLeafCluster,
  interClusterEdges,
  siblingClusters,
  type MockGeneratorConfig,
} from '../mockGenerator'

const GRAPH = ['default']

describe('siblingClusters (root)', () => {
  it('is deterministic across repeated calls', () => {
    const a = siblingClusters(GRAPH, undefined)
    const b = siblingClusters(GRAPH, undefined)
    expect(a).toEqual(b)
  })

  it('produces the configured count of root clusters at level 0', () => {
    const { level, clusters } = siblingClusters(GRAPH, undefined)
    expect(level).toBe(0)
    expect(clusters).toHaveLength(DEFAULT_MOCK_CONFIG.rootClusterCount)
    for (const c of clusters) expect(c.level).toBe(0)
  })

  it('root cluster node_counts sum exactly to the configured total', () => {
    const { clusters } = siblingClusters(GRAPH, undefined)
    const sum = clusters.reduce((acc, c) => acc + c.node_count, 0)
    expect(sum).toBe(DEFAULT_MOCK_CONFIG.totalLeaves)
  })

  it('every root cluster carries a centroid (centroidMaxLevel defaults to >= 0)', () => {
    const { clusters } = siblingClusters(GRAPH, undefined)
    for (const c of clusters) expect(c.centroid).not.toBeNull()
  })

  it('differs by graph scope', () => {
    const a = siblingClusters(GRAPH, undefined)
    const b = siblingClusters(['other-graph'], undefined)
    expect(a.clusters[0].node_count).not.toBe(b.clusters[0].node_count)
  })
})

describe('siblingClusters (children)', () => {
  it("a non-leaf parent's children sum exactly to the parent's node_count", () => {
    const root = siblingClusters(GRAPH, undefined)
    const nonLeafParent = root.clusters.find((c) => c.node_count > DEFAULT_MOCK_CONFIG.leafThreshold)
    expect(nonLeafParent).toBeDefined()
    const children = siblingClusters(GRAPH, nonLeafParent!.id)
    expect(children.clusters.length).toBeGreaterThan(0)
    const sum = children.clusters.reduce((acc, c) => acc + c.node_count, 0)
    expect(sum).toBe(nonLeafParent!.node_count)
    for (const c of children.clusters) expect(c.level).toBe(1)
  })

  it('a leaf parent (small node_count) has no children', () => {
    const cfg: MockGeneratorConfig = { ...DEFAULT_MOCK_CONFIG, rootClusterCount: 20, totalLeaves: 2000 }
    const root = siblingClusters(GRAPH, undefined, cfg)
    const leafParent = root.clusters.find((c) => c.node_count <= cfg.leafThreshold)
    expect(leafParent).toBeDefined()
    const children = siblingClusters(GRAPH, leafParent!.id, cfg)
    expect(children.clusters).toHaveLength(0)
  })

  it('is a pure function of (graph, parentId) — recomputable without visiting the root first', () => {
    const root = siblingClusters(GRAPH, undefined)
    const parent = root.clusters.find((c) => c.node_count > DEFAULT_MOCK_CONFIG.leafThreshold)!
    const a = siblingClusters(GRAPH, parent.id)
    const b = siblingClusters(GRAPH, parent.id)
    expect(a).toEqual(b)
  })

  it('respects the depth backstop even for a config that never crosses the leaf threshold', () => {
    const cfg: MockGeneratorConfig = {
      ...DEFAULT_MOCK_CONFIG,
      leafThreshold: 0,
      maxDepth: 3,
      rootClusterCount: 5,
      totalLeaves: 5000,
    }
    let parentId: string | undefined
    let depth = 0
    for (; depth <= cfg.maxDepth + 2; depth += 1) {
      const { clusters } = siblingClusters(GRAPH, parentId, cfg)
      if (clusters.length === 0) break
      parentId = clusters[0].id
    }
    expect(depth).toBeLessThanOrEqual(cfg.maxDepth + 1)
  })
})

describe('describeCluster', () => {
  it('agrees with siblingClusters on node_count and leaf-ness', () => {
    const root = siblingClusters(GRAPH, undefined)
    for (const c of root.clusters.slice(0, 25)) {
      const described = describeCluster(GRAPH, c.id)
      expect(described.count).toBe(c.node_count)
      expect(described.level).toBe(0)
      expect(described.leaf).toBe(c.node_count <= DEFAULT_MOCK_CONFIG.leafThreshold)
    }
  })
})

describe('interClusterEdges', () => {
  it('every edge indexes within bounds and src < dst (no self-loops, no duplicates)', () => {
    const { clusters } = siblingClusters(GRAPH, undefined)
    const edges = interClusterEdges(GRAPH, undefined, clusters)
    const seen = new Set<string>()
    for (const e of edges) {
      expect(e.src_idx).toBeGreaterThanOrEqual(0)
      expect(e.dst_idx).toBeLessThan(clusters.length)
      expect(e.src_idx).toBeLessThan(e.dst_idx)
      const key = `${e.src_idx}-${e.dst_idx}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('is empty for fewer than 2 clusters', () => {
    expect(interClusterEdges(GRAPH, undefined, [])).toEqual([])
  })
})

describe('expandLeafCluster', () => {
  it('produces exactly `count` nodes with in-bounds, earlier-only edges', () => {
    const { nodes, edges } = expandLeafCluster(GRAPH, 'L0:3', 250)
    expect(nodes).toHaveLength(250)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(250)
    for (const e of edges) {
      expect(e.src_idx).toBeGreaterThan(0)
      expect(e.dst_idx).toBeLessThan(e.src_idx)
    }
  })

  it('is deterministic', () => {
    const a = expandLeafCluster(GRAPH, 'L0:3', 100)
    const b = expandLeafCluster(GRAPH, 'L0:3', 100)
    expect(a).toEqual(b)
  })

  it('handles a single-node cluster with no edges', () => {
    const { nodes, edges } = expandLeafCluster(GRAPH, 'L0:9', 1)
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })
})
