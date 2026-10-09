/**
 * @file ChartToolbar.tsx
 * @description Timeframe, history range, layers and colour choice for a chart.
 */
import { LAYERS, RANGES, type Layer, type RangeCode, type Timeframe } from '../schemas'
import type { ChartSettings } from '../view-state'
import type { ChartPalette } from './chart-model'
import { Chips } from './Chips'

const TIMEFRAME_LABELS: { value: Timeframe; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '12h', label: '12h' },
  { value: '1D', label: 'D' },
  { value: '1W', label: 'W' },
  { value: '1M', label: 'M' },
]
const RANGE_LABELS = RANGES.map((value) => ({ value, label: value === 'all' ? 'All' : value }))
const LAYER_LABELS: Record<Layer, string> = {
  trail: 'Trend line',
  flips: 'Flip labels',
  volume: 'Volume',
  atr: 'ATR 14',
  sma200: 'SMA 200',
  macro: 'Macro events',
}

function toggled(layers: Layer[], layer: Layer): Layer[] {
  return layers.includes(layer)
    ? layers.filter((item) => item !== layer)
    : LAYERS.filter((item) => item === layer || layers.includes(item))
}

export function ChartToolbar({
  settings,
  onChange,
  palette,
  onPalette,
}: {
  settings: ChartSettings
  onChange: (next: ChartSettings) => void
  palette: ChartPalette
  onPalette: (next: ChartPalette) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Chips
        label="Timeframe"
        options={TIMEFRAME_LABELS}
        selected={new Set([settings.timeframe])}
        onToggle={(timeframe) => {
          onChange({ ...settings, timeframe })
        }}
      />
      <Chips
        label="History"
        options={RANGE_LABELS}
        selected={new Set<RangeCode>([settings.range])}
        onToggle={(range) => {
          onChange({ ...settings, range })
        }}
      />
      <Chips
        label="Layers"
        options={LAYERS.map((value) => ({ value, label: LAYER_LABELS[value] }))}
        selected={new Set(settings.layers)}
        onToggle={(layer) => {
          onChange({ ...settings, layers: toggled(settings.layers, layer) })
        }}
      />
      <Chips
        label="Colours"
        options={[{ value: 'cvd', label: 'Colour-blind safe' }]}
        selected={new Set(palette === 'cvd' ? ['cvd'] : [])}
        onToggle={() => {
          onPalette(palette === 'cvd' ? 'convention' : 'cvd')
        }}
      />
    </div>
  )
}
