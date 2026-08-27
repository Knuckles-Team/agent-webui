/**
 * @file TableExplorerView.tsx
 * @description Catalog / schema browser — pane 1 of the "table explorer"
 * described in `plans/semantic-indexing/DESIGN-embedding-bindings.md` §4.
 *
 * agent-webui already ships query REPLs (`CypherReplView.tsx`, `SparqlView.tsx`,
 * `DataAnalystView.tsx`) that let an operator RUN a query against eg's tables,
 * but nothing lets them DISCOVER the schema first. This view fills that gap: a
 * tree of catalogs (schemas) -> tables/views -> columns, read from
 * `information_schema` / `pg_catalog`, which eg already synthesizes (see the
 * engine's `docs/interfaces/sql.md` § "System-catalog compatibility").
 *
 * Scope, deliberately: PANE 1 ONLY. No column-detail statistics pass, no
 * vectorization toggle, no recommendations list, no "try it" query box — those
 * later panes depend on the `EmbeddingBinding` catalog object, which does not
 * exist yet (design doc §2, §9 phase 6: "pane 1 ships alone").
 *
 * Shell idiom copied from `CypherReplView.tsx`: same `gatewayPost` helper
 * (`@/lib/gateway`), same loading/error states, same "capability not yet
 * activated" degradation when a route is absent (the pattern `BrokerView.tsx`
 * and `DataAnalystView.tsx` already use for exactly this reason).
 *
 * Backend route assumption (undocumented as of this writing — no dedicated raw
 * SQL execution route exists yet in `src/lib/gateway.ts`'s callers): this view
 * posts to `POST /graph/sql-query` with `{ query: <sql text> }` and expects
 * `{ rows: [...] }` or a bare row array back, mirroring the shape
 * `DataAnalystView.tsx` already parses for `/nl-query` / `/ask-data`. Until
 * that backend route is wired, the view degrades to the "capability not yet
 * activated" state below rather than a hard error — this is expected today,
 * not a bug in this component.
 *
 * NOT registered in the sidebar/router by this lane (shared files owned
 * elsewhere). To wire it in: add a `NavEntry`/route pointing at
 * `TableExplorerView` in `src/lib/nav-registry.ts` (see the `integrations.catalog`
 * entry there for the shape) — the exact one-line registration is reported
 * alongside this component's ownership boundary in the wave brief.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Columns3, Database, Loader2, RefreshCw, Table2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { gatewayPost } from '@/lib/gateway'

/** One row of `information_schema.tables`. */
interface TableInfo {
  schema: string
  name: string
  kind: 'table' | 'view'
}

/** One row of `information_schema.columns`. */
interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  ordinal: number
}

type ColumnsLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; columns: ColumnInfo[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

/** Safe to interpolate into a catalog-lookup SQL string: identifiers already
 * observed in a prior trusted catalog response, not free-form user input. */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_]+$/

function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_RE.test(value)
}

/** Pull a row array out of the (loosely typed) `/sql-query` response, mirroring
 * `DataAnalystView.tsx`'s `adaptResponse` for the same "rows | results | data"
 * shape variance across gateway routes. */
function adaptRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const rows = obj.rows ?? obj.results ?? obj.data
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

function asStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string') return v
  }
  return ''
}

function adaptTables(rows: Record<string, unknown>[]): TableInfo[] {
  return rows
    .map((row) => ({
      schema: asStr(row, 'table_schema', 'schema'),
      name: asStr(row, 'table_name', 'name'),
      kind: asStr(row, 'table_type', 'kind').toLowerCase().includes('view') ? ('view' as const) : ('table' as const),
    }))
    .filter((t) => t.schema !== '' && t.name !== '')
}

