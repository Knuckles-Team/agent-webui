/**
 * @file adapters/sql.ts
 * @description The SQL/catalog modality adapter for the Atlas workbench
 * (`ModalityAdapter`, `../adapter.ts`) — the plugin that lets `/explore` browse and
 * query the engine's SQL surface the same way it browses the KG or SPARQL.
 *
 * ⚠ **Provisional against a not-yet-merged interface.** `WD10-A-CORE` (sibling lane,
 * same wave) owns `src/lib/atlas/` and had not merged `adapter.ts`/`types.ts`/
 * `transport.ts`/`projection.ts`/`filters.ts` to `agent-webui` `main` when this file
 * was written — this lane read them directly out of A-CORE's own in-progress
 * worktree (`${XDG_STATE_HOME}/repository-worktrees/agent-webui/wD10-a-core`) rather
 * than inventing a competing shape, per the wave brief. This file therefore only
 * type-checks once A-CORE's core files land; the lane report has the exact
 * verification story (a temporary local copy of those files was used to confirm this
 * adapter compiles and its tests pass, then removed — never committed, since this
 * lane owns only `src/lib/atlas/adapters/sql.ts`, not the rest of `src/lib/atlas/`).
 *
 * Two transports, two trust levels — see `@/components/table-explorer/catalog-api.ts`'s
 * module doc for the full story (this adapter is a thin Atlas-shaped wrapper around
 * the same two routes that view already uses, so the two never drift):
 *  - `introspect()` -> `POST /graph/sql-schema`: no caller SQL, safe by construction.
 *  - `compile()`/`execute()`: a real SQL SELECT, run over `POST /graph/table
 *    {action:'query'}`. Filters `compile()` can express are pushed down into the
 *    catalog-listing query (`table_schema`/`table_name`/`table_type`); once a specific
 *    table is opened (via a table node's `seedQuery`) the console holds real SQL text
 *    and the facet filters step aside — same pattern `sparql.ts`/`graph.ts` document
 *    for their own pushdown limits.
 */
import { Table2 } from 'lucide-react'

import type {
  CompileRequest,
  ExecuteRequest,
  IntrospectRequest,
  ModalityAdapter,
  ParseRequest,
  PivotRequest,
} from '../adapter'
import { rowsToGraph } from '../projection'
import { atlasPost } from '../transport'
import type {
  AdapterCapabilities,
  Column,
  FilterClause,
  FilterOperator,
  GraphProjection,
  Pivot,
  ResultSet,
  Row,
  RowSet,
  SchemaNode,
  SchemaTree,
} from '../types'
import { ALL_FILTER_OPERATORS, EMPTY_FILTER_SET } from '../types'

const ID = 'sql'
const SCHEMA_ROUTE = '/api/graph/sql-schema'
const QUERY_ROUTE = '/api/graph/table'
const DEFAULT_TABLE_LIMIT = 50

export interface SqlQuery {
  text: string
}

interface RawSqlColumn {
  name: string
  data_type?: string
  nullable?: boolean
  primary_key?: boolean | null
}

interface RawSqlRelation {
  catalog: string
  schema: string
  name: string
  kind?: string
  columns?: RawSqlColumn[]
}

interface RawSqlSchema {
  schema: string
  tables?: RawSqlRelation[]
}

interface RawSqlCatalog {
  catalog: string
  schemas?: RawSqlSchema[]
}

interface SqlSchemaResponse {
  catalogs?: RawSqlCatalog[]
}

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: ALL_FILTER_OPERATORS,
  freeTextSearch: true,
  sort: true,
  rawQuery: true,
  rawQueryLanguage: 'sql',
  graphProjection: true,
  pivots: true,
  live: false,
  notes: {
    filters:
      'Filters push down into the catalog listing (table_schema / table_name / table_type). Open a table to edit its SELECT directly — this modality has no column-level filter pushdown into arbitrary tables.',
    graphProjection:
      'The catalog does not track foreign keys yet (design §4): columns named "*_id" are treated as heuristic links, not confirmed foreign keys.',
  },
}

// ---------------------------------------------------------------------------
// compile — FilterSet -> the catalog-listing SELECT
// ---------------------------------------------------------------------------

const CATALOG_LISTING_FIELDS = new Set(['table_schema', 'table_name', 'table_type'])

/** Render a filter/search value as a SQL string literal's text, without relying on
 * `String()`'s ambient `[object Object]` fallback for a non-primitive
 * (`@typescript-eslint/no-base-to-string`). */
function literalText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

function sqlLiteral(value: unknown): string {
  return `'${literalText(value).replace(/'/g, "''")}'`
}

