/**
 * @file mockTransport.ts
 * @description Explicit test/dev-only `LodTransport` implementation over the
 * synthetic hierarchy in `mockGenerator.ts`. Production views must use
 * `HttpLodTransport`; this fixture is never an implicit fallback when the
 * authenticated graph gateway is unavailable.
 *
 * Chunks synthetic responses into `LodTile`s (`clusterTileSize` /
 * `nodeTileSize` entries per tile) with an `await` between them so state-
 * machine tests can exercise multiple arrivals. This fixture is not evidence
 * of a production paginated, binary, or streaming backend.
 */

import type {
  ClustersResponse,
  ExpandResponse,
  LodGraphScope,
  LodHierarchyRefreshResponse,
  LodTile,
  LodTransport,
} from './contract'
import {
  DEFAULT_MOCK_CONFIG,
  describeCluster,
  expandLeafCluster,
  interClusterEdges,
  siblingClusters,
  type MockGeneratorConfig,
} from './mockGenerator'

export interface MockLodTransportOptions {
  config?: MockGeneratorConfig
  clusterTileSize?: number
  nodeTileSize?: number
  /** Milliseconds to await between synthetic tiles — 0 in tests. */
  tileDelayMs?: number
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [[]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function maybeDelay(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockLodTransport implements LodTransport {
  private readonly config: MockGeneratorConfig
  private readonly clusterTileSize: number
  private readonly nodeTileSize: number
  private readonly tileDelayMs: number

  constructor(options: MockLodTransportOptions = {}) {
    this.config = options.config ?? DEFAULT_MOCK_CONFIG
    this.clusterTileSize = options.clusterTileSize ?? 500
    this.nodeTileSize = options.nodeTileSize ?? 2_000
    this.tileDelayMs = options.tileDelayMs ?? 0
  }

  refresh(graph: LodGraphScope, signal?: AbortSignal): Promise<LodHierarchyRefreshResponse> {
    signal?.throwIfAborted()
    // Synthetic data has no authenticated EG authority or source version. It
    // remains useful for isolated state-machine tests, but must never be
    // mistaken for a production hierarchy preview receipt.
    void graph
    return Promise.resolve({
      available: false,
      status: 'unavailable',
      graph: null,
      authority_scoped: false,
      transport: 'json-hierarchy-preview',
      streaming: false,
      reason: 'Synthetic hierarchy data has no authenticated authority proof.',
    })
  }

  async *clusters(
    graph: LodGraphScope,
    _level: number,
    parentClusterId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ClustersResponse>> {
    const { level, clusters } = siblingClusters(graph, parentClusterId, this.config)
    const edges = interClusterEdges(graph, parentClusterId, clusters)
    const pages = chunk(clusters, this.clusterTileSize)
    for (let i = 0; i < pages.length; i += 1) {
      signal?.throwIfAborted()
      // Inter-cluster edges reference the FULL clusters array by index (the
      // contract's own convention — see `contract.ts`), so they are only
      // meaningful once every tile has landed. They ride on the final tile
      // rather than being split, which is honest about that dependency
      // instead of shipping edges that dangle past the tiles delivered so far.
      const done = i === pages.length - 1
      yield {
        tileIndex: i,
        done,
        data: { level, clusters: pages[i], inter_cluster_edges: done ? edges : [] },
      }
      if (!done) await maybeDelay(this.tileDelayMs)
    }
  }

  async *expand(
    graph: LodGraphScope,
    clusterId: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ExpandResponse>> {
    const described = describeCluster(graph, clusterId, this.config)
    if (!described.leaf) {
      // Above the leaf level: expanding hands back child clusters, no real
      // nodes — the caller drills again from there.
      const { clusters } = siblingClusters(graph, clusterId, this.config)
      yield { tileIndex: 0, done: true, data: { nodes: [], edges: [], child_clusters: clusters } }
      return
    }

    const { nodes, edges } = expandLeafCluster(graph, clusterId, described.count)
    const pages = chunk(nodes, this.nodeTileSize)
    for (let i = 0; i < pages.length; i += 1) {
      signal?.throwIfAborted()
      const done = i === pages.length - 1
      // Same reasoning as `clusters()`: edges reference the full node list
      // (across ALL tiles combined, by cumulative index) by index, so they
      // only ride on the final tile, once a consumer has every node to
      // resolve them against.
      yield {
        tileIndex: i,
        done,
        data: { nodes: pages[i], edges: done ? edges : [], child_clusters: [] },
      }
      if (!done) await maybeDelay(this.tileDelayMs)
    }
  }
}