function adaptColumns(rows: Record<string, unknown>[]): ColumnInfo[] {
  return rows
    .map((row) => ({
      name: asStr(row, 'column_name', 'name'),
      dataType: asStr(row, 'data_type', 'type') || 'unknown',
      nullable: asStr(row, 'is_nullable', 'nullable').toLowerCase() !== 'no',
      ordinal: Number(row.ordinal_position ?? 0),
    }))
    .filter((c) => c.name !== '')
    .sort((a, b) => a.ordinal - b.ordinal)
}

/** Group a flat table list into catalogs (schemas), each with its tables sorted by name. */
function groupBySchema(tables: TableInfo[]): Map<string, TableInfo[]> {
  const grouped = new Map<string, TableInfo[]>()
  for (const t of tables) {
    const bucket = grouped.get(t.schema) ?? []
    bucket.push(t)
    grouped.set(t.schema, bucket)
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name))
  }
  return grouped
}

async function fetchTables(): Promise<{ tables: TableInfo[]; unavailable: boolean; error: string | null }> {
  const sql =
    'SELECT table_schema, table_name, table_type FROM information_schema.tables ORDER BY table_schema, table_name'
  const r = await gatewayPost<unknown>('/sql-query', { query: sql })
  if (!r.ok) {
    return { tables: [], unavailable: r.unavailable, error: r.unavailable ? null : (r.error ?? 'unknown error') }
  }
  return { tables: adaptTables(adaptRows(r.data)), unavailable: false, error: null }
}

async function fetchColumns(schema: string, table: string): Promise<ColumnsLoadState> {
  if (!isSafeIdentifier(schema) || !isSafeIdentifier(table)) {
    return { status: 'error', message: `Unexpected identifier: ${schema}.${table}` }
  }
  const sql =
    `SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns ` +
    `WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position`
  const r = await gatewayPost<unknown>('/sql-query', { query: sql })
  if (!r.ok) {
    return r.unavailable ? { status: 'unavailable' } : { status: 'error', message: r.error ?? 'unknown error' }
  }
  return { status: 'loaded', columns: adaptColumns(adaptRows(r.data)) }
}

function TableKindBadge({ kind }: { kind: TableInfo['kind'] }) {
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
      {kind}
    </Badge>
  )
}

function ColumnRow({ column }: { column: ColumnInfo }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 pl-9 pr-2 text-xs">
      <span className="flex items-center gap-2 min-w-0">
        <Columns3 className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{column.name}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
        <span className="font-mono">{column.dataType}</span>
        {column.nullable && <Badge variant="outline">nullable</Badge>}
      </span>
    </div>
  )
}

function ColumnsPanel({ state }: { state: ColumnsLoadState }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 pl-9 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading columns…
      </div>
    )
  }
  if (state.status === 'unavailable') {
    return <p className="pl-9 py-1 text-xs text-muted-foreground">Column detail route not activated yet.</p>
  }
  if (state.status === 'error') {
    return <p className="pl-9 py-1 text-xs text-destructive">{state.message}</p>
  }
  if (state.status === 'loaded') {
    if (state.columns.length === 0) {
      return <p className="pl-9 py-1 text-xs text-muted-foreground">No columns reported.</p>
    }
    return (
      <div>
        {state.columns.map((c) => (
          <ColumnRow key={c.name} column={c} />
        ))}
      </div>
    )
  }
  return null
}

interface TableNodeProps {
  table: TableInfo
  expanded: boolean
  columnsState: ColumnsLoadState
  onToggle: () => void
}

function TableNode({ table, expanded, columnsState, onToggle }: TableNodeProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 py-1 pl-5 pr-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          <Table2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono truncate">{table.name}</span>
        </span>
        <TableKindBadge kind={table.kind} />
      </button>
      {expanded && <ColumnsPanel state={columnsState} />}
    </div>
  )
}

interface SchemaNodeProps {
  schema: string
  tables: TableInfo[]
  expanded: boolean
  expandedTables: Set<string>
  columnsByTable: Map<string, ColumnsLoadState>
  onToggleSchema: () => void
  onToggleTable: (table: TableInfo) => void
}