function inClauseValues(value: FilterClause['value']): string {
  const values = Array.isArray(value) ? value : [value]
  return values.map(sqlLiteral).join(', ')
}

type FragmentBuilder = (column: string, clause: FilterClause) => string

const FRAGMENTS: Readonly<Record<FilterOperator, FragmentBuilder>> = {
  eq: (column, clause) => `${column} = ${sqlLiteral(clause.value)}`,
  neq: (column, clause) => `${column} != ${sqlLiteral(clause.value)}`,
  contains: (column, clause) => `${column} ILIKE '%' || ${sqlLiteral(clause.value)} || '%'`,
  startsWith: (column, clause) => `${column} ILIKE ${sqlLiteral(clause.value)} || '%'`,
  gt: (column, clause) => `${column} > ${sqlLiteral(clause.value)}`,
  gte: (column, clause) => `${column} >= ${sqlLiteral(clause.value)}`,
  lt: (column, clause) => `${column} < ${sqlLiteral(clause.value)}`,
  lte: (column, clause) => `${column} <= ${sqlLiteral(clause.value)}`,
  in: (column, clause) => `${column} IN (${inClauseValues(clause.value)})`,
  exists: (column) => `${column} IS NOT NULL`,
  missing: (column) => `${column} IS NULL`,
}

/** One clause -> a SQL fragment, or `null` for a field this adapter's default query
 * does not recognize (a column-level filter left over from a different table's tree —
 * see `capabilities().notes.filters`). */
function clauseFragment(clause: FilterClause): string | null {
  if (!CATALOG_LISTING_FIELDS.has(clause.field)) return null
  return FRAGMENTS[clause.op](clause.field, clause)
}

function searchFragment(search: string): string | null {
  const trimmed = search.trim()
  if (trimmed === '') return null
  const literal = sqlLiteral(trimmed)
  return `(table_name ILIKE '%' || ${literal} || '%' OR table_schema ILIKE '%' || ${literal} || '%')`
}

function whereClause(request: CompileRequest): string {
  const fragments = request.filters.clauses.map(clauseFragment).filter((f): f is string => f !== null)
  const search = searchFragment(request.filters.search)
  const parts = search ? [...fragments, search] : fragments
  if (parts.length === 0) return ''
  const joiner = request.filters.combinator === 'or' ? ' OR ' : ' AND '
  return `\nWHERE ${parts.join(joiner)}`
}

function orderClause(sort: CompileRequest['filters']['sort']): string {
  if (!sort || !CATALOG_LISTING_FIELDS.has(sort.field)) return '\nORDER BY table_schema, table_name'
  return `\nORDER BY ${sort.field} ${sort.direction.toUpperCase()}`
}

/** `FilterSet` -> a SELECT over `information_schema.tables`, the same catalog-listing
 * shape `table-explorer/catalog-api.ts`'s `fetchSchemaTree` reads via the safer
 * no-caller-SQL route — this is the browsable-as-a-table twin of that same listing. */
export function compileSql(request: CompileRequest): SqlQuery {
  const limit = Math.min(request.filters.limit, request.ctx.limit)
  const text =
    'SELECT table_catalog, table_schema, table_name, table_type FROM information_schema.tables' +
    whereClause(request) +
    orderClause(request.filters.sort) +
    `\nLIMIT ${String(limit)}`
  return { text }
}

// ---------------------------------------------------------------------------
// introspect
// ---------------------------------------------------------------------------

function relationSeedQuery(relation: RawSqlRelation, limit: number): string {
  return `SELECT * FROM "${relation.schema}"."${relation.name}" LIMIT ${String(limit)}`
}

function columnFieldType(dataType: string | undefined): SchemaNode['dataType'] {
  const normalized = (dataType ?? '').toLowerCase()
  if (normalized.includes('int') || normalized.includes('float') || normalized.includes('numeric')) return 'number'
  if (normalized.includes('bool')) return 'boolean'
  if (normalized.includes('timestamp') || normalized.includes('date')) return 'date'
  return normalized ? 'string' : 'unknown'
}

function columnNode(column: RawSqlColumn): SchemaNode {
  return { id: `col:${column.name}`, label: column.name, kind: 'field', dataType: columnFieldType(column.data_type) }
}

function relationNode(relation: RawSqlRelation, limit: number): SchemaNode {
  return {
    id: `table:${relation.schema}.${relation.name}`,
    label: `${relation.schema}.${relation.name}`,
    kind: 'collection',
    count: relation.columns?.length ?? null,
    seedQuery: relationSeedQuery(relation, limit),
    children: (relation.columns ?? []).map(columnNode),
  }
}

