/**
 * @file InspectorPanel.tsx
 * @description The right region: the current selection and where it can take you.
 *
 * Renderer-agnostic by construction — a node clicked in 3D, a node clicked in 2D and a
 * row clicked in the table all arrive as the same {@link Selection}, so this panel has
 * no idea which renderer is mounted.
 *
 * `pivots` are DATA, so each one is a single dispatch: switch modality, apply filters,
 * run. That is the cross-modality drill-through the whole design exists for.
 */
import { ArrowRightLeft, MousePointerClick } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toDisplayText } from '@/lib/atlas/text'
import type { Pivot, Selection } from '@/lib/atlas/types'

export interface InspectorPanelProps {
  selection: Selection | null
  pivots: Pivot[]
  onPivot: (pivot: Pivot) => void
  /** Stable test hook; mobile and desktop disclosures render separate panel instances. */
  testId?: string
}

function PropertyList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <p className="text-muted-foreground text-xs">No properties.</p>
  return (
    <dl className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-xs">
          <dt className="text-muted-foreground truncate font-mono">{key}</dt>
          <dd className="font-mono break-all">{toDisplayText(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function InspectorPanel({ selection, pivots, onPivot, testId = 'atlas-inspector' }: InspectorPanelProps) {
  if (!selection) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm">
        <MousePointerClick className="size-5" />
        <p>Select a node, edge or row to inspect it.</p>
      </div>
    )
  }
  return (
    <ScrollArea className="h-full" data-testid={testId}>
      <div className="space-y-4 p-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold break-all">{selection.label}</p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{selection.kind}</Badge>
            {selection.type && <Badge variant="secondary">{selection.type}</Badge>}
          </div>
          <p className="text-muted-foreground font-mono text-xs break-all">{selection.id}</p>
        </div>
        <PropertyList data={selection.data} />
        {pivots.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-muted-foreground text-xs font-semibold uppercase">Explore from here</p>
            {pivots.map((pivot) => (
              <Button
                key={pivot.id}
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                title={pivot.description}
                onClick={() => {
                  onPivot(pivot)
                }}
              >
                <ArrowRightLeft className="mr-2 size-3.5 shrink-0" />
                <span className="truncate">{pivot.label}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
