/**
 * @file detail-support.ts
 * @description Typed detail-view contract (FIN-UI-R001.1, FUI-05.1). The
 * instrument detail view offers Chart, Rates, News, Notes, Dividends, and
 * Analysis tabs, but only the tabs, intervals, and data types the
 * underlying series actually supports; every unsupported combination gets
 * an explanatory reason rather than being silently rendered or hidden with
 * no explanation. Wiring these pure checks into ChartPage/tab components is
 * FIN-UI-R001.2 / FUI-05.2.
 */
import type { Timeframe } from './schemas'

export const DETAIL_TABS = ['chart', 'rates', 'news', 'notes', 'dividends', 'analysis'] as const
export type DetailTabId = (typeof DETAIL_TABS)[number]

/** What an instrument's series actually supports, independent of any UI. */
export interface SeriesCapabilities {
  dataTypes: readonly ('line' | 'candle')[]
  supportedTimeframes: readonly Timeframe[]
  hasVolume: boolean
  hasRates: boolean
  hasDividends: boolean
}

export interface ModeDecision {
  allowed: boolean
  reason?: string
}

/** Rates and Dividends tabs depend on instrument data; the rest are always offered. */
export function supportedDetailTabs(
  capabilities: SeriesCapabilities,
): ModeDecision & { tabs: readonly DetailTabId[] } {
  const tabs = DETAIL_TABS.filter((tab) => {
    if (tab === 'rates') return capabilities.hasRates
    if (tab === 'dividends') return capabilities.hasDividends
    return true
  })
  return { allowed: tabs.length > 0, tabs }
}

/** A requested chart mode is allowed only when the series capabilities actually support it. */
export function supportedChartMode(
  capabilities: SeriesCapabilities,
  requested: { timeframe: Timeframe; dataType: 'line' | 'candle'; showVolume: boolean },
): ModeDecision {
  if (!capabilities.dataTypes.includes(requested.dataType)) {
    return { allowed: false, reason: `${requested.dataType} data is not available for this instrument` }
  }
  if (!capabilities.supportedTimeframes.includes(requested.timeframe)) {
    return { allowed: false, reason: `${requested.timeframe} is not a supported interval for this instrument` }
  }
  if (requested.showVolume && !capabilities.hasVolume) {
    return { allowed: false, reason: 'volume is not available for this instrument' }
  }
  return { allowed: true }
}
