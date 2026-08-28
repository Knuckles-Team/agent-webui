/**
 * @file VectorizationPanel.tsx
 * @description Pane 3 (design §4) — per-column vectorization control: a state chip
 * (`Off` / `Backfilling N%` / `Live · lag Ns` / `Stale` / `Failed`), the pinned model +
 * digest, dim/metric/index type, vector bytes on disk, and a toggle. Disable and Drop
 * are deliberately separate actions with separate confirmations (Drop discards a
 * rebuild that may take hours).
 *
 * **There is no `EmbeddingBinding` catalog object on the backend yet** — confirmed by
 * reading `agent_utilities` for `EmbeddingBinding`/`embedding_binding` (no hits) before
 * writing this file; the original `TableExplorerView.tsx` recorded the same gap for
 * pane 1 before its route existed. This pane therefore calls a plausible future route
 * (`POST /graph/embedding-binding {action:'list', schema, table}`) that does not exist
 * today, so it degrades to the gateway's honest "capability not yet activated" state via
 * the same `{ok, data, unavailable, error}` envelope every other pane uses — never a raw
 * fetch failure, and never a fabricated chip. The `loaded` branch below is real,
 * uncommented-out code (Enable/Disable/Drop, with Disable and Drop as separate
 * confirmations) so wiring the backend route is the only thing left to do once it ships.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { gatewayPost } from '@/lib/gateway'
import type { CatalogRelation } from './types'

type BindingState = 'off' | 'backfilling' | 'live' | 'stale' | 'failed'

interface EmbeddingBinding {
  column: string
  state: BindingState
  progressPct: number | null
  lagSeconds: number | null
  model: string | null
  modelDigest: string | null
  dim: number | null
  metric: string | null
  indexType: string | null
  bytesOnDisk: number | null
}

type PanelState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; bindings: EmbeddingBinding[] }

async function fetchBindings(relation: CatalogRelation): Promise<PanelState> {
  const r = await gatewayPost<{ bindings?: unknown }>('/embedding-binding', {
    action: 'list',
    schema: relation.schema,
    table: relation.name,
  })
  if (!r.ok)
    return r.unavailable ? { status: 'unavailable' } : { status: 'error', message: r.error ?? 'unknown error' }
  const raw = Array.isArray(r.data?.bindings) ? r.data.bindings : []
  return { status: 'loaded', bindings: raw as EmbeddingBinding[] }
}

const STATE_LABEL: Record<BindingState, string> = {
  off: 'Off',
  backfilling: 'Backfilling',
  live: 'Live',
  stale: 'Stale',
  failed: 'Failed',
}

const STATE_VARIANT: Record<BindingState, 'outline' | 'default' | 'destructive' | 'secondary'> = {
  off: 'outline',
  backfilling: 'secondary',
  live: 'default',
  stale: 'secondary',
  failed: 'destructive',
}

function stateChipText(binding: EmbeddingBinding): string {
  if (binding.state === 'backfilling' && binding.progressPct !== null) {
    return `Backfilling ${String(Math.round(binding.progressPct))}%`
  }
  if (binding.state === 'live' && binding.lagSeconds !== null) {
    return `Live · lag ${String(Math.round(binding.lagSeconds))}s`
  }
  return STATE_LABEL[binding.state]
}

function StateChip({ binding }: { binding: EmbeddingBinding }) {
  return <Badge variant={STATE_VARIANT[binding.state]}>{stateChipText(binding)}</Badge>
}

function DropConfirmDialog({ column, onConfirm }: { column: string; onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="size-3" />
          Drop
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drop the vector index on {column}?</DialogTitle>
          <DialogDescription>
            This discards the backfilled index outright — rebuilding it can take hours on a large table. Disabling
            (without dropping) keeps the index and can be turned back on instantly; use Drop only when you want the
            storage back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" onClick={onConfirm}>
            Drop index
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisableConfirmDialog({ column, onConfirm }: { column: string; onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Ban className="size-3" />
          Disable
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disable vectorization on {column}?</DialogTitle>
          <DialogDescription>
            Stops new writes from updating the vector index; the existing index is kept on disk and can be re-enabled
            instantly. This does NOT free storage — use Drop for that.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onConfirm}>
            Disable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BindingRow({ binding }: { binding: EmbeddingBinding }) {
  const enabled = binding.state !== 'off'
  return (
    <div className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono truncate">{binding.column}</span>
          <StateChip binding={binding} />
        </div>
        <p className="text-muted-foreground font-mono truncate">
          {binding.model ?? 'no model pinned'} {binding.modelDigest ? `· ${binding.modelDigest.slice(0, 12)}` : ''} ·
          dim={binding.dim ?? '—'} · {binding.metric ?? '—'} · {binding.indexType ?? '—'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={enabled} aria-label={`Toggle vectorization for ${binding.column}`} />
        {enabled && <DisableConfirmDialog column={binding.column} onConfirm={() => undefined} />}
        {enabled && <DropConfirmDialog column={binding.column} onConfirm={() => undefined} />}
      </div>
    </div>
  )
}

function EmbeddingBindingUnavailable() {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-muted-foreground">
          There is no <span className="font-mono">EmbeddingBinding</span> catalog object on the backend yet, so{' '}
          <span className="font-mono">/graph/embedding-binding</span> is not serving. This pane will populate
          automatically once that lands — see design §2/§9.
        </p>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">What this pane will show, per column:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>A state chip — Off / Backfilling N% / Live · lag Ns / Stale / Failed</li>
          <li>The pinned embedding model + digest, vector dimension, distance metric, index type</li>
          <li>Vector bytes on disk</li>
          <li>A cost estimate (rows × mean tokens → est. embed time, index bytes) before enabling</li>
          <li>A privacy warning when the column is flagged as likely PII (design §5)</li>
          <li>Separate Disable (reversible) and Drop (discards the rebuilt index) actions</li>
        </ul>
      </div>
    </div>
  )
}

export default function VectorizationPanel({ relation }: { relation: CatalogRelation }) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })

  useEffect(() => {
    setState({ status: 'loading' })
    void fetchBindings(relation).then(setState)
  }, [relation.schema, relation.name])

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4" />
          Vectorization
        </CardTitle>
        <CardDescription>
          Per-column embedding bindings for {relation.schema}.{relation.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        {state.status === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading vectorization state…
          </div>
        ) : state.status === 'unavailable' ? (
          <EmbeddingBindingUnavailable />
        ) : state.status === 'error' ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : state.bindings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No columns are eligible for vectorization on this relation.</p>
        ) : (
          <div className="space-y-2">
            {state.bindings.map((b) => (
              <BindingRow key={b.column} binding={b} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
