/**
 * @file MarketsHome.tsx
 * @description The Markets overview (EH-420): asset-class tabs, headline
 * counts, the trend scanner and its filters, and symbol search. The scanner
 * is the engine's latest-state scan over one signal per listing; this page
 * only chooses filters and draws what comes back.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { navigateInApp, replaceSearch, useAppLocation } from '@/lib/apps/location'
import { cn } from '@/lib/utils'
import { fetchScan } from '../api'
import type { AssetClass, MarketListing } from '../schemas'
import { chartPath, readFilters, writeFilters, type ScannerFilters } from '../view-state'
import type { MarketsToolController } from '../webmcp'
import { MarketsGate, RequestFailed } from './Availability'
import { MarketsNotices } from './Notices'
import { MarketsWebMcp } from './MarketsWebMcp'
import { OverviewTiles } from './OverviewTiles'
import { ScannerFiltersPanel } from './ScannerFilters'
import { ScannerTable } from './ScannerTable'
import { SymbolSearch } from './SymbolSearch'

const TABS: { value: AssetClass | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'stock', label: 'Stocks' },
  { value: 'commodity', label: 'Commodities' },
  { value: 'etf', label: 'ETFs' },
  { value: 'forex', label: 'Forex' },
  { value: 'index', label: 'Indices' },
]

function AssetTabs({ value, onChange }: { value: AssetClass | null; onChange: (next: AssetClass | null) => void }) {
  return (
    <nav aria-label="Asset classes" className="flex flex-wrap gap-1 rounded-full border border-border/50 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.label}
          type="button"
          aria-pressed={tab.value === value}
          onClick={() => {
            onChange(tab.value)
          }}
          className={cn(
            'rounded-full px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tab.value === value ? 'bg-primary/15 font-semibold' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function useFilters(): [ScannerFilters, (next: ScannerFilters) => void] {
  const location = useAppLocation()
  const [filters, setLocal] = useState(() => readFilters(location.search))
  const set = useCallback((next: ScannerFilters) => {
    setLocal(next)
    replaceSearch(writeFilters(next))
  }, [])
  return [filters, set]
}

function ScanBody({ filters }: { filters: ScannerFilters }) {
  const scan = useQuery({
    queryKey: ['markets', 'scan', filters],
    queryFn: () => fetchScan(filters),
    staleTime: 30_000,
  })
  if (scan.isError) return <RequestFailed what="The scan" error={scan.error} />
  if (!scan.data) return <p className="text-sm text-muted-foreground">Scanning…</p>
  return (
    <div className="space-y-4">
      <OverviewTiles page={scan.data} />
      <ScannerTable rows={scan.data.rows} timeframe={filters.timeframe} now={Date.now()} />
    </div>
  )
}

function MarketsOverview() {
  const [filters, setFilters] = useFilters()
  const [searching, setSearching] = useState(false)
  const openListing = useCallback(
    (listingId: string) => {
      navigateInApp(chartPath(listingId, filters.timeframe))
    },
    [filters.timeframe],
  )
  const controller: MarketsToolController = useMemo(
    () => ({
      view: { page: 'overview', listingId: null, filters, chart: null, visibleRows: 0 },
      setFilters,
      openListing,
    }),
    [filters, setFilters, openListing],
  )
  const pick = (listing: MarketListing) => {
    setSearching(false)
    openListing(listing.listing_id)
  }
  return (
    <div className="space-y-4">
      <MarketsWebMcp controller={controller} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AssetTabs
          value={filters.assetClass}
          onChange={(assetClass) => {
            setFilters({ ...filters, assetClass })
          }}
        />
        <Button
          variant="outline"
          onClick={() => {
            setSearching(true)
          }}
        >
          <Search aria-hidden="true" /> Search symbols
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <ScanBody filters={filters} />
        <ScannerFiltersPanel filters={filters} onChange={setFilters} />
      </div>
      <MarketsNotices />
      <SymbolSearch open={searching} onOpenChange={setSearching} onPick={pick} />
    </div>
  )
}

export default function MarketsHome() {
  return (
    <MarketsGate>
      <MarketsOverview />
    </MarketsGate>
  )
}
