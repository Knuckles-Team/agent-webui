/**
 * @file ScannerTable.tsx
 * @description The scanner rows: listing, trend, change since the flip, time
 * since the flip and last price, with a link to each chart. Rows arrive in
 * the engine's order (most recent flip first); a column header re-sorts the
 * displayed rows only.
 */
import { useMemo, useState } from 'react'
import { CandlestickChart } from 'lucide-react'
import { navigateInApp } from '@/lib/apps/location'
import { cn } from '@/lib/utils'
import { formatPct, formatPrice, formatSince } from '../format'
import type { ScanRow, Timeframe } from '../schemas'
import { chartPath } from '../view-state'
import { TrendBadge } from './TrendBadge'

type SortKey = 'engine' | 'symbol' | 'change' | 'since' | 'price'
interface SortState {
  key: SortKey
  descending: boolean
}

const SORT_VALUE: Record<Exclude<SortKey, 'engine'>, (row: ScanRow) => number | string> = {
  symbol: (row) => row.symbol,
  change: (row) => row.change_since_flip_pct ?? Number.NEGATIVE_INFINITY,
  since: (row) => row.last_flip_at ?? Number.NEGATIVE_INFINITY,
  price: (row) => row.last_close ?? Number.NEGATIVE_INFINITY,
}

function sorted(rows: ScanRow[], sort: SortState): ScanRow[] {
  if (sort.key === 'engine') return rows
  const value = SORT_VALUE[sort.key]
  const direction = sort.descending ? -1 : 1
  return [...rows].sort((a, b) => (value(a) < value(b) ? -direction : value(a) > value(b) ? direction : 0))
}

function Header({
  label,
  column,
  sort,
  onSort,
}: {
  label: string
  column: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === column
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      className="px-3 py-2 text-left font-medium"
    >
      <button
        type="button"
        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          onSort(column)
        }}
      >
        {label}
        {active ? (sort.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )
}

function changeTone(value: number | null): string {
  if (value === null) return ''
  return value >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
}

function Row({ row, index, timeframe, now }: { row: ScanRow; index: number; timeframe: Timeframe; now: number }) {
  const path = chartPath(row.listing_id, timeframe)
  return (
    <tr className="border-t border-border/40 hover:bg-accent/40">
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{index + 1}</td>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="font-semibold">{row.symbol}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {row.name} · {row.venue}
          {row.quote ? ` · ${row.quote}` : ''}
        </span>
      </th>
      <td className="px-3 py-2">
        <TrendBadge direction={row.direction} status={row.data_status} />
      </td>
      <td className={cn('px-3 py-2 tabular-nums', changeTone(row.change_since_flip_pct))}>
        {formatPct(row.change_since_flip_pct)}
      </td>
      <td className="px-3 py-2 tabular-nums">{formatSince(row.last_flip_at, now)}</td>
      <td className="px-3 py-2 tabular-nums">{formatPrice(row.last_close)}</td>
      <td className="px-3 py-2">
        <a
          href={path}
          aria-label={`Open the ${row.symbol} ${row.venue} chart`}
          onClick={(event) => {
            event.preventDefault()
            navigateInApp(path)
          }}
          className="inline-flex rounded p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CandlestickChart className="size-4" aria-hidden="true" />
        </a>
      </td>
    </tr>
  )
}

export function ScannerTable({ rows, timeframe, now }: { rows: ScanRow[]; timeframe: Timeframe; now: number }) {
  const [sort, setSort] = useState<SortState>({ key: 'engine', descending: true })
  const shown = useMemo(() => sorted(rows, sort), [rows, sort])
  const onSort = (key: SortKey) => {
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : true }))
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border/50 p-4 text-sm text-muted-foreground">
        No listing matches these filters.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-sm">
        <caption className="sr-only">Trend scanner, most recent flip first unless re-sorted</caption>
        <thead className="bg-muted/40 text-xs">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              #
            </th>
            <Header label="Listing" column="symbol" sort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Trend
            </th>
            <Header label="Change since flip" column="change" sort={sort} onSort={onSort} />
            <Header label="Time since flip" column="since" sort={sort} onSort={onSort} />
            <Header label="Price" column="price" sort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">Chart</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <Row key={row.key_digest} row={row} index={index} timeframe={timeframe} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
