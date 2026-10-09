/**
 * @file quote.ts
 * @description Zod schema for a single instrument quote (FUI-04): price,
 * session, provenance, previous close, change, sparkline, logo, and an
 * optional separately-labeled after-hours value. A missing price is `null`,
 * never `0` — callers must never coerce it to a number for display.
 */
import { z } from 'zod'

/** Venue session the current price was observed in. `closed` means the
 * venue is not trading and the price is the last regular-session value. */
export const QUOTE_SESSIONS = ['regular', 'pre', 'post', 'closed'] as const
export type QuoteSession = (typeof QUOTE_SESSIONS)[number]

const quoteSession = z.enum(QUOTE_SESSIONS)

/** A separately labeled after-hours (pre- or post-market) value, shown
 * alongside the regular-session price rather than replacing it. */
export const afterHoursSchema = z.object({
  price: z.number().nullable(),
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  asOf: z.number().nullable(),
})
export type AfterHoursValue = z.infer<typeof afterHoursSchema>

export const quoteSchema = z.object({
  listingId: z.string(),
  symbol: z.string(),
  /** Current price. `null` means unavailable; render that state
   * explicitly — never as `0` or `$0.00`. */
  price: z.number().nullable(),
  previousClose: z.number().nullable(),
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  session: quoteSession,
  /** Provenance label, e.g. the feed or exchange name. */
  source: z.string(),
  /** Epoch ms the price was observed, or `null` if unavailable. */
  asOf: z.number().nullable(),
  /** Seconds of quote delay; `0` or `null` means real-time. */
  delaySeconds: z.number().nullable(),
  /** Recent price series for a mini sparkline, oldest first. Empty when
   * no history is available. */
  sparkline: z.array(z.number()),
  /** Licensed logo URL, or `null` to fall back to a text mark. */
  logoUrl: z.string().nullable(),
  afterHours: afterHoursSchema.nullable(),
})
export type Quote = z.infer<typeof quoteSchema>
