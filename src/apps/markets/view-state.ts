/**
 * @file view-state.ts
 * @description The Markets pages' view state and its URL form: scanner
 * filters on the overview, timeframe/range/layers on a chart. The URL is the
 * source of truth so a view can be bookmarked, and the WebMCP tools change
 * the same state a person's clicks do.
 */
import {
  ASSET_CLASSES,
  DATA_STATUSES,
  LAYERS,
  RANGES,
  TIMEFRAMES,
  type AssetClass,
  type DataStatus,
  type Direction,
  type Layer,
  type RangeCode,
  type Timeframe,
} from './schemas'

export interface ScannerFilters {
  timeframe: Timeframe
  assetClass: AssetClass | null
  direction: Direction | null
  statuses: DataStatus[]
  flippedWithinDays: number | null
  quote: string | null
  nearAth: boolean
}

export interface ChartSettings {
  timeframe: Timeframe
  range: RangeCode
  layers: Layer[]
}

export const DEFAULT_FILTERS: ScannerFilters = {
  timeframe: '1W',
  assetClass: null,
  direction: null,
  statuses: [],
  flippedWithinDays: null,
  quote: null,
  nearAth: false,
}

export const DEFAULT_CHART: ChartSettings = { timeframe: '1W', range: '5Y', layers: ['trail', 'flips', 'volume'] }

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  return values.find((value) => value === raw) ?? null
}

function positive(raw: string | null): number | null {
  const value = Number(raw)
  return raw !== null && Number.isInteger(value) && value > 0 ? value : null
}

export function readFilters(search: URLSearchParams): ScannerFilters {
  const quote = search.get('quote')
  return {
    timeframe: oneOf(TIMEFRAMES, search.get('tf')) ?? DEFAULT_FILTERS.timeframe,
    assetClass: oneOf(ASSET_CLASSES, search.get('asset')),
    direction: oneOf(['bullish', 'bearish'] as const, search.get('trend')),
    statuses: search.getAll('status').flatMap((raw) => oneOf(DATA_STATUSES, raw) ?? []),
    flippedWithinDays: positive(search.get('since')),
    quote: quote && /^[A-Z0-9]{1,16}$/.test(quote) ? quote : null,
    nearAth: search.get('ath') === '1',
  }
}

export function writeFilters(filters: ScannerFilters): URLSearchParams {
  const search = new URLSearchParams({ tf: filters.timeframe })
  if (filters.assetClass) search.set('asset', filters.assetClass)
  if (filters.direction) search.set('trend', filters.direction)
  filters.statuses.forEach((status) => {
    search.append('status', status)
  })
  if (filters.flippedWithinDays) search.set('since', String(filters.flippedWithinDays))
  if (filters.quote) search.set('quote', filters.quote)
  if (filters.nearAth) search.set('ath', '1')
  return search
}

export function readChart(search: URLSearchParams): ChartSettings {
  const layers = (search.get('layers') ?? '').split(',').flatMap((raw) => oneOf(LAYERS, raw) ?? [])
  return {
    timeframe: oneOf(TIMEFRAMES, search.get('tf')) ?? DEFAULT_CHART.timeframe,
    range: oneOf(RANGES, search.get('range')) ?? DEFAULT_CHART.range,
    layers: search.has('layers') ? layers : DEFAULT_CHART.layers,
  }
}

export function writeChart(settings: ChartSettings): URLSearchParams {
  return new URLSearchParams({ tf: settings.timeframe, range: settings.range, layers: settings.layers.join(',') })
}

export function chartPath(listingId: string, timeframe: Timeframe): string {
  return `/apps/markets/chart/${encodeURIComponent(listingId)}?tf=${timeframe}`
}
