/**
 * @file NodePalette.tsx
 * @description Draggable palette of node types, grouped by kind.
 *
 * Control-flow kinds (Step / Team / Router) are always available. Agent / Tool
 * / Skill entries are populated from `GET /workflows/capabilities`.
 */

import { useMemo, type DragEvent } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import type { CapabilityItem, WorkflowCapabilities, WorkflowNodeKind } from '@/lib/workflow'
import { makeRefId } from '@/lib/workflow'
import { KIND_STYLES } from './nodes'
import { cn } from '@/lib/utils'

/** The drag payload encoded into dataTransfer during palette drag. */
export interface PaletteDragPayload {
  kind: WorkflowNodeKind
  refId?: string
  label: string
  system_prompt?: string
  tools?: string[]
}

export const PALETTE_DND_MIME = 'application/x-workflow-node'

interface NodePaletteProps {
  capabilities: WorkflowCapabilities | null
  loading?: boolean
  onAdd?: (payload: PaletteDragPayload) => void
}

/** The static control-flow palette entries. */
const CONTROL_FLOW: { kind: WorkflowNodeKind; label: string }[] = [
  { kind: 'step', label: 'Step' },
  { kind: 'team', label: 'Team' },
  { kind: 'router', label: 'Router' },
]

function PaletteEntry({
  payload,
  onAdd,
}: {
  payload: PaletteDragPayload
  onAdd?: (payload: PaletteDragPayload) => void
}) {
  const style = KIND_STYLES[payload.kind]
  const Icon = style.icon

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(PALETTE_DND_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <button
      type="button"
      aria-label={`Add ${payload.label}`}
      onClick={() => onAdd?.(payload)}
      draggable
      onDragStart={onDragStart}
      data-testid={`palette-item-${payload.kind}`}
      className={cn(
        'flex min-h-11 w-full cursor-grab items-center gap-2 rounded-md border bg-card/70 px-2 py-1.5 text-xs transition-colors hover:bg-accent active:cursor-grabbing',
        style.ring,
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', style.accent)} />
      <span className="truncate">{payload.label}</span>
    </button>
  )
}

function PaletteGroup({
  title,
  kind,
  items,
  onAdd,
}: {
  title: string
  kind: WorkflowNodeKind
  items: CapabilityItem[]
  onAdd?: (payload: PaletteDragPayload) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <Badge variant="secondary" className="text-[9px]">
          {items.length}
        </Badge>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <PaletteEntry
            key={item.id}
            onAdd={onAdd}
            payload={{
              kind,
              refId: makeRefId(kind, item.id),
              label: item.name,
              system_prompt: item.system_prompt,
              tools: item.tools,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function NodePalette({ capabilities, loading, onAdd }: NodePaletteProps) {
  const agents = useMemo(() => capabilities?.agents ?? [], [capabilities])
  const tools = useMemo(() => capabilities?.tools ?? [], [capabilities])
  const skills = useMemo(() => capabilities?.skills ?? [], [capabilities])

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border/40 bg-muted/10">
      <div className="border-b border-border/40 px-3 py-2">
        <h3 className="text-sm font-bold">Palette</h3>
        <p className="text-[10px] text-muted-foreground">Click or press Enter to add, or drag to the canvas</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Control Flow
            </span>
            <div className="space-y-1">
              {CONTROL_FLOW.map((cf) => (
                <PaletteEntry key={cf.kind} onAdd={onAdd} payload={{ kind: cf.kind, label: cf.label }} />
              ))}
            </div>
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading capabilities…</p>
          ) : (
            <>
              <PaletteGroup title="Agents" kind="agent" items={agents} onAdd={onAdd} />
              <PaletteGroup title="Tools" kind="tool" items={tools} onAdd={onAdd} />
              <PaletteGroup title="Skills" kind="skill" items={skills} onAdd={onAdd} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
