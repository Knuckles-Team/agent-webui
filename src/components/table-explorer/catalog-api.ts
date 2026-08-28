/**
 * @file catalog-api.ts
 * @description Backend calls for the four-pane SQL/catalog explorer.
 *
 * Two routes, two very different trust levels:
 *
 * - {@link fetchSchemaTree} — `POST /graph/sql-schema`. Carries no caller SQL (an
 *   optional identifier-validated schema-name filter only); safe by construction.
 *   Backs pane 1 (schema tree) and the structural half of pane 2 (column type/
 *   nullable/PK). Already wired end-to-end on `agent-utilities` `main`
 *   (`agent_utilities/gateway/graph_api.py`, `feat(gateway) cc1e7a6a8`).
 *
 * - {@link runCatalogQuery} — `POST /graph/table {action:'query'}`. Executes actual
 *   SQL text (`agent_utilities/mcp/tools/query_tools.py:_graph_table_query` ->
 *   `engine.sql(str(sql))`, client-side-restricted to a `SELECT`/`WITH`/`EXPLAIN`
 *   prefix check — see the lane report for why that check is a naive string prefix,
 *   not a parse, and is therefore not a substitute for the `nav-registry.ts`
 *   `minRole` gate on this whole view). Backs the statistics half of pane 2 (row
 *   count, distinct ratio, sample values, length histogram — there is no server-side
 *   "compute once, share with the recommender" pass yet, design §4 pane 2's stated
 *   ideal) and pane 4's "try it" query. Every identifier this module interpolates is
 *   pre-validated via `./identifiers`; every user-supplied literal is escaped, never
 *   placed in identifier position.
 */
import { gatewayPost } from '@/lib/gateway'
import type { GatewayResult } from '@/lib/gateway'
import { quoteLiteral, quoteRelation } from './identifiers'
import type { CatalogColumn, CatalogEntry, ColumnStats, LengthBucket, RelationRef, SchemaTreeData } from './types'

interface RawSqlSchemaResponse {
  catalogs?: unknown
  capabilities?: { primary_keys?: boolean; nullability?: boolean }
  counts?: { catalogs?: number; schemas?: number; tables?: number; columns?: number }
}

function adaptColumn(raw: unknown): CatalogColumn | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name : ''
  if (!name) return null
  return {
    name,
    position: typeof r.position === 'number' ? r.position : 0,
    dataType: typeof r.data_type === 'string' ? r.data_type : '',
    udtName: typeof r.udt_name === 'string' ? r.udt_name : null,
    nullable: r.nullable === true,
    primaryKey: typeof r.primary_key === 'boolean' ? r.primary_key : null,
  }
}

function adaptColumns(raw: unknown): CatalogColumn[] {
  return Array.isArray(raw) ? raw.map(adaptColumn).filter((c): c is CatalogColumn => c !== null) : []
}

function adaptRelation(raw: unknown): CatalogEntry['schemas'][number]['tables'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name : ''
  const schema = typeof r.schema === 'string' ? r.schema : ''
  if (!name || !schema) return null
  return {
    catalog: typeof r.catalog === 'string' ? r.catalog : '',
    schema,
    name,
    kind: r.kind === 'view' ? 'view' : 'table',
    tableType: typeof r.table_type === 'string' ? r.table_type : '',
    columns: adaptColumns(r.columns),
  }
}

function adaptSchema(raw: unknown): CatalogEntry['schemas'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const schema = typeof r.schema === 'string' ? r.schema : ''
  if (!schema) return null
  const tables = Array.isArray(r.tables)
    ? r.tables.map(adaptRelation).filter((t): t is CatalogEntry['schemas'][number]['tables'][number] => t !== null)
    : []
  return { schema, tables }
}

function adaptCatalog(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const catalog = typeof r.catalog === 'string' ? r.catalog : ''
  if (!catalog) return null
  const schemas = Array.isArray(r.schemas)
    ? r.schemas.map(adaptSchema).filter((s): s is CatalogEntry['schemas'][number] => s !== null)
    : []
  return { catalog, schemas }
}

