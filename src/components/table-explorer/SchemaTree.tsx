/**
 * @file SchemaTree.tsx
 * @description Pane 1 (design §4) — catalogs -> schemas -> tables/views, read from
 * `POST /graph/sql-schema` via `catalog-api.ts`'s {@link fetchSchemaTree}. Selecting a
 * table/view calls `onSelectRelation`; the parent (`TableExplorerView`) drives panes
 * 2–4 from that selection.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Columns3, Database, Loader2, RefreshCw, Table2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fetchSchemaTree } from './catalog-api'
import type { CatalogRelation, RelationRef, SchemaTreeData } from './types'

interface SchemaTreeProps {
  selected: RelationRef | null
  onSelectRelation: (relation: CatalogRelation) => void
}

function relationKey(schema: string, table: string): string {
  return `${schema}.${table}`
}

function RelationRow({
  relation,
  isSelected,
  onSelect,
}: {
  relation: CatalogRelation
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={
        'w-full flex items-center justify-between gap-2 py-1 pl-5 pr-2 text-left text-sm hover:bg-muted/50' +
        (isSelected ? ' bg-muted' : '')
      }
    >
      <span className="flex items-center gap-2 min-w-0">
        <Table2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{relation.name}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className="text-[10px] uppercase">
          {relation.kind}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          <Columns3 className="size-3" />
          {relation.columns.length}
        </Badge>
      </span>
    </button>
  )
}

function SchemaGroup({
  schema,
  tables,
  expanded,
  selected,
  onToggle,
  onSelectRelation,
}: {
  schema: string
  tables: CatalogRelation[]
  expanded: boolean
  selected: RelationRef | null
  onToggle: () => void
  onSelectRelation: (relation: CatalogRelation) => void
}) {
  return (
    <div className="rounded border">
      <button
        type="button"
        onClick={onToggle}
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
          {tables.map((t) => (
            <RelationRow
              key={relationKey(t.schema, t.name)}
              relation={t}
              isSelected={selected?.schema === t.schema && selected.table === t.name}
              onSelect={() => {
                onSelectRelation(t)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function flattenSchemas(data: SchemaTreeData): { schema: string; tables: CatalogRelation[] }[] {
  const out: { schema: string; tables: CatalogRelation[] }[] = []
  for (const catalog of data.catalogs) {
    for (const s of catalog.schemas) {
      out.push({ schema: s.schema, tables: s.tables })
    }
  }
  return out
}

export default function SchemaTree({ selected, onSelectRelation }: SchemaTreeProps) {
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<SchemaTreeData | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    const r = await fetchSchemaTree()
    setUnavailable(r.unavailable)
    setError(r.unavailable ? null : (r.error ?? null))
    setTree(r.ok ? r.data : null)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const toggle = (schema: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(schema)) next.delete(schema)
      else next.add(schema)
      return next
    })
  }

  const schemas = tree ? flattenSchemas(tree) : []

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Catalog</CardTitle>
          <CardDescription>
            {tree
              ? `${String(tree.counts.schemas)} schema(s), ${String(tree.counts.tables)} table/view(s)`
              : 'Schema tree'}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load()
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading catalog…
          </div>
        ) : unavailable ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-muted-foreground">
              <span className="font-mono">/graph/sql-schema</span> is not serving on this backend yet.
            </p>
          </div>
        ) : error ? (
          <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
            {error}
          </pre>
        ) : schemas.length === 0 ? (
          <p className="text-muted-foreground text-sm">No schemas or tables reported — the catalog is empty.</p>
        ) : (
          schemas.map(({ schema, tables }) => (
            <SchemaGroup
              key={schema}
              schema={schema}
              tables={tables}
              expanded={expanded.has(schema)}
              selected={selected}
              onToggle={() => {
                toggle(schema)
              }}
              onSelectRelation={onSelectRelation}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}
