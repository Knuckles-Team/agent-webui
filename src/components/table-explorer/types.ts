/**
 * @file types.ts
 * @description Shared types for the four-pane SQL/catalog explorer
 * (`plans/semantic-indexing/DESIGN-embedding-bindings.md` §4).
 *
 * Pane 1/2's structural shape (catalog -> schema -> table -> column) mirrors
 * the `POST /graph/sql-schema` response built by
 * `agent_utilities/mcp/tools/graph_tools.py:build_projection` on the au side
 * (feat(gateway) `cc1e7a6a8`, already on `agent-utilities` `main` as of
 * this lane) — keep these two shapes in lockstep by hand; there is no
 * generated-client step in this repo yet.
 */

/** One column, exactly as `graph_tools.build_projection`'s `_column_entry` shapes it. */
export interface CatalogColumn {
  name: string
  position: number
  dataType: string
  udtName: string | null
  nullable: boolean
  /** `null` when the engine's PK metadata isn't populated yet (`capabilities.primaryKeys === false`) — an
   * unknown, never a confident "no". */
  primaryKey: boolean | null
}

export type RelationKind = 'table' | 'view'

/** One table/view, exactly as `graph_tools.build_projection`'s `_relation_entry` shapes it. */
export interface CatalogRelation {
  catalog: string
  schema: string
  name: string
  kind: RelationKind
  tableType: string
  columns: CatalogColumn[]
}

export interface CatalogSchema {
  schema: string
  tables: CatalogRelation[]
}

export interface CatalogEntry {
  catalog: string
  schemas: CatalogSchema[]
}

export interface CatalogCapabilities {
  primaryKeys: boolean
  /** `false` today (engine-wide): `is_nullable` is hardcoded `'YES'` server-side, so
   * `CatalogColumn.nullable` is passed through but not authoritative. */
  nullability: boolean
}

export interface CatalogCounts {
  catalogs: number
  schemas: number
  tables: number
  columns: number
}

export interface SchemaTreeData {
  catalogs: CatalogEntry[]
  capabilities: CatalogCapabilities
  counts: CatalogCounts
}

/** Identifies one relation within the tree — the unit `ColumnDetailPanel`/`TryItPanel`
 * operate on once a user drills into it. */
export interface RelationRef {
  schema: string
  table: string
}

/** A bucketed length histogram entry (`ColumnDetailPanel`'s stats pass). */
export interface LengthBucket {
  bucket: string
  count: number
}

/** The column-detail statistics pass (design §4 pane 2) — computed lazily, client-side,
 * against `POST /graph/table {action:'query'}` today. There is no server-side "compute
 * once, share with the recommender" pass yet (design's stated ideal); see the lane
 * report for why that is a follow-on, not a blocker for this pane. */
export interface ColumnStats {
  rowCount: number | null
  distinctCount: number | null
  distinctRatio: number | null
  sampleValues: string[]
  lengthHistogram: LengthBucket[]
}

export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