function adaptCapabilities(raw: RawSqlSchemaResponse['capabilities']) {
  return { primaryKeys: raw?.primary_keys === true, nullability: raw?.nullability === true }
}

function adaptCounts(raw: RawSqlSchemaResponse['counts'], fallbackCatalogs: number) {
  return {
    catalogs: raw?.catalogs ?? fallbackCatalogs,
    schemas: raw?.schemas ?? 0,
    tables: raw?.tables ?? 0,
    columns: raw?.columns ?? 0,
  }
}

function adaptSchemaTree(raw: RawSqlSchemaResponse): SchemaTreeData {
  const catalogs = Array.isArray(raw.catalogs)
    ? raw.catalogs.map(adaptCatalog).filter((c): c is CatalogEntry => c !== null)
    : []
  return {
    catalogs,
    capabilities: adaptCapabilities(raw.capabilities),
    counts: adaptCounts(raw.counts, catalogs.length),
  }
}

/** Fetch the `catalogs -> schemas -> tables -> columns` projection. `schemaFilter`
 * narrows to one schema server-side; omit for every readable schema. */
export async function fetchSchemaTree(schemaFilter?: string): Promise<GatewayResult<SchemaTreeData>> {
  const body = schemaFilter ? { schema: schemaFilter } : undefined
  const r = await gatewayPost<RawSqlSchemaResponse>('/sql-schema', body)
  if (!r.ok || !r.data) return { ok: r.ok, data: null, unavailable: r.unavailable, error: r.error }
  return { ok: true, data: adaptSchemaTree(r.data), unavailable: false }
}

/** Pull a row array out of the `/table {action:'query'}` response — the unwrapped
 * `result` is already the row array on success (see this module's doc), but stay
 * defensive against a wrapped `{rows:[...]}` shape the way `DataAnalystView.tsx` does
 * for the same route family. */
function adaptQueryRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (!raw || typeof raw !== 'object') return []
  const rows = (raw as Record<string, unknown>).rows
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

/** Run one server-authored-shape SQL statement through `POST /graph/table
 * {action:'query'}` and return its rows. `sql` must already be built from validated
 * identifiers (`./identifiers`) plus, at most, escaped literals — never raw user text
 * in identifier position. */
export async function runCatalogQuery(sql: string): Promise<GatewayResult<Record<string, unknown>[]>> {
  const r = await gatewayPost<unknown>('/table', { action: 'query', sql })
  if (!r.ok) return { ok: false, data: null, unavailable: r.unavailable, error: r.error }
  return { ok: true, data: adaptQueryRows(r.data), unavailable: false }
}

