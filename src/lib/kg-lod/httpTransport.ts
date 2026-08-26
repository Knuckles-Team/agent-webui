/**
 * @file httpTransport.ts
 * @description `LodTransport` over the REAL backend routes VIZ-1 (server-side
 * hierarchical clustering) and VIZ-2 (binary tile protocol) are building.
 *
 * NOT WIRED UP BY DEFAULT. The route paths below (`GRAPH3D_CLUSTERS_PATH`,
 * `GRAPH3D_EXPAND_PATH`) are this lane's best guess at the sibling
 * `GET /api/enhanced/graph/graph3d` naming convention
 * (`agent/agent_webui/api_extensions.py`) — a reasonable placeholder, not a
 * confirmed contract. If VIZ-1/VIZ-2 land under different paths or a binary
 * (not JSON) wire format, only this file changes: `contract.ts`'s
 * `LodTransport` interface and everything built on it (`lodGraph.ts`,
 * `useLodExplorer.ts`, the view) are unaffected, which is the entire reason
 * the transport is an interface. Swap `MockLodTransport` for
 * `HttpLodTransport` in `useLodExplorer`'s `transport` option once the real
 * routes exist and have been confirmed against this lane.
 *
 * This implementation does not itself tile — a single fetch either succeeds
 * or fails, so every call yields exactly one `LodTile` with `done: true`.
 * Real server-side pagination (should VIZ-2's binary protocol include it)
 * slots in here without changing the interface: split the loop below into
 * repeated fetches keyed by a continuation token, same as
 * `mockTransport.ts`'s chunking already demonstrates the shape of.
 */

import { fetchValidated } from '@/lib/api-validation'

import { clustersResponseSchema, expandResponseSchema } from './contract'
import type { ClustersResponse, ExpandResponse, LodGraphScope, LodTile, LodTransport } from './contract'

const GRAPH3D_CLUSTERS_PATH = '/api/enhanced/graph/graph3d/clusters'
const GRAPH3D_EXPAND_PATH = '/api/enhanced/graph/graph3d/expand'

function graphQuery(graph: LodGraphScope): string {
  return graph.map((g) => `graph=${encodeURIComponent(g)}`).join('&')
}

export class HttpLodTransport implements LodTransport {
  async *clusters(
    graph: LodGraphScope,
    level: number,
    parentClusterId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ClustersResponse>> {
    const params = new URLSearchParams({ level: String(level) })
    if (parentClusterId != null) params.set('parent_cluster_id', parentClusterId)
    const qs = graphQuery(graph)
    const path = `${GRAPH3D_CLUSTERS_PATH}?${params.toString()}${qs ? `&${qs}` : ''}`
    const data = await fetchValidated(path, clustersResponseSchema, { signal })
    yield { data, tileIndex: 0, done: true }
  }

  async *expand(
    graph: LodGraphScope,
    clusterId: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ExpandResponse>> {
    const params = new URLSearchParams({ cluster_id: clusterId })
    const qs = graphQuery(graph)
    const path = `${GRAPH3D_EXPAND_PATH}?${params.toString()}${qs ? `&${qs}` : ''}`
    const data = await fetchValidated(path, expandResponseSchema, { signal })
    yield { data, tileIndex: 0, done: true }
  }
}