function schemaNode(schema: RawSqlSchema, limit: number): SchemaNode {
  return {
    id: `schema:${schema.schema}`,
    label: schema.schema,
    kind: 'source',
    children: (schema.tables ?? []).map((relation) => relationNode(relation, limit)),
  }
}

function allSchemaNodes(catalogs: RawSqlCatalog[], limit: number): SchemaNode[] {
  return catalogs.flatMap((catalog) => (catalog.schemas ?? []).map((schema) => schemaNode(schema, limit)))
}

async function introspect(request: IntrospectRequest): Promise<SchemaTree> {
  const res = await atlasPost<SqlSchemaResponse>(SCHEMA_ROUTE, {}, request.signal)
  if (!res.ok || !res.data) {
    return { adapterId: ID, roots: [], unavailable: true, note: res.error ?? 'The SQL catalog is not reachable.' }
  }
  const roots = allSchemaNodes(res.data.catalogs ?? [], request.ctx.limit || DEFAULT_TABLE_LIMIT)
  return { adapterId: ID, roots, unavailable: false }
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

function looksReadOnly(text: string): boolean {
  const head = text.trimStart().slice(0, 8).toUpperCase()
  return head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('EXPLAIN')
}

function emptyResult(degraded: string, elapsedMs: number): ResultSet<Row[]> {
  return {
    adapterId: ID,
    shape: 'empty',
    payload: [],
    stats: { elapsedMs, rowCount: 0, truncated: false },
    degraded,
    sources: [],
  }
}

async function execute(request: ExecuteRequest<SqlQuery>): Promise<ResultSet<Row[]>> {
  const started = Date.now()
  if (!looksReadOnly(request.query.text)) {
    return emptyResult('Only SELECT/WITH/EXPLAIN statements run here; use kg_write-backed surfaces for mutations.', 0)
  }
  const res = await atlasPost<unknown>(QUERY_ROUTE, { action: 'query', sql: request.query.text }, request.signal)
  if (!res.ok) return emptyResult(res.error ?? 'The SQL engine surface is not reachable.', Date.now() - started)
  const rows = Array.isArray(res.data) ? (res.data as Row[]) : []
  return {
    adapterId: ID,
    shape: rows.length === 0 ? 'empty' : 'rows',
    payload: rows,
    stats: { elapsedMs: Date.now() - started, rowCount: rows.length, truncated: rows.length >= request.ctx.limit },
    degraded: null,
    sources: [],
  }
}

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

function inferColumns(rows: Row[]): Column[] {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).map((key) => ({ key, label: key, type: 'unknown' as const }))
}

function toRows(result: ResultSet<Row[]>): RowSet {
  return { columns: inferColumns(result.payload), rows: result.payload }
}

/** Column names ending in `_id` are the only foreign-key signal available (design §4:
 * `key_column_usage` is shaped but empty engine-side today) — a heuristic, not a
 * confirmed constraint; see `capabilities().notes.graphProjection`. */
function heuristicLinkColumns(rows: Row[]): string[] {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).filter((key) => /_id$/i.test(key))
}

function toGraph(result: ResultSet<Row[]>): GraphProjection {
  const rowSet = toRows(result)
  return rowsToGraph(rowSet, { linkColumns: heuristicLinkColumns(result.payload), defaultType: 'Row' })
}

// ---------------------------------------------------------------------------
// pivots
// ---------------------------------------------------------------------------

/** Refine the current catalog listing to just this cell's value — the SQL analogue
 * of `graph.ts`'s "all X-type nodes" pivot, scoped to what `compile()` understands. */
function pivots(request: PivotRequest<Row[]>): Pivot[] {
  const { selection } = request
  if (!selection.type || !CATALOG_LISTING_FIELDS.has(selection.type)) return []
  const value = selection.data[selection.type]
  if (typeof value !== 'string' || value === '') return []
  return [
    {
      id: `sql:${selection.type}:${value}`,
      label: `Only ${selection.type} = ${value}`,
      description: 'Re-run this modality filtered to the selected value.',
      targetAdapterId: ID,
      filters: {
        ...EMPTY_FILTER_SET,
        clauses: [{ id: `pivot-${selection.type}`, field: selection.type, op: 'eq', value }],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------

const sqlAdapter: ModalityAdapter<SqlQuery, Row[]> = {
  id: ID,
  label: 'SQL / Catalog',
  description: 'Tables and views over the engine SQL surface, browsable and queryable.',
  icon: Table2,
  capabilities: () => CAPABILITIES,
  introspect,
  compile: compileSql,
  describe: (query) => query.text,
  parse: ({ text }: ParseRequest) => ({ text }),
  execute,
  toRows,
  toGraph,
  pivots,
}

export default sqlAdapter
