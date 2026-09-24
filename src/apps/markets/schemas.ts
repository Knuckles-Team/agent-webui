/**
 * @file schemas.ts
 * @description Zod schemas for every Markets response (`/api/apps/markets/*`).
 * Prices arrive already scaled by the series' tick size; times are epoch ms.
 */
import { z } from 'zod'

export const TIMEFRAMES = ['1h', '4h', '12h', '1D', '1W', '1M'] as const
export const RANGES = ['1M', '3M', '1Y', '5Y', 'all'] as const
export const ASSET_CLASSES = ['crypto', 'stock', 'etf', 'commodity', 'forex', 'index'] as const
export const LAYERS = ['trail', 'flips', 'volume', 'atr', 'sma200', 'macro'] as const
export const DATA_STATUSES = ['warming', 'valid', 'stale', 'unavailable'] as const

export type Timeframe = (typeof TIMEFRAMES)[number]
export type RangeCode = (typeof RANGES)[number]
export type AssetClass = (typeof ASSET_CLASSES)[number]
export type Layer = (typeof LAYERS)[number]
export type DataStatus = (typeof DATA_STATUSES)[number]

const direction = z.enum(['bullish', 'bearish'])
export type Direction = z.infer<typeof direction>
const dataStatus = z.enum(DATA_STATUSES)

export const listingSchema = z.object({
  listing_id: z.string(),
  symbol: z.string(),
  name: z.string(),
  venue: z.string(),
  quote: z.string(),
  listing_type: z.string(),
  asset_class: z.string(),
  timeframes: z.array(z.string()),
})
export type MarketListing = z.infer<typeof listingSchema>

export const listingsSchema = z.object({ listings: z.array(listingSchema), total: z.number() })

export const barSchema = z.object({
  t: z.number(),
  T: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  final: z.boolean(),
})
export type OhlcBar = z.infer<typeof barSchema>

export const trailPointSchema = z.object({ t: z.number(), value: z.number(), direction })
export type TrailPoint = z.infer<typeof trailPointSchema>
export const linePointSchema = z.object({ t: z.number(), value: z.number() })
export type LinePoint = z.infer<typeof linePointSchema>

export const flipSchema = z.object({
  event_id: z.string(),
  from: direction,
  to: direction,
  at: z.number(),
  bar_open: z.number(),
  price: z.number(),
  line: z.number(),
})
export type FlipMarker = z.infer<typeof flipSchema>

export const signalStateSchema = z.object({
  direction: direction.nullable(),
  data_status: dataStatus,
  last_flip_at: z.number().nullable(),
  flip_price: z.number().nullable(),
  last_close: z.number().nullable(),
  line: z.number().nullable(),
  change_since_flip_pct: z.number().nullable(),
  last_bar_close: z.number().nullable(),
  source_revision: z.string(),
  key_digest: z.string(),
  indicator_version: z.string(),
  param_hash: z.string(),
})
export type SignalStateView = z.infer<typeof signalStateSchema>

export const chartSchema = z.object({
  timeframe: z.string(),
  rolled_up_from: z.string().nullable(),
  tick_size: z.string(),
  source_bars: z.number(),
  decimated: z.boolean(),
  bars: z.array(barSchema),
  trail: z.array(trailPointSchema),
  atr: z.array(linePointSchema),
  sma200: z.array(linePointSchema),
  flips: z.array(flipSchema),
  state: signalStateSchema,
  spec: z.object({ atr_period: z.number(), multiplier: z.number(), basis: z.string() }),
})
export type ChartView = z.infer<typeof chartSchema>

export const chartResponseSchema = chartSchema.extend({ listing: listingSchema, range: z.string() })
export type ChartResponse = z.infer<typeof chartResponseSchema>

export const macroEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  announced_at: z.string(),
  title: z.string(),
  source_url: z.string().nullable(),
})
export type MacroEvent = z.infer<typeof macroEventSchema>
export const macroEventsSchema = z.object({ events: z.array(macroEventSchema) })

export const scanRowSchema = listingSchema.extend({
  key_digest: z.string(),
  direction: direction.nullable(),
  data_status: dataStatus,
  last_flip_at: z.number().nullable(),
  change_since_flip_pct: z.number().nullable(),
  last_close: z.number().nullable(),
  flip_price: z.number().nullable(),
  near_ath: z.boolean(),
})
export type ScanRow = z.infer<typeof scanRowSchema>

export const scanSchema = z.object({
  timeframe: z.string(),
  universe: z.object({ listings: z.number(), scanned: z.number(), truncated: z.boolean() }),
  counts: z.object({
    total: z.number(),
    bullish: z.number(),
    bearish: z.number(),
    warming: z.number().optional(),
    stale: z.number().optional(),
    unavailable: z.number().optional(),
  }),
  superseded: z.number(),
  rows: z.array(scanRowSchema),
})
export type ScanPage = z.infer<typeof scanSchema>

export const statusSchema = z.object({ available: z.boolean(), detail: z.string().nullable() })

export const shareCreatedSchema = z.object({
  lease_id: z.string(),
  digest: z.string(),
  expires_at: z.number(),
  path: z.string(),
})
export type ShareCreated = z.infer<typeof shareCreatedSchema>

const claimSchema = z.object({
  text: z.string(),
  author: z.enum(['agent', 'person']),
  sources: z.array(z.object({ title: z.string(), url: z.string().nullish(), record_ref: z.string().nullish() })),
})
export type SnapshotClaim = z.infer<typeof claimSchema>

export const snapshotSchema = z.object({
  digest: z.string(),
  informational_only: z.literal(true),
  excludes_positions: z.literal(true),
  notices: z.object({
    version: z.number(),
    informational_only: z.string(),
    hallucination: z.string(),
    mechanical_trigger: z.string(),
  }),
  draft: z
    .object({
      window: z.object({ from_open: z.number(), to_close: z.number(), bars: z.number() }),
      source_revision: z.string(),
      created_at: z.number(),
      layers: z.array(z.string()),
      claims: z.array(claimSchema),
      key: z.object({ digest: z.string(), indicator_version: z.string(), param_hash: z.string() }).loose(),
    })
    .loose(),
})
export type AnalysisSnapshot = z.infer<typeof snapshotSchema>

export const sharedSchema = z.object({
  snapshot: snapshotSchema,
  listing: listingSchema,
  chart: chartSchema,
  reproduced: z.boolean(),
  expires_at: z.number(),
  can_revoke: z.boolean(),
})
export type SharedAnalysis = z.infer<typeof sharedSchema>