function SchemaNode({
  schema,
  tables,
  expanded,
  expandedTables,
  columnsByTable,
  onToggleSchema,
  onToggleTable,
}: SchemaNodeProps) {
  return (
    <div className="rounded border">
      <button
        type="button"
        onClick={onToggleSchema}
        className="w-full flex items-center justify-between gap-2 p-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          <Database className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono truncate">{schema}</span>
        </span>
        <Badge variant="outline" className="shrink-0">
          {tables.length} object(s)
        </Badge>
      </button>
      {expanded && (
        <div className="border-t">
          {tables.map((t) => {
            const key = `${t.schema}.${t.name}`
            return (
              <TableNode
                key={key}
                table={t}
                expanded={expandedTables.has(key)}
                columnsState={columnsByTable.get(key) ?? { status: 'idle' }}
                onToggle={() => {
                  onToggleTable(t)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function TableExplorerView() {
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [columnsByTable, setColumnsByTable] = useState<Map<string, ColumnsLoadState>>(new Map())

  const loadCatalog = async () => {
    setLoading(true)
    setError(null)
    const result = await fetchTables()
    setTables(result.tables)
    setUnavailable(result.unavailable)
    setError(result.error)
    setLoading(false)
  }

  useEffect(() => {
    void loadCatalog()
  }, [])

  const toggleSchema = (schema: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev)
      if (next.has(schema)) next.delete(schema)
      else next.add(schema)
      return next
    })
  }

  const toggleTable = (table: TableInfo) => {
    const key = `${table.schema}.${table.name}`
    setExpandedTables((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      next.add(key)
      return next
    })
    if (!columnsByTable.has(key)) {
      setColumnsByTable((prev) => new Map(prev).set(key, { status: 'loading' }))
      void fetchColumns(table.schema, table.name).then((state) => {
        setColumnsByTable((prev) => new Map(prev).set(key, state))
      })
    }
  }

  const grouped = groupBySchema(tables)
  const schemaNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))

  return (
    <div className="space-y-6" data-testid="table-explorer">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="size-6" />
            Table Explorer
          </h1>
          <p className="text-muted-foreground text-sm">
            Browse the SQL catalog — schemas, tables/views, and columns — over{' '}
            <span className="font-mono text-xs">information_schema</span>.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void loadCatalog()
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {unavailable && (
        <div
          className={
            'rounded-md border border-amber-500/50 bg-amber-50/50 ' +
            'dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm'
          }
        >
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-muted-foreground">
            <span className="font-mono">/graph/sql-query</span> is not serving on this backend yet — the catalog
            browser has nothing to read until that route is wired.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Catalog</CardTitle>
          <CardDescription>
            {loading
              ? 'Loading catalog…'
              : error
                ? 'Failed to reach the engine.'
                : `${String(schemaNames.length)} schema(s), ${String(tables.length)} table/view(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading catalog…
            </div>
          ) : error ? (
            <pre
              className={
                'rounded border border-destructive/50 bg-destructive/5 p-3 ' +
                'text-xs text-destructive whitespace-pre-wrap break-words'
              }
            >
              {error}
            </pre>
          ) : unavailable ? (
            <p className="text-muted-foreground text-sm">Engine catalog not reachable yet.</p>
          ) : schemaNames.length === 0 ? (
            <p className="text-muted-foreground text-sm">No schemas or tables reported — the catalog is empty.</p>
          ) : (
            <div className="space-y-2">
              {schemaNames.map((schema) => (
                <SchemaNode
                  key={schema}
                  schema={schema}
                  tables={grouped.get(schema) ?? []}
                  expanded={expandedSchemas.has(schema)}
                  expandedTables={expandedTables}
                  columnsByTable={columnsByTable}
                  onToggleSchema={() => {
                    toggleSchema(schema)
                  }}
                  onToggleTable={toggleTable}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
