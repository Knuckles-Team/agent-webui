/**
 * @file TryItPanel.tsx
 * @description Pane 4 (design §4/§6) — a query box that runs a vector search
 * (`ORDER BY col <=> eg_embed($q) LIMIT n`) and a BM25 lexical search
 * (`bm25_score(col, $q)`) over the SAME column side by side, plus a client-side RRF
 * fusion of both, so the user can see when vectors win and when they lose (design §6's
 * table: exact identifiers/enums/typos favor BM25/btree; paraphrase/synonym/concept
 * favor vector; hybrid is the honest default).
 *
 * ⚠ **Do not assume the vector leg works.** `eg_embed(text)`'s server-side embedder is
 * bound at the top of every SQL entry point (`bind_sql_text_embedder`, both the native
 * RPC path `handle_sql` AND, since BUG-CX-084's fix, the pgwire path
 * `bind_startup_from_client` — `agent-packages/epistemic-graph` `src/server/handlers/
 * query.rs` + `src/server/pgwire/mod.rs`, merge `2f7f3f3e`), but the embedder itself is
 * `EG_UQL_TEXT_EMBEDDER`-gated and that env var is **not set anywhere** in this
 * workspace's `services/` deployment manifests (checked before writing this file). So
 * on the currently deployed engine, the vector leg is expected to return the engine's
 * typed "no server-side text embedder is bound" error, not results — see the lane
 * report for the full trace of both documents' claims and why they are NOT actually in
 * conflict (BUG-CX-084 is about pgwire-only sessions; this view calls `graph_table`
 * action=query, which goes through the native `handle_sql` path either way and was never
 * affected by that bug). The panel renders that error honestly rather than a fake
 * "no results".
 */
import { useState } from 'react'
import { AlertCircle, Loader2, Play, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { buildBm25SearchSql, buildVectorSearchSql, rrfFuse, runCatalogQuery } from './catalog-api'
import type { CatalogRelation, LoadState } from './types'
import type { FusedHit } from './catalog-api'

interface TryItPanelProps {
  relation: CatalogRelation
  column: string
}

interface TryItResult {
  vector: LoadState<Record<string, unknown>[]>
  bm25: LoadState<Record<string, unknown>[]>
  fused: FusedHit[]
}

function primaryKeyColumn(relation: CatalogRelation): string | null {
  return relation.columns.find((c) => c.primaryKey === true)?.name ?? null
}

interface SearchLegsRequest {
  relation: CatalogRelation
  column: string
  queryText: string
}

function toLoadState(result: {
  ok: boolean
  data: Record<string, unknown>[] | null
  error?: string
}): LoadState<Record<string, unknown>[]> {
  return result.ok
    ? { status: 'loaded', data: result.data ?? [] }
    : { status: 'error', message: result.error ?? 'unknown error' }
}

async function runSearchLegs(request: SearchLegsRequest): Promise<TryItResult> {
  const { relation, column, queryText } = request
  const searchRequest = { relation: { schema: relation.schema, table: relation.name }, column, queryText }
  const [vectorRes, bm25Res] = await Promise.all([
    runCatalogQuery(buildVectorSearchSql(searchRequest)),
    runCatalogQuery(buildBm25SearchSql(searchRequest)),
  ])
  const pkColumn = primaryKeyColumn(relation)
  const fused = rrfFuse({ vectorRows: vectorRes.data ?? [], bm25Rows: bm25Res.data ?? [], pkColumn })
  return { vector: toLoadState(vectorRes), bm25: toLoadState(bm25Res), fused }
}

function RowPreview({ row }: { row: Record<string, unknown> }) {
  const keys = Object.keys(row).slice(0, 4)
  return (
    <div className="rounded border p-1.5 text-[11px] font-mono truncate">
      {keys.map((k) => `${k}=${JSON.stringify(row[k])}`).join(' ')}
    </div>
  )
}

function LegResults({ title, state }: { title: string; state: LoadState<Record<string, unknown>[]> }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Running…
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{state.message}</span>
        </div>
      )}
      {state.status === 'loaded' && state.data.length === 0 && (
        <p className="text-xs text-muted-foreground">No rows.</p>
      )}
      {state.status === 'loaded' && state.data.map((row, i) => <RowPreview key={`${title}-${String(i)}`} row={row} />)}
    </div>
  )
}

function FusedResults({ fused }: { fused: FusedHit[] }) {
  if (fused.length === 0) return <p className="text-xs text-muted-foreground">No fused results yet.</p>
  return (
    <div className="space-y-1.5">
      {fused.slice(0, 10).map((hit, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <RowPreview row={hit.row} />
          </div>
          <div className="flex gap-1 shrink-0">
            {hit.inVector && <Badge variant="outline">V</Badge>}
            {hit.inBm25 && <Badge variant="outline">B</Badge>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function TryItPanel({ relation, column }: TryItPanelProps) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<TryItResult | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (!query.trim()) return
    setRunning(true)
    setResult(await runSearchLegs({ relation, column, queryText: query }))
    setRunning(false)
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4" />
          Try it — vector vs. BM25 vs. RRF fusion
        </CardTitle>
        <CardDescription>
          Searching{' '}
          <span className="font-mono">
            {relation.schema}.{relation.name}.{column}
          </span>
          . See design §6: this is the pane that shows when vectors help and when a plain keyword search wins instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto space-y-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
            placeholder="Search text…"
            aria-label="Try it query"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
          />
          <Button
            onClick={() => {
              void run()
            }}
            disabled={running || !query.trim()}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run
          </Button>
        </div>
        {result && (
          <div className="grid grid-cols-3 gap-3">
            <LegResults title="Vector (eg_embed)" state={result.vector} />
            <LegResults title="BM25 (bm25_score)" state={result.bm25} />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">RRF fusion</p>
              <FusedResults fused={result.fused} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
