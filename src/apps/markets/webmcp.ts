/**
 * @file webmcp.ts
 * @description The Markets app's WebMCP browser tools. They read the page's
 * view or change its local view state (filters, timeframe, layers, which
 * listing is open) exactly as a click would; `search-listings` reads the
 * catalog. No tool creates a share, writes data or confers any trading
 * authority — everything here is informational only.
 */
import { z } from 'zod'
import { appToolName } from '@/lib/apps/contract'
import { makeTool } from '@/lib/webmcp/tools'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { searchListings } from './api'
import { ASSET_CLASSES, DATA_STATUSES, LAYERS, RANGES, TIMEFRAMES } from './schemas'
import type { ChartSettings, ScannerFilters } from './view-state'

const APP = 'markets'
const SOURCE = 'graph-os-webui:src/apps/markets/webmcp.ts'
/** The host's listing-id grammar: no path traversal, no leading slash. */
const LISTING_ID = /^(?!.*\.\.)[A-Za-z0-9:._@+-][A-Za-z0-9:._/@+-]{0,255}$/

const FiltersSchema = z
  .object({
    timeframe: z.enum(TIMEFRAMES),
    assetClass: z.enum(ASSET_CLASSES).nullable(),
    direction: z.enum(['bullish', 'bearish']).nullable(),
    statuses: z.array(z.enum(DATA_STATUSES)).max(4),
    flippedWithinDays: z.number().int().min(1).max(3650).nullable(),
    quote: z
      .string()
      .regex(/^[A-Z0-9]{1,16}$/)
      .nullable(),
    nearAth: z.boolean(),
  })
  .strict()

const ChartSchema = z
  .object({ timeframe: z.enum(TIMEFRAMES), range: z.enum(RANGES), layers: z.array(z.enum(LAYERS)).max(LAYERS.length) })
  .strict()

const ViewSchema = z
  .object({
    page: z.enum(['overview', 'chart']),
    listingId: z.string().max(256).nullable(),
    filters: FiltersSchema.nullable(),
    chart: ChartSchema.nullable(),
    visibleRows: z.number().int().min(0),
  })
  .strict()

const SearchInput = z.object({ query: z.string().min(1).max(64) }).strict()
const SearchOutput = z
  .object({
    listings: z
      .array(z.object({ listingId: z.string(), symbol: z.string(), venue: z.string(), quote: z.string() }).strict())
      .max(10),
  })
  .strict()
const OpenInput = z.object({ listingId: z.string().regex(LISTING_ID) }).strict()
const Updated = z.object({ updated: z.literal(true) }).strict()
const Empty = z.object({}).strict()

export type MarketsView = z.infer<typeof ViewSchema>

export interface MarketsToolController {
  view: MarketsView
  setFilters?: (filters: ScannerFilters) => void
  setChart?: (settings: ChartSettings) => void
  openListing: (listingId: string) => void
}

function localTool<Input, Output>(
  name: string,
  description: string,
  input: z.ZodType<Input>,
  output: z.ZodType<Output>,
  execute: (value: Input) => Output | PromiseLike<Output>,
  readOnly = false,
): WebMcpToolDefinition {
  return makeTool({
    name: appToolName(APP, name),
    title: name.replace(/-/g, ' '),
    description,
    inputSchema: input,
    outputSchema: output,
    jsonSchema: z.toJSONSchema(input),
    readOnly,
    source: SOURCE,
    execute,
  })
}

async function search({ query }: z.infer<typeof SearchInput>) {
  const found = await searchListings(query, null, 10)
  return {
    listings: found.listings.map((item) => ({
      listingId: item.listing_id,
      symbol: item.symbol,
      venue: item.venue,
      quote: item.quote,
    })),
  }
}

function viewTools(controller: MarketsToolController): WebMcpToolDefinition[] {
  return [
    localTool(
      'get-view',
      'Read the Markets page: which page, listing, scanner filters or chart settings are showing. UI state only.',
      Empty,
      ViewSchema,
      () => controller.view,
      true,
    ),
    localTool(
      'search-listings',
      'Find listings by symbol, name or venue. Read-only; returns at most ten matches.',
      SearchInput,
      SearchOutput,
      search,
      true,
    ),
    localTool('open-listing', 'Open the chart of one listing by its id.', OpenInput, Updated, ({ listingId }) => {
      controller.openListing(listingId)
      return { updated: true as const }
    }),
  ]
}

/** The tools for one mounted Markets page. */
export function createMarketsTools(controller: MarketsToolController): readonly WebMcpToolDefinition[] {
  const tools = viewTools(controller)
  const { setFilters, setChart } = controller
  if (setFilters) {
    tools.push(
      localTool(
        'set-scanner-filters',
        'Replace the scanner filters (timeframe, asset class, trend, data status, time since flip, quote, near all-time high). Local view state only.',
        FiltersSchema,
        Updated,
        (filters) => {
          setFilters(filters)
          return { updated: true as const }
        },
      ),
    )
  }
  if (setChart) {
    tools.push(
      localTool(
        'set-chart',
        'Change the chart timeframe, history range and visible layers. Local view state only.',
        ChartSchema,
        Updated,
        (settings) => {
          setChart(settings)
          return { updated: true as const }
        },
      ),
    )
  }
  return tools
}
