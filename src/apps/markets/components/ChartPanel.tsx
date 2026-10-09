/**
 * @file ChartPanel.tsx
 * @description A chart model drawn by the resolved {@link ChartRenderer}, with
 * its accessible companions: the flip timeline and an optional data table.
 */
import { formatDate, formatPrice, formatVolume } from '../format'
import type { FlipMarker } from '../schemas'
import type { ChartModel, ChartPalette } from './chart-model'
import { resolveChartRenderer } from './renderers'

export function FlipTimeline({
  flips,
  timeframe,
  decimals,
}: {
  flips: FlipMarker[]
  timeframe: string
  decimals: number | null
}) {
  if (flips.length === 0) return <p className="text-sm text-muted-foreground">No flip in this range.</p>
  return (
    <ol aria-label="Flip timeline" className="space-y-1 text-sm">
      {[...flips].reverse().map((flip) => (
        <li key={flip.event_id} className="flex flex-wrap gap-x-3">
          <time dateTime={new Date(flip.at).toISOString()} className="tabular-nums text-muted-foreground">
            {formatDate(flip.at, timeframe)}
          </time>
          <span className="font-medium">{flip.to === 'bullish' ? '↑ Flipped bullish' : '↓ Flipped bearish'}</span>
          <span className="tabular-nums">
            close {formatPrice(flip.price, decimals)}, line {formatPrice(flip.line, decimals)}
          </span>
        </li>
      ))}
    </ol>
  )
}

const TABLE_ROWS = 200

export function ChartDataTable({ model }: { model: ChartModel }) {
  const rows = model.bars.slice(-TABLE_ROWS).reverse()
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border/40">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">{`Last ${rows.length} bars, newest first`}</caption>
        <thead className="sticky top-0 bg-muted">
          <tr>
            {['Open time', 'Open', 'High', 'Low', 'Close', 'Volume', 'State'].map((label) => (
              <th key={label} scope="col" className="px-2 py-1 text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((bar) => (
            <tr key={bar.t} className="border-t border-border/30">
              <th scope="row" className="px-2 py-1 text-left font-normal">
                {formatDate(bar.t, model.timeframe)}
              </th>
              <td className="px-2 py-1">{formatPrice(bar.o, model.priceDecimals)}</td>
              <td className="px-2 py-1">{formatPrice(bar.h, model.priceDecimals)}</td>
              <td className="px-2 py-1">{formatPrice(bar.l, model.priceDecimals)}</td>
              <td className="px-2 py-1">{formatPrice(bar.c, model.priceDecimals)}</td>
              <td className="px-2 py-1">{formatVolume(bar.v)}</td>
              <td className="px-2 py-1">{bar.final ? 'final' : 'open'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChartPanel({ model, palette }: { model: ChartModel; palette: ChartPalette }) {
  const renderer = resolveChartRenderer()
  if (!renderer) return null
  const Renderer = renderer.component
  return <Renderer model={model} palette={palette} />
}
