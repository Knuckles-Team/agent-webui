/**
 * @file JsonRenderer.tsx
 * @description A collapsible JSON tree over the adapter's rows.
 *
 * The middle ground between the table (loses nesting) and Raw (loses navigability):
 * a nested property bag stays explorable without the adapter having to flatten it.
 */
import { useState } from 'react'
import { Braces, ChevronDown, ChevronRight } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import { toDisplayText } from '@/lib/atlas/text'
import type { Row } from '@/lib/atlas/types'

const MAX_ENTRIES = 500

function summarize(row: Row): string {
  const keys = Object.keys(row).slice(0, 4)
  return keys.map((key) => `${key}: ${toDisplayText(row[key])}`).join('  ·  ')
}

function JsonEntry({ row, index }: { row: Row; index: number }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Chevron className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground w-10 shrink-0 font-mono text-xs">{index + 1}</span>
        <span className="truncate font-mono text-xs">{summarize(row)}</span>
      </button>
      {open && <pre className="bg-muted/30 overflow-x-auto px-3 py-2 text-xs">{JSON.stringify(row, null, 2)}</pre>}
    </div>
  )
}

function JsonRendererBody({ projection }: RendererProps) {
  const rows = projection.rows.rows.slice(0, MAX_ENTRIES)
  if (rows.length === 0) return <p className="text-muted-foreground p-4 text-sm">No records to expand.</p>
  return (
    <ScrollArea className="h-full w-full">
      <div data-testid="atlas-json">
        {rows.map((row, index) => (
          <JsonEntry key={index} row={row} index={index} />
        ))}
      </div>
    </ScrollArea>
  )
}

export const jsonRenderer: AtlasRenderer = {
  id: 'json',
  label: 'JSON',
  icon: Braces,
  priority: 60,
  prefers: ['tree'],
  accepts: (projection) => projection.rows.rows.length > 0,
  component: JsonRendererBody,
}
