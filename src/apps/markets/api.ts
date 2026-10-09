/**
 * @file api.ts
 * @description The Markets app's typed client (`/api/apps/markets/*`). Every
 * response passes its Zod schema at `fetchValidated`, the repo's one runtime
 * validation boundary. The browser computes no finance math: indicators,
 * flips, scans, decimation and snapshot sealing all happen in the engine.
 */
import { z } from 'zod'
import { fetchValidated } from '@/lib/api-validation'
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

const BASE = '/api/apps/markets'

function query(params: Record<string, string | number | boolean | readonly string[] | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value))
      value.forEach((item: string) => {
        search.append(key, item)
      })
    else search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function fetchMarketsStatus() {
  return fetchValidated(`${BASE}/status`, statusSchema)
}

export function searchListings(q: string, assetClass: AssetClass | null, limit = 50) {
  return fetchValidated(`${BASE}/listings${query({ q, asset_class: assetClass, limit })}`, listingsSchema)
}

export interface ChartOptions {
  listing: string
  timeframe: Timeframe
  range: RangeCode
  width: number
  layers: readonly Layer[]
}

export function fetchChart(options: ChartOptions) {
  const path = `${BASE}/chart${query({
    listing: options.listing,
    timeframe: options.timeframe,
    range: options.range,
    width: Math.max(16, Math.min(4096, Math.round(options.width))),
    layers: options.layers.join(','),
  })}`
  return fetchValidated(path, chartResponseSchema)
}

export function fetchMacroEvents() {
  return fetchValidated(`${BASE}/macro-events`, macroEventsSchema)
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
  const path = `${BASE}/scanner${query({
    timeframe: options.timeframe,
    asset_class: options.assetClass,
    quote: options.quote,
    direction: options.direction,
    status: options.statuses,
    flipped_within_days: options.flippedWithinDays,
    near_ath: options.nearAth || null,
    limit: 500,
  })}`
  return fetchValidated(path, scanSchema)
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

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const

export function createShare(options: ShareOptions) {
  return fetchValidated(`${BASE}/shares`, shareCreatedSchema, { ...JSON_POST, body: JSON.stringify(options) })
}

export function fetchShared(leaseId: string) {
  return fetchValidated(`${BASE}/shares/${encodeURIComponent(leaseId)}`, sharedSchema)
}

const revokedSchema = z.object({ revoked: z.literal(true) })

export function revokeShare(leaseId: string) {
  return fetchValidated(`${BASE}/shares/${encodeURIComponent(leaseId)}/revoke`, revokedSchema, JSON_POST)
}
