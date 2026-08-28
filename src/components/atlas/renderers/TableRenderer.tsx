/**
 * @file TableRenderer.tsx
 * @description The universal table. Every modality can be a table, because `toRows`
 * is the one required projection on {@link ModalityAdapter}.
 *
 * Clicking a row emits the SAME {@link Selection} shape the graph renderers emit, so
 * the inspector never learns which renderer produced the selection.
 */
import { useCallback } from 'react'
import { Table2 } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import { toDisplayText } from '@/lib/atlas/text'
import type { Row, Selection } from '@/lib/atlas/types'

/** Rows beyond this are not painted — the canvas is a viewport, not an export. */
const MAX_PAINTED_ROWS = 2000

function rowSelection(row: Row, index: number): Selection {
  const id = toDisplayText(row.id) || toDisplayText(row.iri) || `row:${String(index)}`
  return {
    kind: 'row',
    id,
    label: toDisplayText(row.name) || id,
    type: toDisplayText(row.type) || undefined,
    data: row,
  }
}

function TableRendererBody({ projection, selection, onSelect }: RendererProps) {
  const { columns, rows } = projection.rows
  const handleSelect = useCallback(
    (row: Row, index: number) => {
      onSelect(rowSelection(row, index))
    },
    [onSelect],
  )

  if (columns.length === 0) {
    return <p className="text-muted-foreground p-4 text-sm">This result has no columns to tabulate.</p>
  }

  return (
    <ScrollArea className="h-full w-full">
      <table className="w-full caption-bottom text-sm" data-testid="atlas-table">
        <thead className="bg-muted/40 sticky top-0 [&_tr]:border-b">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="h-9 px-3 text-left align-middle font-medium whitespace-nowrap">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_PAINTED_ROWS).map((row, index) => {
            const id = rowSelection(row, index).id
            return (
              <tr
                key={id}
                onClick={() => {
                  handleSelect(row, index)
                }}
                aria-selected={selection?.id === id}
                className="hover:bg-muted/50 aria-selected:bg-accent cursor-pointer border-b transition-colors"
              >
                {columns.map((column) => {
                  const text = toDisplayText(row[column.key])
                  return (
                    <td key={column.key} className="max-w-xs truncate px-3 py-1.5 font-mono text-xs" title={text}>
                      {text}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > MAX_PAINTED_ROWS && (
        <p className="text-muted-foreground p-3 text-xs">
          Showing the first {MAX_PAINTED_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows.
        </p>
      )}
    </ScrollArea>
  )
}

export const tableRenderer: AtlasRenderer = {
  id: 'table',
  label: 'Table',
  icon: Table2,
  priority: 80,
  prefers: ['rows', 'scalar'],
  accepts: (projection) => projection.rows.columns.length > 0,
  component: TableRendererBody,
}
