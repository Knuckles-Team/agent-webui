/**
 * @file renderers.ts
 * @description The renderer contract and its registry.
 *
 * A renderer accepts a {@link ResultProjection}, NOT a modality. `graph3d.accepts` is
 * "there is a projection with at least one node" — it has no idea SQL exists, which
 * is exactly why SQL, KV and SPARQL all get 3D for free the moment their adapter
 * implements `toGraph`.
 */
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

import type { ModalityAdapter } from './adapter'
import { Registry } from './registry'
import type { AtlasContext, GraphProjection, ResultSet, ResultShape, RowSet, Selection } from './types'
import { EMPTY_ROW_SET } from './types'

/**
 * A result plus both of its derived views, computed ONCE per execution.
 *
 * Computing this up front is what keeps `accepts()` a cheap field test on every
 * renderer instead of a re-projection per renderer per render.
 */
export interface ResultProjection {
  result: ResultSet
  rows: RowSet
  /** `null` when the adapter has no `toGraph` — the graph renderers then decline. */
  graph: GraphProjection | null
}

export interface RendererProps {
  projection: ResultProjection
  adapter: ModalityAdapter
  ctx: AtlasContext
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
}

export interface AtlasRenderer {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /** Higher wins when auto-selecting among renderers that all accept. */
  readonly priority: number
  /** Result shapes this renderer is the natural first choice for. */
  readonly prefers?: readonly ResultShape[]
  /** True when this renderer can MEANINGFULLY draw the projection. */
  accepts(projection: ResultProjection): boolean
  readonly component: ComponentType<RendererProps>
}

export const rendererRegistry = new Registry<AtlasRenderer>()

/**
 * Derive both views of a result. An adapter's `toGraph`/`toRows` throwing must not
 * take the page down — a projection failure degrades to "no graph" / "no rows" and
 * the `raw` renderer still shows the payload.
 */
export function projectResult<P>(adapter: ModalityAdapter<unknown, P>, result: ResultSet<P>): ResultProjection {
  return {
    result,
    rows: safeProject(() => adapter.toRows(result), EMPTY_ROW_SET),
    graph: adapter.toGraph ? safeProject(() => adapter.toGraph?.(result) ?? null, null) : null,
  }
}

function safeProject<T>(project: () => T, fallback: T): T {
  try {
    return project()
  } catch {
    return fallback
  }
}

/** Every registered renderer that accepts this projection, best first. */
export function acceptingRenderers(projection: ResultProjection, registry = rendererRegistry): AtlasRenderer[] {
  const accepted = registry.list().filter((renderer) => acceptsSafely(renderer, projection))
  return accepted.sort((a, b) => rankFor(b, projection) - rankFor(a, projection))
}

function acceptsSafely(renderer: AtlasRenderer, projection: ResultProjection): boolean {
  try {
    return renderer.accepts(projection)
  } catch {
    return false
  }
}

/** `priority`, bumped when the renderer declares a preference for this result's shape. */
function rankFor(renderer: AtlasRenderer, projection: ResultProjection): number {
  const preferred = renderer.prefers?.includes(projection.result.shape) ?? false
  return renderer.priority + (preferred ? 1000 : 0)
}

/**
 * Which renderer to mount.
 *
 * A user's explicit choice is honoured whenever it still accepts — a renderer is
 * never force-switched underneath someone who picked one. Only when their choice
 * cannot draw the new result does auto-selection take over.
 */
export function selectRenderer(
  projection: ResultProjection,
  preferredId: string | null,
  registry = rendererRegistry,
): AtlasRenderer | null {
  const accepted = acceptingRenderers(projection, registry)
  if (accepted.length === 0) return null
  const chosen = accepted.find((renderer) => renderer.id === preferredId)
  return chosen ?? accepted[0]
}
