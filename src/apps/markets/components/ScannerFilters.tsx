/**
 * @file ScannerFilters.tsx
 * @description The scanner filter panel: trend, time since the flip,
 * timeframe, quote and proximity to the all-time high.
 */
import type { ChangeEvent, ReactNode } from 'react'
import type { DataStatus, Direction, Timeframe } from '../schemas'
import type { ScannerFilters as Filters } from '../view-state'
import { Chips } from './Chips'

const TREND = [
  { value: 'bullish', label: '↑ Bullish' },
  { value: 'bearish', label: '↓ Bearish' },
  { value: 'warming', label: 'Warming up' },
] as const
const TIMEFRAME_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '12h', label: '12 hours' },
  { value: '1D', label: 'Daily' },
  { value: '1W', label: 'Weekly' },
  { value: '1M', label: 'Monthly' },
] as const
const QUOTES = ['USD', 'USDT', 'BTC', 'ETH', 'SOL'].map((quote) => ({ value: quote, label: quote }))
const SINCE = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

type TrendChip = (typeof TREND)[number]['value']

function trendSelection(filters: Filters): Set<TrendChip> {
  const selected = new Set<TrendChip>()
  if (filters.direction) selected.add(filters.direction)
  if (filters.statuses.includes('warming')) selected.add('warming')
  return selected
}

function toggleTrend(filters: Filters, value: TrendChip): Filters {
  if (value === 'warming') {
    const statuses: DataStatus[] = filters.statuses.includes('warming') ? [] : ['warming']
    return { ...filters, statuses, direction: null }
  }
  const direction: Direction | null = filters.direction === value ? null : value
  return { ...filters, direction, statuses: [] }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

export function ScannerFiltersPanel({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const onSince = (event: ChangeEvent<HTMLSelectElement>) => {
    const days = Number(event.target.value)
    onChange({ ...filters, flippedWithinDays: days > 0 ? days : null })
  }
  return (
    <aside aria-label="Scanner filters" className="space-y-5 rounded-lg border border-border/50 bg-card/60 p-4">
      <Section title="Trend">
        <Chips
          label="Trend"
          options={TREND}
          selected={trendSelection(filters)}
          onToggle={(value) => {
            onChange(toggleTrend(filters, value))
          }}
        />
      </Section>
      <Section title="Time since flipped">
        <select
          aria-label="Time since flipped"
          value={filters.flippedWithinDays ? String(filters.flippedWithinDays) : ''}
          onChange={onSince}
          className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm"
        >
          {SINCE.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Section>
      <Section title="Timeframe">
        <Chips
          label="Timeframe"
          options={TIMEFRAME_OPTIONS}
          selected={new Set<Timeframe>([filters.timeframe])}
          onToggle={(timeframe) => {
            onChange({ ...filters, timeframe })
          }}
        />
      </Section>
      <Section title="Pair / quote">
        <Chips
          label="Quote"
          options={QUOTES}
          selected={new Set(filters.quote ? [filters.quote] : [])}
          onToggle={(quote) => {
            onChange({ ...filters, quote: filters.quote === quote ? null : quote })
          }}
        />
      </Section>
      <Section title="Proximity">
        <Chips
          label="Proximity"
          options={[{ value: 'ath', label: 'Near all-time high' }]}
          selected={new Set(filters.nearAth ? ['ath'] : [])}
          onToggle={() => {
            onChange({ ...filters, nearAth: !filters.nearAth })
          }}
        />
      </Section>
    </aside>
  )
}
