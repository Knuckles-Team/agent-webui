/**
 * @file types.ts
 * @description The Atlas data contracts — every type a `ModalityAdapter` speaks.
 *
 * Atlas is one explorer for every epistemic-graph modality (KG, SQL, KV, SPARQL,
 * vectors, time-series, blobs). It gets there by refusing to know what a modality
 * is: the workbench, the filter bar and all five renderers are written against the
 * types in THIS file, and a modality is a plugin that produces them.
 *
 * The load-bearing type is {@link GraphProjection}. Any adapter that can project its
 * result into `{nodes, edges}` inherits the existing 2D (sigma) and 3D (three.js)
 * renderers for free — which is how "render it in 3D whether it is kg, sql, kv or
 * sparql" is delivered once instead of five times.
 *
 * Rationale, projection rules per modality, and the deliberate omissions live in
 * `plans/atlas/DESIGN-atlas.md` at the workspace root.
 */

/**
 * Where a query runs and how far it may reach.
 *
 * ⚠ `graph` is the eg graph selector and it is a REQUEST-ENVELOPE field, not a
 * header. `null` means "use the server's union read", which is the default and the
 * correct one: the webui once pinned reads to the TENANT graph and rendered 0 Tools
 * while `__commons__` held 2,941. Atlas never silently pins; a pinned graph is
 * always shown in the context bar.
 */
export interface AtlasContext {
  /** eg graph selector (`__commons__`, `agent:*`, `team:*`), or `null` for the union read. */
  graph: string | null
  /** Hard row cap every adapter must honour and push down where it can. */
  limit: number
  /** Per-adapter settings, keyed by adapter id so two adapters never collide. */
  options: Readonly<Record<string, unknown>>
}

/** The default context: union read, a browser-sane cap, no per-adapter options. */
export const DEFAULT_ATLAS_CONTEXT: AtlasContext = { graph: null, limit: 500, options: {} }

// ---------------------------------------------------------------------------
// Schema / introspection
// ---------------------------------------------------------------------------

/** What a node in the source tree stands for. Drives its icon and its affordances. */
export type SchemaNodeKind = 'source' | 'collection' | 'field' | 'value'

/** A value's type, as far as the filter editor needs to care. */
export type FilterValueType = 'string' | 'number' | 'boolean' | 'date' | 'unknown'

/** One entry in the left-hand source tree. */
export interface SchemaNode {
  /** Unique within its tree. For `field` nodes this is the value `FilterClause.field` takes. */
  id: string
  label: string
  kind: SchemaNodeKind
  /** Type hint for `field` nodes — decides which operators the filter editor offers. */
  dataType?: FilterValueType
  /** Member/row count when the backend supplies one cheaply; `null` when it does not. */
  count?: number | null
  /** Query text this node seeds the console with when clicked. */
  seedQuery?: string
  children?: SchemaNode[]
}

/**
 * The result of {@link ModalityAdapter.introspect}.
 *
 * `unavailable: true` is NOT the same as `roots: []`. The first means the backend
 * cannot enumerate (route absent, capability off) and the UI states that absence;
 * the second means it enumerated and there is genuinely nothing. Conflating them is
 * the "broken vs. empty" defect this codebase has already paid for twice.
 */
export interface SchemaTree {
  adapterId: string
  roots: SchemaNode[]
  unavailable: boolean
  /** Plain-language reason shown to the user when `unavailable`, or a caveat when not. */
  note?: string
}

// ---------------------------------------------------------------------------
// Filters — modality neutral, compiled down per adapter
// ---------------------------------------------------------------------------

/**
 * The operator vocabulary. Deliberately the INTERSECTION of what every modality in
 * the inventory can express — a richer vocabulary would be undeliverable in a KV
 * scan or an ANN search and would have to be silently dropped at compile time.
 */
export type FilterOperator =
  'eq' | 'neq' | 'contains' | 'startsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'exists' | 'missing'

export type FilterScalar = string | number | boolean

export type FilterValue = FilterScalar | FilterScalar[]

export interface FilterClause {
  /** Stable id so React keys and reducer updates do not depend on array position. */
  id: string
  /** A `field`-kind {@link SchemaNode.id}. */
  field: string
  op: FilterOperator
  /** Absent for `exists` / `missing`; an array for `in`. */
  value?: FilterValue
}

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * The one filter model every modality compiles down from.
 *
 * Deliberately FLAT — no nested boolean groups. Nesting is expressible in Cypher and
 * SQL, awkward in SPARQL, and impossible in a KV scan; a flat conjunction/disjunction
 * is what a genuinely modality-neutral model can promise. Anything richer belongs in
 * the raw query console, where it is honest about being modality-specific.
 */
export interface FilterSet {
  /** Free text across whatever the adapter deems searchable. */
  search: string
  /** How `clauses` combine. */
  combinator: 'and' | 'or'
  clauses: FilterClause[]
  sort: SortSpec | null
  limit: number
}

