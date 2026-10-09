/**
 * @file OverviewTiles.tsx
 * @description The scanner's headline counts. Every percentage states its
 * denominator: the signals the scan kept, one per listing and timeframe.
 */
import type { ScanPage } from '../schemas'

function share(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—'
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">
        {value}
        {note && <span className="ml-2 text-sm font-medium text-muted-foreground">{note}</span>}
      </dd>
    </div>
  )
}

export function OverviewTiles({ page }: { page: ScanPage }) {
  const { counts, universe } = page
  const other = (counts.warming ?? 0) + (counts.stale ?? 0) + (counts.unavailable ?? 0)
  return (
    <section aria-label="Scan summary">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Signals" value={String(counts.total)} note={`of ${universe.listings} listings`} />
        <Tile label="Bullish" value={String(counts.bullish)} note={share(counts.bullish, counts.total)} />
        <Tile label="Bearish" value={String(counts.bearish)} note={share(counts.bearish, counts.total)} />
        <Tile label="Warming, stale or no data" value={String(other)} note={share(other, counts.total)} />
      </dl>
      {universe.truncated && (
        <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Only the first {universe.scanned} listings were scanned; narrow by asset class or quote to see the rest.
        </p>
      )}
    </section>
  )
}
