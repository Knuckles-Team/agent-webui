/**
 * @file engineGraphRender.ts
 * @description At-scale graph-native rendering seam for the shared knowledge-graph
 * canvas (`GraphCanvas.tsx`) — routes through the SAME engine visualization
 * pipeline `VizPanel` already uses (`graph_viz` action='export_chart',
 * `Method::Viz`, `MarkKind::Graph`, GOC-88/D-VZ-1 V6-lite), rather than a second
 * bespoke client for graph rendering. No new backend route: this posts to the
 * same `POST /graph/viz` the dashboards Chart panel calls (see `queries.ts`).
 *
 * CONFIRMED ENGINE LIMITATION (verified directly against epistemic-graph source
 * as of this writing — re-check before relying on the "nodes only" caveat
 * still being necessary): `VizRenderRequest` (`crates/eg-types/src/viz.rs`)
 * carries exactly ONE `dataset` field per request, and `MarkKind::Graph`'s
 * two-dataset convention (`dataset_ref` = nodes, `"{dataset_ref}:edges"` =
 * `src`/`dst` edges, `crates/eg-viz-export/src/render.rs`) is populated ONLY by
 * the engine's own `SyntheticGraph` demo generator internally
 * (`src/server/handlers/viz.rs::ingest_dataset`). The only caller-supplied
 * dataset variant, `VizDatasetSource::InlineColumns`, ingests just the ONE
 * dataset it is given — there is no wire field for a caller to also submit an
 * edges dataset alongside real nodes. A caller-supplied `Graph`-mark render is
 * therefore NODES-ONLY (real Fruchterman-Reingold/hash-spread layout
 * positions, zero edges).
 *
 * Rendering that as if it were a complete graph would be exactly the "renders
 * as real data when it isn't" defect this adoption pass exists to eliminate —
 * so this module is never called automatically. `GraphCanvas` only offers it
 * as an explicit, distinctly-labeled opt-in ("preview node positions"), and
 * the returned image is captioned as nodes-only every time it's shown. This
 * is the seam a future engine-side two-dataset request extension plugs into:
 * once the wire contract can carry edges, only `buildNodesOnlyGraphViewSpec`/
 * `renderGraphNodesOnlyViaEngine` need to grow an edges dataset — the caller
 * (`GraphCanvas`) does not need to change.
 */
import { gatewayPost, type GatewayResult } from '@/lib/gateway'

/** Node count above which sigma's client-side force-directed layout is no
 * longer the recommended default — matches the engine's own bounded-layout
 * cutover (`FULL_LAYOUT_NODE_CAP`, `crates/eg-viz-export/src/graph_layout.rs`):
 * below this the engine runs real Fruchterman-Reingold, above it a fast
 * deterministic hash-spread — the same point past which a client-side force
 * simulation degrades too. */
export const GRAPH_ENGINE_RENDER_NODE_THRESHOLD = 2000

export interface EngineGraphNodesOnlyOptions {
  widthPx?: number
  heightPx?: number
  title?: string
}

/** Build the `graph_viz(action='export_chart')` request body for a NODES-ONLY
 * `MarkKind::Graph` render. `nodeCount` is the caller's already-fetched,
 * already-bounded node set size — only the dataset's LENGTH is read for node
 * placement (per the two-dataset convention doc), so no per-node row data is
 * shipped, keeping the request small regardless of graph size. */
export function buildNodesOnlyGraphRequestBody(nodeCount: number, opts: EngineGraphNodesOnlyOptions = {}) {
  const datasetRef = 'kg-graph-nodes-only'
  const spec: Record<string, unknown> = {
    version: 1,
    marks: [{ kind: 'graph', data_ref: datasetRef, encodings: {} }],
  }
  if (opts.title) spec.title = opts.title
  const dataset = {
    InlineColumns: {
      columns: {
        id: { F64: Array.from({ length: nodeCount }, (_, i) => i) },
      },
    },
  }
  return {
    action: 'export_chart',
    spec_json: JSON.stringify(spec),
    dataset_json: JSON.stringify(dataset),
    width_px: opts.widthPx ?? 900,
    height_px: opts.heightPx ?? 600,
    format: 'png',
    dataset_ref: datasetRef,
  }
}

/** Call the engine to render node POSITIONS ONLY (no edges — see module doc)
 * for a graph too large for the client-side interactive layout to recommend
 * by default. */
export async function renderGraphNodesOnlyViaEngine(
  nodeCount: number,
  opts: EngineGraphNodesOnlyOptions = {},
): Promise<GatewayResult<unknown>> {
  return gatewayPost<unknown>('/viz', buildNodesOnlyGraphRequestBody(nodeCount, opts))
}
