/**
 * @file InstrumentRow.tsx
 * @description A single instrument's price row (FUI-04): price with session
 * and source provenance, previous close, change, a sparkline, a licensed
 * logo or text fallback, and a separately labeled after-hours value. A
 * missing price renders an explicit "Price unavailable" state — never `0`.
 */
import { CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPct, formatPrice, formatSince } from '../format'
import type { Quote, QuoteSession } from '../quote'

const SESSION_LABEL: Record<QuoteSession, string> = {
  regular: 'Regular',
  pre: 'Pre-market',
  post: 'Post-market',
  closed: 'Closed',
}

function changeTone(value: number | null): string {
  if (value === null) return 'text-muted-foreground'
  return value >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
}

function signed(value: number | null): string {
  if (value === null) return ''
  return value > 0 ? '+' : ''
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        —
      </span>
    )
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const width = 64
  const height = 20
  const step = width / (points.length - 1)
  const path = points
    .map((value, index) => {
      const x = (index * step).toFixed(1)
      const y = (height - ((value - min) / span) * height).toFixed(1)
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
  const rising = points[points.length - 1] >= points[0]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="presentation" aria-hidden="true">
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        className={rising ? 'stroke-emerald-600 dark:stroke-emerald-400' : 'stroke-rose-600 dark:stroke-rose-400'}
      />
    </svg>
  )
}

function Logo({ logoUrl, symbol }: { logoUrl: string | null; symbol: string }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={`${symbol} logo`} className="size-6 shrink-0 rounded-full" />
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted text-[10px] font-semibold text-muted-foreground"
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  )
}

function AfterHours({ value }: { value: Quote['afterHours'] }) {
  if (!value) return null
  if (value.price === null) {
    return <div className="mt-1 text-xs text-muted-foreground">After hours: unavailable</div>
  }
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      After hours{' '}
      <span className={cn('tabular-nums', changeTone(value.change))}>
        {formatPrice(value.price)} ({formatPct(value.changePct)})
      </span>
    </div>
  )
}

export function InstrumentRow({ quote, now }: { quote: Quote; now: number }) {
  const priceMissing = quote.price === null
  return (
    <div className="flex items-center gap-3 border-t border-border/40 px-3 py-2 text-sm">
      <Logo logoUrl={quote.logoUrl} symbol={quote.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold">{quote.symbol}</span>
          <span className="text-xs text-muted-foreground">{SESSION_LABEL[quote.session]}</span>
          <span className="text-xs text-muted-foreground">· {quote.source}</span>
          {quote.delaySeconds ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Delayed {quote.delaySeconds}s</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          Prev close {formatPrice(quote.previousClose)} · as of {formatSince(quote.asOf, now)} ago
        </div>
      </div>
      <Sparkline points={quote.sparkline} />
      <div className="text-right tabular-nums">
        {priceMissing ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <CircleSlash className="size-3.5" aria-hidden="true" />
            Price unavailable
          </span>
        ) : (
          <>
            <div className="font-semibold">{formatPrice(quote.price)}</div>
            <div className={cn('text-xs', changeTone(quote.change))}>
              {signed(quote.change)}
              {formatPrice(quote.change)} ({formatPct(quote.changePct)})
            </div>
          </>
        )}
        <AfterHours value={quote.afterHours} />
      </div>
    </div>
  )
}