function firstNumber(rows: Record<string, unknown>[], key: string): number | null {
  const raw = rows[0]?.[key]
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** `CASE WHEN length("col") < 8 THEN '<8' ... ELSE '128+' END` over a validated,
 * already-quoted column reference. */
function lengthBucketExpr(quotedCol: string): string {
  const whens = [
    `WHEN length(${quotedCol}) < 8 THEN '<8'`,
    `WHEN length(${quotedCol}) < 32 THEN '8-32'`,
    `WHEN length(${quotedCol}) < 128 THEN '32-128'`,
  ].join(' ')
  return `CASE ${whens} ELSE '128+' END`
}

/** Row count + distinct-count/ratio for one column, via one `COUNT`/`COUNT(DISTINCT)`
 * query over the validated relation+column. */
async function fetchCountStats(
  relation: string,
  quotedCol: string,
): Promise<{ rowCount: number | null; distinctCount: number | null }> {
  const sql = `SELECT COUNT(*) AS row_count, COUNT(DISTINCT ${quotedCol}) AS distinct_count FROM ${relation}`
  const r = await runCatalogQuery(sql)
  if (!r.ok || !r.data) return { rowCount: null, distinctCount: null }
  return { rowCount: firstNumber(r.data, 'row_count'), distinctCount: firstNumber(r.data, 'distinct_count') }
}

/** Up to 5 distinct non-null sample values for one column. */
/** Render one sampled cell value as display text — safe for any JSON-scalar-ish value
 * the engine's SQL surface can return, without relying on `String()`'s ambient
 * `[object Object]` fallback for a non-primitive (`@typescript-eslint/no-base-to-string`). */
function sampleValueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

async function fetchSampleValues(relation: string, quotedCol: string): Promise<string[]> {
  const sql = `SELECT DISTINCT ${quotedCol} AS sample FROM ${relation} WHERE ${quotedCol} IS NOT NULL LIMIT 5`
  const r = await runCatalogQuery(sql)
  if (!r.ok || !r.data) return []
  return r.data.map((row) => sampleValueText(row.sample)).filter((v) => v !== '')
}

function adaptHistogram(rows: Record<string, unknown>[]): LengthBucket[] {
  return rows
    .map((row) => ({
      bucket: typeof row.bucket === 'string' ? row.bucket : '',
      count: typeof row.bucket_count === 'number' ? row.bucket_count : Number(row.bucket_count) || 0,
    }))
    .filter((b) => b.bucket !== '')
}

/** A length-histogram over one column's non-null values, bucketed `<8 / 8-32 / 32-128 / 128+`. */
async function fetchLengthHistogram(relation: string, quotedCol: string): Promise<LengthBucket[]> {
  const bucketExpr = lengthBucketExpr(quotedCol)
  const sql =
    `SELECT ${bucketExpr} AS bucket, COUNT(*) AS bucket_count FROM ${relation} ` +
    `WHERE ${quotedCol} IS NOT NULL GROUP BY ${bucketExpr}`
  const r = await runCatalogQuery(sql)
  if (!r.ok || !r.data) return []
  return adaptHistogram(r.data)
}

/** The column-detail statistics pass (design §4 pane 2): row count, distinct ratio,
 * a length histogram, and up to 5 sample values — three queries against the engine's
 * SQL surface, all built from a validated `relation`/`column` pair. Never called with
 * a column name that did not come back from {@link fetchSchemaTree}. */
export async function fetchColumnStats(ref: RelationRef, column: string): Promise<ColumnStats | null> {
  const relation = quoteRelation(ref.schema, ref.table)
  const quotedCol = `"${column.replace(/"/g, '""')}"`
  const [counts, sampleValues, lengthHistogram] = await Promise.all([
    fetchCountStats(relation, quotedCol),
    fetchSampleValues(relation, quotedCol),
    fetchLengthHistogram(relation, quotedCol),
  ])
  if (counts.rowCount === null && sampleValues.length === 0 && lengthHistogram.length === 0) return null
  const distinctRatio =
    counts.rowCount && counts.rowCount > 0 && counts.distinctCount !== null
      ? counts.distinctCount / counts.rowCount
      : null
  return {
    rowCount: counts.rowCount,
    distinctCount: counts.distinctCount,
    distinctRatio,
    sampleValues,
    lengthHistogram,
  }
}

/** One "try it" search request: which relation/column to search, the free-form query
 * text, and an optional result-count cap. A typed request object rather than a
 * positional parameter list, since {@link buildVectorSearchSql} and
 * {@link buildBm25SearchSql} share this exact shape and a 4th/5th positional arg is
 * where a caller starts transposing them by mistake. */
export interface SearchQueryRequest {
  relation: RelationRef
  column: string
  queryText: string
  limit?: number
}

function quotedSearchColumn(column: string): string {
  return `"${column.replace(/"/g, '""')}"`
}

function boundedResultLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(50, Math.trunc(limit ?? 10)))
}

/** Build the "try it" pane's vector-search SQL: `ORDER BY col <=> eg_embed($q) LIMIT n`
 * over a validated relation/column, with the free-form search text as an escaped SQL
 * string literal (never identifier position — see `./identifiers`). */
export function buildVectorSearchSql(request: SearchQueryRequest): string {
  const relation = quoteRelation(request.relation.schema, request.relation.table)
  const quotedCol = quotedSearchColumn(request.column)
  const literal = quoteLiteral(request.queryText)
  const boundedLimit = boundedResultLimit(request.limit)
  return (
    `SELECT *, ${quotedCol} <=> eg_embed(${literal}) AS distance FROM ${relation} ` +
    `ORDER BY distance LIMIT ${String(boundedLimit)}`
  )
}

