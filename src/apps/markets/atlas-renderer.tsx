/**
 * @file atlas-renderer.tsx
 * @description The OHLC renderer the Markets app contributes to Atlas: any
 * result whose rows are complete candles draws with the same
 * {@link ChartRenderer} the Markets pages use.
 */
import { useMemo } from 'react'
import { CandlestickChart } from 'lucide-react'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import { ChartPanel } from './components/ChartPanel'
import type { ChartModel } from './components/chart-model'
import { ohlcBars } from './ohlc-rows'

function OhlcAtlasBody({ projection }: RendererProps) {
  const model: ChartModel | null = useMemo(() => {
    const bars = ohlcBars(projection.rows.rows)
    if (!bars) return null
    return {
      title: `Candles from ${projection.result.adapterId}`,
      timeframe: '1D',
      bars,
      trail: [],
      overlays: [],
      panes: [],
      flips: [],
      events: [],
      showVolume: bars.some((bar) => bar.v > 0),
      showFlips: false,
      flipLevel: null,
      priceDecimals: null,
    }
  }, [projection])
  if (!model) return null
  return <ChartPanel model={model} palette="convention" />
}

export const ohlcAtlasRenderer: AtlasRenderer = {
  id: 'ohlc',
  label: 'Candles',
  icon: CandlestickChart,
  priority: 70,
  prefers: ['series'],
  accepts: (projection) => ohlcBars(projection.rows.rows) !== null,
  component: OhlcAtlasBody,
}
