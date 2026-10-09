/**
 * @file TrendBadge.tsx
 * @description A trend state as an arrow, a word and a colour — never colour
 * alone. Data status (warming, stale, unavailable) is shown separately from
 * direction, because a stale bullish state is not a bullish state today.
 */
import { ArrowDown, ArrowUp, Clock3, Hourglass, CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DataStatus, Direction } from '../schemas'

const STATUS = {
  warming: { icon: Hourglass, label: 'Warming up', tone: 'border-amber-500/40 text-amber-700 dark:text-amber-400' },
  stale: { icon: Clock3, label: 'Stale', tone: 'border-amber-500/40 text-amber-700 dark:text-amber-400' },
  unavailable: { icon: CircleSlash, label: 'No data', tone: 'border-border text-muted-foreground' },
} as const

export function TrendBadge({ direction, status }: { direction: Direction | null; status: DataStatus }) {
  if (status !== 'valid' || direction === null) {
    const meta = STATUS[status === 'valid' ? 'warming' : status]
    const Icon = meta.icon
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold', meta.tone)}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {meta.label}
      </span>
    )
  }
  const bullish = direction === 'bullish'
  const Icon = bullish ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
        bullish
          ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
          : 'border-rose-600/40 bg-rose-600/10 text-rose-700 dark:text-rose-400',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {direction}
    </span>
  )
}
