/**
 * @file ChartPage.tsx
 * @description One listing's layered chart (EH-420): candles, the trailing
 * trend line and its flips, volume, ATR, SMA 200 and macro events; the flip
 * timeline; the signal's provenance; and sharing (EH-421). Everything on it
 * is computed by the engine — the indicators over the full signal window,
 * then decimated server-side to the chart's pixel width.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Share2, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { navigateInApp, pathParam, replaceSearch, useAppLocation } from '@/lib/apps/location'
import { fetchChart, fetchMacroEvents } from '../api'
import { formatPct, formatPrice, formatSince, tickDecimals } from '../format'
import type { ChartResponse, ChartView } from '../schemas'
import { chartPath, readChart, writeChart, type ChartSettings } from '../view-state'
import type { MarketsToolController } from '../webmcp'
import { MarketsGate, RequestFailed } from './Availability'
import { chartModel, type ChartPalette } from './chart-model'
import { ChartDataTable, ChartPanel, FlipTimeline } from './ChartPanel'
import { ChartToolbar } from './ChartToolbar'
import { MarketsNotices } from './Notices'
import { MarketsWebMcp } from './MarketsWebMcp'
import { ShareDialog } from './ShareDialog'
import { TrendBadge } from './TrendBadge'
import { useElementWidth } from './use-element-width'

const PREFIX = '/apps/markets/chart'
const WIDTH_STEP = 100
const AXIS = 64

export function SignalSummary({ chart }: { chart: ChartView }) {
  const state = chart.state
  const decimals = tickDecimals(chart.tick_size)
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <div>
        <dt className="sr-only">Trend</dt>
        <dd>
          <TrendBadge direction={state.direction} status={state.data_status} />
        </dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Flipped </dt>
        <dd className="inline tabular-nums">
          {formatSince(state.last_flip_at, Date.now())} ago at {formatPrice(state.flip_price, decimals)}
        </dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Since flip </dt>
        <dd className="inline tabular-nums">{formatPct(state.change_since_flip_pct)}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Flip level </dt>
        <dd className="inline tabular-nums">{formatPrice(state.line, decimals)}</dd>
      </div>
    </dl>
  )
}

export function Provenance({ chart }: { chart: ChartView }) {
  const { state } = chart
  const notes = [
    chart.rolled_up_from ? `rolled up from ${chart.rolled_up_from} bars by the engine` : null,
    chart.decimated
      ? `${chart.source_bars} bars thinned to ${chart.bars.length} for this width (M4: extremes kept)`
      : null,
  ].filter(Boolean)
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">How this was computed</summary>
      <p className="mt-1">
        {state.indicator_version} (ATR {chart.spec.atr_period}, multiplier {chart.spec.multiplier}, {chart.spec.basis}{' '}
        candles), tick size {chart.tick_size}. {notes.join('; ')}
      </p>
      <p className="font-mono break-all">signal {state.key_digest}</p>
      <p className="font-mono break-all">data {state.source_revision}</p>
    </details>
  )
}

function useChartSettings(): [ChartSettings, (next: ChartSettings) => void] {
  const location = useAppLocation()
  const [settings, setLocal] = useState(() => readChart(location.search))
  const set = useCallback((next: ChartSettings) => {
    setLocal(next)
    replaceSearch(writeChart(next))
  }, [])
  return [settings, set]
}

function usePalette(): [ChartPalette, (next: ChartPalette) => void] {
  const [palette, setPalette] = useState<ChartPalette>(() => {
    try {
      return window.localStorage.getItem('markets.palette') === 'cvd' ? 'cvd' : 'convention'
    } catch {
      return 'convention'
    }
  })
  const set = (next: ChartPalette) => {
    setPalette(next)
    try {
      window.localStorage.setItem('markets.palette', next)
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this page only.
    }
  }
  return [palette, set]
}

function ChartBody({
  data,
  settings,
  palette,
}: {
  data: ChartResponse
  settings: ChartSettings
  palette: ChartPalette
}) {
  const [showTable, setShowTable] = useState(false)
  const layers = useMemo(() => new Set<string>(settings.layers), [settings.layers])
  const macro = useQuery({ queryKey: ['markets', 'macro'], queryFn: fetchMacroEvents, enabled: layers.has('macro') })
  const title = `${data.listing.symbol} / ${data.listing.quote} · ${data.timeframe} · ${data.listing.venue}`
  const model = useMemo(
    () => chartModel(title, data, layers, macro.data?.events ?? []),
    [title, data, layers, macro.data],
  )
  return (
    <div className="space-y-3">
      <SignalSummary chart={data} />
      <ChartPanel model={model} palette={palette} />
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showTable}
        onClick={() => {
          setShowTable(!showTable)
        }}
      >
        <Table2 aria-hidden="true" /> {showTable ? 'Hide data table' : 'Show data table'}
      </Button>
      {showTable && <ChartDataTable model={model} />}
      <section aria-labelledby="flip-timeline-heading" className="space-y-2">
        <h2 id="flip-timeline-heading" className="text-sm font-semibold">
          Flip timeline
        </h2>
        <FlipTimeline flips={data.flips} timeframe={data.timeframe} decimals={model.priceDecimals} />
      </section>
      <Provenance chart={data} />
    </div>
  )
}

function ListingChart({ listingId }: { listingId: string }) {
  const [settings, setSettings] = useChartSettings()
  const [palette, setPalette] = usePalette()
  const [sharing, setSharing] = useState(false)
  const [ref, measured] = useElementWidth<HTMLDivElement>(900)
  const width = Math.max(WIDTH_STEP, Math.round((measured - AXIS) / WIDTH_STEP) * WIDTH_STEP)
  const chart = useQuery({
    queryKey: ['markets', 'chart', listingId, settings, width],
    queryFn: () => fetchChart({ listing: listingId, ...settings, width }),
  })
  const controller: MarketsToolController = useMemo(
    () => ({
      view: { page: 'chart', listingId, filters: null, chart: settings, visibleRows: chart.data?.bars.length ?? 0 },
      setChart: setSettings,
      openListing: (id: string) => {
        navigateInApp(chartPath(id, settings.timeframe))
      },
    }),
    [listingId, settings, setSettings, chart.data],
  )
  const heading = chart.data ? `${chart.data.listing.symbol} / ${chart.data.listing.quote}` : 'Market chart'
  return (
    <div ref={ref} className="space-y-4">
      <MarketsWebMcp controller={controller} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          {heading}
          {chart.data && (
            <span className="ml-2 text-base font-normal text-muted-foreground">{chart.data.listing.venue}</span>
          )}
        </h1>
        <Button
          variant="outline"
          onClick={() => {
            setSharing(true)
          }}
          disabled={!chart.data}
        >
          <Share2 aria-hidden="true" /> Share analysis
        </Button>
      </div>
      <ChartToolbar settings={settings} onChange={setSettings} palette={palette} onPalette={setPalette} />
      {chart.isError && <RequestFailed what="The chart" error={chart.error} />}
      {!chart.data && !chart.isError && <p className="text-sm text-muted-foreground">Loading chart…</p>}
      {chart.data && <ChartBody data={chart.data} settings={settings} palette={palette} />}
      <MarketsNotices />
      <ShareDialog open={sharing} onOpenChange={setSharing} listingId={listingId} settings={settings} />
    </div>
  )
}

export default function ChartPage() {
  const location = useAppLocation()
  const listingId = pathParam(location.pathname, PREFIX)
  return (
    <MarketsGate>
      {listingId ? (
        <ListingChart key={listingId} listingId={listingId} />
      ) : (
        <p role="alert">This chart link is not valid.</p>
      )}
    </MarketsGate>
  )
}
