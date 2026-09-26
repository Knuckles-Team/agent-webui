/**
 * @file api.ts
 * @description The Markets app's typed client over GraphOS operations. Every
 * response passes its Zod schema at `invoke`, the runtime
 * validation boundary. The browser computes no finance math: indicators,
 * flips, scans, decimation and snapshot sealing all happen in the engine.
 */
import { z } from 'zod'
import { invoke } from '@/lib/graphos-api/invoke'
import {
  chartResponseSchema,
  listingsSchema,
  macroEventsSchema,
  scanSchema,
  shareCreatedSchema,
  sharedSchema,
  statusSchema,
  type AssetClass,
  type DataStatus,
  type Direction,
  type Layer,
  type RangeCode,
  type Timeframe,
} from './schemas'

export function fetchMarketsStatus() {
  return invoke('markets.status', {}, statusSchema)
}

export function searchListings(q: string, assetClass: AssetClass | null, limit = 50) {
  return invoke('markets.listings.list', { q, asset_class: assetClass, limit }, listingsSchema)
}

export interface ChartOptions {
  listing: string
  timeframe: Timeframe
  range: RangeCode
  width: number
  layers: readonly Layer[]
}

export function fetchChart(options: ChartOptions) {
  return invoke(
    'markets.chart.get',
    {
      listing_id: options.listing,
      timeframe: options.timeframe,
      range: options.range,
      width: Math.max(16, Math.min(4096, Math.round(options.width))),
      layers: options.layers,
    },
    chartResponseSchema,
  )
}

export function fetchMacroEvents() {
  return invoke('markets.macro.events', {}, macroEventsSchema)
}

export interface ScanOptions {
  timeframe: Timeframe
  assetClass: AssetClass | null
  quote: string | null
  direction: Direction | null
  statuses: readonly DataStatus[]
  flippedWithinDays: number | null
  nearAth: boolean
}

export function fetchScan(options: ScanOptions) {
  return invoke(
    'markets.scanner.run',
    {
      timeframe: options.timeframe,
      asset_class: options.assetClass,
      quote: options.quote,
      direction: options.direction,
      status: [...options.statuses],
      flipped_within_days: options.flippedWithinDays,
      near_ath: options.nearAth,
      limit: 500,
    },
    scanSchema,
  )
}

export interface ShareNote {
  text: string
  sources: { title: string; url: string }[]
}

export interface ShareOptions {
  listing_id: string
  timeframe: Timeframe
  range: RangeCode
  layers: readonly Layer[]
  notes: ShareNote[]
  hours: number
}

export function createShare(options: ShareOptions) {
  return invoke(
    'markets.snapshots.share',
    {
      listing_id: options.listing_id,
      timeframe: options.timeframe,
      range: options.range,
      layers: options.layers,
      notes: options.notes,
      hours: options.hours,
    },
    shareCreatedSchema,
    { idempotencyKey: crypto.randomUUID() },
  )
}

export function fetchShared(leaseId: string) {
  return invoke('markets.snapshots.get', { lease_id: leaseId }, sharedSchema)
}

const revokedSchema = z.object({ revoked: z.literal(true) })

export function revokeShare(leaseId: string) {
  return invoke('markets.snapshots.revoke', { lease_id: leaseId }, revokedSchema, {
    idempotencyKey: crypto.randomUUID(),
  })
}