/** Build the "try it" pane's BM25 lexical-search SQL, using the confirmed 2-arg
 * `bm25_score(doc_text, 'query')` UDF (`crates/eg-query/src/sql/udfs.rs`,
 * exercised at `crates/eg-query/src/sql/pgfamily.rs:1261` — real per-row BM25, not
 * ParadeDB's `@@@ ` operator + `paradedb.score(id)` form, which needs an indexed id
 * column this view has no reliable handle on). Same identifier/literal safety as
 * {@link buildVectorSearchSql}. */
export function buildBm25SearchSql(request: SearchQueryRequest): string {
  const relation = quoteRelation(request.relation.schema, request.relation.table)
  const quotedCol = quotedSearchColumn(request.column)
  const literal = quoteLiteral(request.queryText)
  const boundedLimit = boundedResultLimit(request.limit)
  return (
    `SELECT *, bm25_score(${quotedCol}, ${literal}) AS score FROM ${relation} ` +
    `ORDER BY score DESC LIMIT ${String(boundedLimit)}`
  )
}

export interface FusedHit {
  row: Record<string, unknown>
  rrfScore: number
  inVector: boolean
  inBm25: boolean
}

/** A stable identity key for one result row, so the same underlying record from the
 * vector leg and the BM25 leg fuses into one hit instead of two. Prefers `pkColumn`'s
 * value (a real primary key, when the catalog reports one); falls back to the row's
 * JSON shape minus the per-leg computed `distance`/`score` columns, which is only an
 * approximation when there is no known PK — documented in `TryItPanel.tsx`. */
function hitIdentity(row: Record<string, unknown>, pkColumn: string | null): string {
  if (pkColumn && pkColumn in row) return `pk:${JSON.stringify(row[pkColumn])}`
  const { distance: _distance, score: _score, ...rest } = row
  return `row:${JSON.stringify(rest)}`
}

/** One ranked leg's contribution to the fused RRF map: which rows, in what order,
 * from which leg ('vector' | 'bm25'), under which identity key and constant `k`.
 * Bundled into one object because this is an internal accumulation step called twice
 * (once per leg) from {@link rrfFuse} — a 5-positional-argument call at each site is
 * exactly the shape that gets two arguments swapped silently. */
interface RrfLegContribution {
  scores: Map<string, FusedHit>
  rows: Record<string, unknown>[]
  pkColumn: string | null
  leg: 'vector' | 'bm25'
  k: number
}

function accumulateRrfLeg(contribution: RrfLegContribution): void {
  const { scores, rows, pkColumn, leg, k } = contribution
  rows.forEach((row, index) => {
    const key = hitIdentity(row, pkColumn)
    const entry = scores.get(key) ?? { row, rrfScore: 0, inVector: false, inBm25: false }
    entry.rrfScore += 1 / (k + index + 1)
    if (leg === 'vector') entry.inVector = true
    else entry.inBm25 = true
    scores.set(key, entry)
  })
}

/** The two ranked leg results plus fusion parameters {@link rrfFuse} needs. */
export interface RrfFuseRequest {
  vectorRows: Record<string, unknown>[]
  bm25Rows: Record<string, unknown>[]
  pkColumn: string | null
  /** RRF's rank-damping constant; 60 is the conventional default (design §6). */
  k?: number
}

/** Reciprocal-rank fusion of the vector and BM25 result lists (design §6: `Σ 1/(k+rank)`
 * across branches, `k=60` by convention, matching `eg-plan`'s `FuseRrf`/`crates/eg-plan/
 * src/text_tests.rs`) — computed client-side over two already-fetched, already-ranked
 * result sets, since there is no combined server-side fusion route on this path today. */
export function rrfFuse(request: RrfFuseRequest): FusedHit[] {
  const { vectorRows, bm25Rows, pkColumn, k = 60 } = request
  const scores = new Map<string, FusedHit>()
  accumulateRrfLeg({ scores, rows: vectorRows, pkColumn, leg: 'vector', k })
  accumulateRrfLeg({ scores, rows: bm25Rows, pkColumn, leg: 'bm25', k })
  return Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore)
}
