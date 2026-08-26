import { describe, expect, it } from 'vitest'

import { MockLodTransport } from '../mockTransport'
import { DEFAULT_MOCK_CONFIG, describeCluster, siblingClusters, type MockGeneratorConfig } from '../mockGenerator'

const GRAPH = ['default']

async function collect<T>(iter: AsyncIterable<{ data: T; tileIndex: number; done: boolean }>) {
  const tiles: { data: T; tileIndex: number; done: boolean }[] = []
  for await (const tile of iter) tiles.push(tile)
  return tiles
}

describe('MockLodTransport.clusters', () => {
  it('tiles the root level and marks only the last tile done', async () => {
    const transport = new MockLodTransport({ clusterTileSize: 400 })
    const tiles = await collect(transport.clusters(GRAPH, 0))
    expect(tiles.length).toBeGreaterThan(1)
    for (let i = 0; i < tiles.length - 1; i += 1) expect(tiles[i].done).toBe(false)
    expect(tiles[tiles.length - 1].done).toBe(true)

    const totalClusters = tiles.reduce((acc, t) => acc + t.data.clusters.length, 0)
    expect(totalClusters).toBe(DEFAULT_MOCK_CONFIG.rootClusterCount)
  })

  it('a single tile is done immediately when the level fits in one page', async () => {
    const cfg: MockGeneratorConfig = { ...DEFAULT_MOCK_CONFIG, rootClusterCount: 10, totalLeaves: 2000 }
    const transport = new MockLodTransport({ config: cfg, clusterTileSize: 500 })
    const tiles = await collect(transport.clusters(GRAPH, 0))
    expect(tiles).toHaveLength(1)
    expect(tiles[0].done).toBe(true)
    expect(tiles[0].data.clusters).toHaveLength(10)
  })

  it('inter_cluster_edges ride only on the final tile, indexed within the accumulated array', async () => {
    const transport = new MockLodTransport({ clusterTileSize: 400 })
    const tiles = await collect(transport.clusters(GRAPH, 0))
    for (let i = 0; i < tiles.length - 1; i += 1) expect(tiles[i].data.inter_cluster_edges).toEqual([])
    const last = tiles[tiles.length - 1]
    expect(last.data.inter_cluster_edges.length).toBeGreaterThan(0)
    const totalClusters = tiles.reduce((acc, t) => acc + t.data.clusters.length, 0)
    for (const e of last.data.inter_cluster_edges) {
      expect(e.dst_idx).toBeLessThan(totalClusters)
    }
  })

  it('agrees with siblingClusters directly (same generator, same answer)', async () => {
    const transport = new MockLodTransport({ clusterTileSize: 100_000 })
    const tiles = await collect(transport.clusters(GRAPH, 0))
    expect(tiles).toHaveLength(1)
    const direct = siblingClusters(GRAPH, undefined)
    expect(tiles[0].data.clusters).toEqual(direct.clusters)
  })
})

describe('MockLodTransport.expand', () => {
  it('a non-leaf cluster expands to child_clusters, not real nodes', async () => {
    const root = siblingClusters(GRAPH, undefined)
    const nonLeaf = root.clusters.find((c) => c.node_count > DEFAULT_MOCK_CONFIG.leafThreshold)!
    const transport = new MockLodTransport()
    const tiles = await collect(transport.expand(GRAPH, nonLeaf.id))
    expect(tiles).toHaveLength(1)
    expect(tiles[0].data.nodes).toHaveLength(0)
    expect(tiles[0].data.child_clusters.length).toBeGreaterThan(0)
  })

  it('a leaf cluster expands to real nodes, tiled, with edges only on the final tile', async () => {
    // Many small root clusters, so shares land comfortably under
    // `leafThreshold` regardless of the per-seed skew draw.
    const cfg: MockGeneratorConfig = { ...DEFAULT_MOCK_CONFIG, rootClusterCount: 200, totalLeaves: 5000 }
    const root = siblingClusters(GRAPH, undefined, cfg)
    const leaf = root.clusters.find((c) => c.node_count <= cfg.leafThreshold && c.node_count > 10)!
    expect(leaf).toBeDefined()
    const transport = new MockLodTransport({ config: cfg, nodeTileSize: 5 })
    const described = describeCluster(GRAPH, leaf.id, cfg)
    expect(described.leaf).toBe(true)

    const tiles = await collect(transport.expand(GRAPH, leaf.id))
    expect(tiles.length).toBeGreaterThan(1)
    const totalNodes = tiles.reduce((acc, t) => acc + t.data.nodes.length, 0)
    expect(totalNodes).toBe(leaf.node_count)
    for (let i = 0; i < tiles.length - 1; i += 1) expect(tiles[i].data.edges).toEqual([])
    expect(tiles[tiles.length - 1].data.edges.length).toBeGreaterThanOrEqual(0)
    // Every edge must resolve within the accumulated node list.
    for (const e of tiles[tiles.length - 1].data.edges) {
      expect(e.src_idx).toBeLessThan(totalNodes)
      expect(e.dst_idx).toBeLessThan(totalNodes)
    }
  })

  it('is deterministic across repeated calls', async () => {
    const root = siblingClusters(GRAPH, undefined)
    const nonLeaf = root.clusters.find((c) => c.node_count > DEFAULT_MOCK_CONFIG.leafThreshold)!
    const children = siblingClusters(GRAPH, nonLeaf.id)
    const leafChild = children.clusters.find((c) => c.node_count <= DEFAULT_MOCK_CONFIG.leafThreshold)
    const targetId = leafChild?.id ?? nonLeaf.id
    const transport = new MockLodTransport()
    const a = await collect(transport.expand(GRAPH, targetId))
    const b = await collect(transport.expand(GRAPH, targetId))
    expect(a).toEqual(b)
  })

  it('honours an already-aborted signal', async () => {
    const transport = new MockLodTransport({ clusterTileSize: 10 })
    const controller = new AbortController()
    controller.abort()
    await expect(collect(transport.clusters(GRAPH, 0, undefined, controller.signal))).rejects.toThrow()
  })
})
