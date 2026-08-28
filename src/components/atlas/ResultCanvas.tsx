/**
 * @file ResultCanvas.tsx
 * @description The centre region: the renderer switcher and the mounted renderer.
 *
 * The switcher lists EVERY registered renderer, not only the ones that accept. A
 * greyed "3D graph" button whose tooltip says *why* is the difference between "this
 * product is broken" and "this modality is not a graph" — hiding the button would
 * leave the user to guess.
 */
import type { AtlasRenderer, ResultProjection } from '@/lib/atlas/renderers'
import { rendererRegistry } from '@/lib/atlas/renderers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ModalityAdapter } from '@/lib/atlas/adapter'
import type { AtlasContext, Selection } from '@/lib/atlas/types'

export interface ResultCanvasProps {
  projection: ResultProjection | null
  adapter: ModalityAdapter
  ctx: AtlasContext
  accepting: AtlasRenderer[]
  renderer: AtlasRenderer | null
  loading: boolean
  error: string | null
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
  onPickRenderer: (rendererId: string) => void
}

/** Why a renderer cannot draw this result, in the adapter's own words where it has some. */
function declineReason(
  renderer: AtlasRenderer,
  adapter: ModalityAdapter,
  projection: ResultProjection | null,
): string {
  const notes = adapter.capabilities().notes
  if (renderer.id === 'graph2d' || renderer.id === 'graph3d') {
    if (notes?.graphProjection) return notes.graphProjection
    if (projection?.graph?.note) return projection.graph.note
    return 'This result does not project into nodes and edges.'
  }
  return 'This renderer cannot draw this result.'
}

function RendererSwitcher({
  accepting,
  renderer,
  adapter,
  projection,
  onPickRenderer,
}: Pick<ResultCanvasProps, 'accepting' | 'renderer' | 'adapter' | 'projection' | 'onPickRenderer'>) {
  const acceptedIds = new Set(accepting.map((entry) => entry.id))
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="atlas-renderer-switcher">
      {rendererRegistry.list().map((entry) => {
        const enabled = acceptedIds.has(entry.id)
        const Icon = entry.icon
        return (
          <Button
            key={entry.id}
            size="sm"
            variant={renderer?.id === entry.id ? 'secondary' : 'ghost'}
            className="h-8 text-xs"
            disabled={!enabled}
            title={enabled ? entry.label : declineReason(entry, adapter, projection)}
            data-testid={`atlas-renderer-${entry.id}`}
            data-state={renderer?.id === entry.id ? 'selected' : 'idle'}
            onClick={() => {
              onPickRenderer(entry.id)
            }}
          >
            <Icon className="mr-1.5 size-3.5" />
            {entry.label}
          </Button>
        )
      })}
    </div>
  )
}

function ResultStatsLine({ projection }: { projection: ResultProjection }) {
  const { stats, sources, degraded } = projection.result
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="outline">{stats.rowCount.toLocaleString()} rows</Badge>
      <Badge variant="outline">{stats.elapsedMs.toLocaleString()} ms</Badge>
      {stats.truncated && <Badge variant="destructive">truncated</Badge>}
      {sources.length > 0 && <span className="text-muted-foreground">graphs: {sources.join(', ')}</span>}
      {stats.note && <span className="text-muted-foreground">{stats.note}</span>}
      {degraded && (
        <span className="text-amber-600 dark:text-amber-400" data-testid="atlas-degraded">
          {degraded}
        </span>
      )}
    </div>
  )
}

function CanvasBody(props: ResultCanvasProps) {
  const { projection, renderer, loading, error, adapter, ctx, selection, onSelect } = props
  if (loading) return <Skeleton className="m-3 h-full" />
  if (error) return <p className="text-destructive p-4 text-sm">{error}</p>
  if (!projection) {
    return <p className="text-muted-foreground p-4 text-sm">Run a query to see results here.</p>
  }
  if (!renderer) return <p className="text-muted-foreground p-4 text-sm">No renderer can draw this result.</p>
  const Body = renderer.component
  return <Body projection={projection} adapter={adapter} ctx={ctx} selection={selection} onSelect={onSelect} />
}

export function ResultCanvas(props: ResultCanvasProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <RendererSwitcher {...props} />
        {props.projection && <ResultStatsLine projection={props.projection} />}
      </div>
      <div className="min-h-0 flex-1">
        <CanvasBody {...props} />
      </div>
    </div>
  )
}
