import { AlertTriangle, Database } from 'lucide-react'
import { nodeTypeColor, useIsDarkMode } from './theme-colors'

/**
 * The REAL node-type distribution, straight from `/api/enhanced/graph/node-types`
 * (one engine-side `GROUP BY node_type` over every node in every readable graph).
 *
 * This exists because the thing it replaces was not a distribution at all.
 * `GraphLegend` groups whatever nodes the canvas happens to hold — the
 * `/graph/nodes` page, capped at 256 — and the dashboard rendered those counts as
 * if they described the graph. On the live 25,121-node graph that produced six
 * types summing to exactly 256, naming only the alphabetically-first labels that
 * fitted in the budget (`ActionApproval`, `ActionDecision`, `AssetOccurrence`,
 * `CallableResource`, `Claim`, `ClaimLifecycleEvent`) — while the three types that
 * are 82% of the graph (`RuntimeSignal` 15,327, `WorkItem` 4,481, `Concept` 2,438)
 * never appeared at all. A sample of a biased slice, shown as an aggregate.
 */
export interface NodeTypeBreakdownData {
  by_type: Record<string, number>
  type_count: number
  total_typed_nodes: number
  truncated: boolean
  available: boolean
  source_graphs: string[]
  degraded_graphs: string[]
  partial: boolean
}

interface NodeTypeBreakdownProps {
  data: NodeTypeBreakdownData | null
  /** True while the (deliberately slow, ~5-22s) aggregate is in flight. */
  loading: boolean
  /** Non-null when the request itself failed, so "no data" is never silent. */
  error: string | null
  /** `null` = no type filter; the canvas is showing its unfiltered sample. */
  selectedType: string | null
  onSelectType: (type: string | null) => void
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

export function NodeTypeBreakdown({ data, loading, error, selectedType, onSelectType }: NodeTypeBreakdownProps) {
  const isDark = useIsDarkMode()
  const entries = Object.entries(data?.by_type ?? {}).sort((a, b) => b[1] - a[1])
  const largest = entries.length > 0 ? entries[0][1] : 0

  return (
    <div className="flex h-full flex-col" data-testid="node-type-breakdown">
      <div className="shrink-0 border-b border-border/30 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Database className="size-3.5 text-emerald-400" />
          Node types
        </p>
        <p className="text-xs text-muted-foreground">
          {data?.available === true
            ? `${formatCount(data.type_count)} types · ${formatCount(data.total_typed_nodes)} nodes`
            : loading
              ? 'Counting every node…'
              : 'Distribution unavailable'}
        </p>
      </div>

      {/* Honesty banners. A degraded or unavailable breakdown must never render
          as a short-but-authoritative list — that is the exact defect this whole
          view is being fixed for. */}
      {error !== null && (
        <p
          className="m-2 flex items-start gap-1.5 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400"
          data-testid="node-type-breakdown-error"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Could not load the type distribution: {error}</span>
        </p>
      )}
      {data && !data.available && error === null && (
        <p
          className="m-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500"
          data-testid="node-type-breakdown-unavailable"
        >
          The graph engine could not be reached, so there is no distribution to show. This is not the same as an empty
          graph.
        </p>
      )}
      {data?.partial && (
        <p
          className="m-2 flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500"
          data-testid="node-type-breakdown-partial"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Partial — these counts exclude {data.degraded_graphs.join(', ')}, which could not be read.</span>
        </p>
      )}
      {data?.truncated && (
        <p className="m-2 rounded border border-border/40 px-2 py-1.5 text-xs text-muted-foreground">
          Only the largest types are listed; a long tail was clipped.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && entries.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>}
        {entries.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  onSelectType(null)
                }}
                className={`w-full rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50 ${
                  selectedType === null ? 'bg-muted/60 font-semibold' : ''
                }`}
              >
                All types
              </button>
            </li>
            {entries.map(([type, count]) => (
              <li key={type}>
                <button
                  type="button"
                  data-testid={`node-type-row-${type}`}
                  onClick={() => {
                    onSelectType(selectedType === type ? null : type)
                  }}
                  className={`w-full rounded px-1.5 py-1 text-left transition-colors hover:bg-muted/50 ${
                    selectedType === type ? 'bg-muted/60' : ''
                  }`}
                  title={`${type} — ${formatCount(count)} nodes. Click to show only these on the canvas.`}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeTypeColor(type, isDark) }}
                    />
                    <span className={`truncate ${selectedType === type ? 'font-semibold' : ''}`}>{type}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{formatCount(count)}</span>
                  </span>
                  {/* Proportional bar: with a distribution this skewed (one type is
                      61% of the graph) the shape is the insight, and a column of
                      raw numbers hides it. */}
                  <span aria-hidden className="mt-1 block h-1 rounded-full bg-muted/40">
                    <span
                      className="block h-1 rounded-full"
                      style={{
                        width: `${String(largest > 0 ? Math.max(2, (count / largest) * 100) : 0)}%`,
                        backgroundColor: nodeTypeColor(type, isDark),
                      }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