/** An empty filter set at the default row cap. */
export const EMPTY_FILTER_SET: FilterSet = {
  search: '',
  combinator: 'and',
  clauses: [],
  sort: null,
  limit: DEFAULT_ATLAS_CONTEXT.limit,
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * The coarse shape of a result. Used ONLY to bias which renderer is auto-selected
 * first — a renderer's `accepts()` is keyed on the projection, never on this.
 */
export type ResultShape = 'rows' | 'graph' | 'tree' | 'scalar' | 'series' | 'blob' | 'empty'

export interface ResultStats {
  elapsedMs: number
  rowCount: number
  /** True when the backend capped the answer. The UI must say so. */
  truncated: boolean
  note?: string
}

/**
 * One executed query's answer.
 *
 * `payload` is the adapter's own native result; nothing outside the adapter reads it
 * except the `raw` renderer, which shows it verbatim.
 *
 * `degraded` is non-fatal: the canvas shows the banner AND the result. It carries
 * `gateway.ts`'s `unavailable` distinction (route not served, or an engine-surface
 * `_degraded` payload) the rest of the way to the renderer, so a partial answer with
 * a caveat never renders identically to a genuinely empty one.
 */
export interface ResultSet<P = unknown> {
  adapterId: string
  shape: ResultShape
  payload: P
  stats: ResultStats
  degraded: string | null
  /** Union-read provenance: which graphs/tables/namespaces this actually covered. */
  sources: string[]
}

export type Row = Record<string, unknown>

export interface Column {
  key: string
  label: string
  type: FilterValueType
}

export interface RowSet {
  columns: Column[]
  rows: Row[]
}

/** An empty row set — the honest return of `toRows` on an empty result. */
export const EMPTY_ROW_SET: RowSet = { columns: [], rows: [] }

// ---------------------------------------------------------------------------
// Graph projection — the universal 2D/3D contract
// ---------------------------------------------------------------------------

export interface GraphProjectionNode {
  /** Unique WITHIN the projection. */
  id: string
  label: string
  /** Class/type used for colouring and the legend. */
  type: string
  properties?: Record<string, unknown>
}

export interface GraphProjectionEdge {
  source: string
  target: string
  type: string
  weight?: number
}

/**
 * The one shape both graph renderers consume.
 *
 * ⚠ Emit CLOSED projections: the 3D conversion is index-addressed (CSR adjacency),
 * so an edge whose endpoint is missing from `nodes` is dropped silently.
 */
export interface GraphProjection {
  nodes: GraphProjectionNode[]
  edges: GraphProjectionEdge[]
  truncated: boolean
  note?: string
}

/** An empty projection. `nodes.length === 0` is what disables the graph renderers. */
export const EMPTY_GRAPH_PROJECTION: GraphProjection = { nodes: [], edges: [], truncated: false }

/**
 * Client-side node budget for the derived projections (`rowsToGraph`, `treeToGraph`).
 * Beyond this the LOD path (`src/lib/kg-lod/`, VIZ-1 clusters + VIZ-2 binary tiles)
 * is the answer — Atlas links to `/graph-3d/lod` rather than reimplementing it.
 */
export const ATLAS_GRAPH_NODE_BUDGET = 5000

// ---------------------------------------------------------------------------
// Selection and cross-modality pivots
// ---------------------------------------------------------------------------

export type SelectionKind = 'node' | 'edge' | 'row' | 'cell'

/**
 * Whatever the user last clicked, in a renderer-agnostic form. A node in 3D, a node
 * in 2D and a row in the table all produce this, so the inspector never branches on
 * which renderer is mounted.
 */
export interface Selection {
  kind: SelectionKind
  id: string
  label: string
  /** Type/class when the selection has one (node type, relationship type, column). */
  type?: string
  data: Record<string, unknown>
}

/**
 * A drill-through into another modality.
 *
 * Declarative on purpose — `{targetAdapterId, filters, seedQuery}` is DATA, not a
 * callback. That makes a pivot serialisable (so it can become a shareable URL) and
 * testable without mounting React. The workbench applies it: switch adapter, set
 * filters, run.
 */
export interface Pivot {
  id: string
  label: string
  description?: string
  targetAdapterId: string
  filters: FilterSet
  /** Raw query text to seed the console with, for `rawQuery` adapters. */
  seedQuery?: string
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What an adapter can actually do TODAY. Every `true` is a promise the UI keeps:
 * an operator absent from `filters` is never offered, and `graphProjection: false`
 * greys the 2D/3D buttons with `notes.graphProjection` in the tooltip.
 *
 * Declare pessimistically. A disabled control that explains itself is the difference
 * between "this product is broken" and "this modality is not a graph".
 */
export interface AdapterCapabilities {
  introspect: boolean
  filters: readonly FilterOperator[]
  freeTextSearch: boolean
  sort: boolean
  /** True when the console is a real editor (`parse` is implemented). */
  rawQuery: boolean
  /** For syntax labelling, e.g. 'sparql' | 'cypher' | 'sql'. */
  rawQueryLanguage?: string
  graphProjection: boolean
  pivots: boolean
  live: boolean
  /**
   * Plain-language reasons, keyed by the capability they qualify. An adapter that
   * filters CLIENT-SIDE (because its route takes no filter parameter) MUST say so in
   * `notes.filters` — silent client-side filtering over a truncated result set is a
   * correctness lie.
   */
  notes?: Readonly<Record<string, string>>
}

/** Every operator, for adapters whose backend can express the lot. */
export const ALL_FILTER_OPERATORS: readonly FilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'exists',
  'missing',
]

/** The conservative default: a modality that can only match and search. */
export const MINIMAL_FILTER_OPERATORS: readonly FilterOperator[] = ['eq', 'neq', 'contains']
