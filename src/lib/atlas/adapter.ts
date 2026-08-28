/**
 * @file adapter.ts
 * @description `ModalityAdapter` — the one interface every Atlas modality implements.
 *
 * A modality is a FILE. Drop `src/lib/atlas/adapters/<id>.ts` with a default export
 * satisfying {@link ModalityAdapter} and it appears in the `/explore` picker; there
 * is no shared registry file to edit, which is what lets concurrent lanes each add a
 * modality without touching one another's work (see `discover.ts`).
 *
 * ⚠ Every multi-argument method takes ONE typed request object, never positional
 * arguments. This is deliberate and it is the rule for every future adapter method
 * too: seven more modalities will be written against this interface, and a positional
 * signature is the thing that grows — au already carries 442 functions with 8+
 * parameters and 143 with 12+, all of which started at two. A new concern (a trace id,
 * a graph override, a cursor) becomes a new FIELD on the request, which every existing
 * adapter ignores for free and no call site has to re-order.
 *
 * Write a new adapter against `src/lib/atlas/ADAPTER-GUIDE.md`.
 */
import type { LucideIcon } from 'lucide-react'

import type { LiveSource } from './live'
import type {
  AdapterCapabilities,
  AtlasContext,
  FilterSet,
  GraphProjection,
  Pivot,
  ResultSet,
  RowSet,
  SchemaTree,
  Selection,
} from './types'

/** What every backend-touching adapter call needs: where to look, and when to give up. */
export interface AdapterRequest {
  ctx: AtlasContext
  /** MUST be honoured — see {@link ModalityAdapter.execute}. */
  signal: AbortSignal
}

export type IntrospectRequest = AdapterRequest

export interface CompileRequest {
  filters: FilterSet
  ctx: AtlasContext
}

export interface ParseRequest {
  text: string
  ctx: AtlasContext
}

export interface ExecuteRequest<Q> extends AdapterRequest {
  query: Q
}

export interface PivotRequest<P> {
  selection: Selection
  result: ResultSet<P>
}

/**
 * One modality, as a plugin.
 *
 * `Q` is the adapter's compiled query type and `P` its native payload type; both are
 * opaque to everything outside the adapter. The three-member
 * `compile` → `describe` → `parse` round trip is what lets the facet UI and the
 * textual console edit the SAME query: a single `query: string` field cannot express
 * a modality that has no textual language (a KV scan), and a single opaque `Q` cannot
 * be shown to a user.
 */
export interface ModalityAdapter<Q = unknown, P = unknown> {
  /** Stable, lowercase, URL-safe. Also the `adapters/<id>.ts` filename. */
  readonly id: string
  readonly label: string
  /** One plain-English sentence: what this modality holds. Shown in the picker. */
  readonly description: string
  readonly icon: LucideIcon

  /** What this adapter can do today. Declare pessimistically; the UI keeps every promise. */
  capabilities(): AdapterCapabilities

  /**
   * Enumerate what is explorable. Resolve `{unavailable: true, note}` rather than
   * throwing when the backend cannot enumerate — that is a stated absence, not an error.
   */
  introspect(request: IntrospectRequest): Promise<SchemaTree>

  /** Modality-neutral filters → this adapter's query. Push filters down where the backend can. */
  compile(request: CompileRequest): Q

  /** The query as editable text for the console. Must round-trip through `parse` when present. */
  describe(query: Q): string

  /** Console text → query. Omit (and set `rawQuery: false`) for a non-textual modality. */
  parse?(request: ParseRequest): Q

  /**
   * Run it. MUST honour `request.signal` (every filter keystroke re-runs; without
   * cancellation the last response to ARRIVE wins rather than the last one asked for)
   * and `request.ctx.limit`.
   */
  execute(request: ExecuteRequest<Q>): Promise<ResultSet<P>>

  /** Required: every modality can be a table. */
  toRows(result: ResultSet<P>): RowSet

  /**
   * Optional: this is what buys the 2D and 3D renderers.
   *
   * Implement it only when the modality is genuinely relational — a time series is not
   * a graph and forcing a node/edge reading on one is a lie. Present-but-empty is a
   * bug, not a degradation: if you implement it, set `graphProjection: true`.
   */
  toGraph?(result: ResultSet<P>): GraphProjection

  /** Cross-modality drill-through offers for the current selection. Declarative — see {@link Pivot}. */
  pivots?(request: PivotRequest<P>): Pivot[]

  /**
   * How this modality streams, if it does. A property rather than a method so the
   * cadence is a static fact the UI can display ("refreshing every 5 s").
   */
  readonly live?: LiveSource<P>
}

/** Structural check used by auto-discovery to reject a module that is not an adapter. */
export function isModalityAdapter(value: unknown): value is ModalityAdapter {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ModalityAdapter>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (typeof candidate.label !== 'string') return false
  return (
    typeof candidate.capabilities === 'function' &&
    typeof candidate.introspect === 'function' &&
    typeof candidate.compile === 'function' &&
    typeof candidate.execute === 'function' &&
    typeof candidate.toRows === 'function'
  )
}
