import { useMemo } from 'react'
import type { GraphNode } from './GraphAdapter'
import { resolveNodeType } from './GraphAdapter'
import { hasExplicitNodeTypeColor, nodeTypeColor } from './theme-colors'

interface GraphLegendProps {
  nodes: GraphNode[]
  isDark: boolean
  /** Top-N distinct types to name individually before collapsing the rest
   * into a single "Other" bucket — the KG has ~46 distinct node_type values
   * in production (RuntimeSignal, WorkItem, Concept, ... down a long tail),
   * so a 46-row legend would be useless; this keeps it scannable. */
  maxEntries?: number
}

interface LegendEntry {
  type: string
  count: number
  color: string
  explicit: boolean
}

/**
 * Colour key for the knowledge-graph canvas: names what each node colour
 * means (CONCEPT: node_type colour-coding) and collapses the long tail of
 * minor types into one "Other" row instead of listing all ~46. Colours come
 * from the SAME deterministic `nodeTypeColor` function GraphAdapter uses to
 * paint the actual nodes, so the legend can never drift out of sync with
 * the canvas.
 */
export function GraphLegend({ nodes, isDark, maxEntries = 8 }: GraphLegendProps) {
  const { entries, otherCount, otherTypeCount } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of nodes) {
      const type = resolveNodeType(node)
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, maxEntries)
    const rest = sorted.slice(maxEntries)
    const built: LegendEntry[] = top.map(([type, count]) => ({
      type,
      count,
      color: nodeTypeColor(type, isDark),
      explicit: hasExplicitNodeTypeColor(type),
    }))
    return {
      entries: built,
      otherCount: rest.reduce((sum, [, count]) => sum + count, 0),
      otherTypeCount: rest.length,
    }
  }, [nodes, isDark, maxEntries])

  if (entries.length === 0) return null

  return (
    <div
      data-testid="graph-legend"
      className="absolute bottom-4 left-4 z-10 max-w-[13rem] rounded-lg border border-border bg-card/90 backdrop-blur-sm p-2.5 text-xs shadow-lg"
    >
      {/* "In view", not "Node types". These counts describe the bounded page
          of nodes the canvas is holding — not the graph. Labelling them as a
          type breakdown is exactly how a 256-row sample came to be read as the
          distribution of a 25,121-node graph; the real distribution now has its
          own panel (`NodeTypeBreakdown`, fed by `/graph/node-types`). */}
      <p className="mb-1.5 font-semibold text-foreground">In view</p>
      <p className="mb-1.5 text-[10px] leading-tight text-muted-foreground">Colour key for the nodes on screen</p>
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.type} className="flex items-center gap-1.5 text-foreground/90">
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="truncate" title={entry.type}>
              {entry.type}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">{entry.count}</span>
          </li>
        ))}
        {otherCount > 0 && (
          <li className="flex items-center gap-1.5 text-muted-foreground" data-testid="graph-legend-other">
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground"
            />
            <span className="truncate" title={`${String(otherTypeCount)} more type(s)`}>
              Other ({otherTypeCount})
            </span>
            <span className="ml-auto tabular-nums">{otherCount}</span>
          </li>
        )}
      </ul>
    </div>
  )
}
