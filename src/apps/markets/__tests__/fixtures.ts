import type { ChartResponse, ScanPage, SharedAnalysis } from '../schemas'

export const LISTING = {
  listing_id: 'listing:binance:SOLUSDT:spot',
  symbol: 'SOL',
  name: 'Solana',
  venue: 'Binance',
  quote: 'USDT',
  listing_type: 'spot',
  asset_class: 'crypto',
  timeframes: ['1D'],
}

const DAY = 86_400_000
const START = Date.UTC(2025, 0, 6)

export const CHART: ChartResponse = {
  listing: LISTING,
  range: '5Y',
  timeframe: '1W',
  rolled_up_from: '1D',
  tick_size: '0.01',
  source_bars: 400,
  decimated: true,
  bars: Array.from({ length: 6 }, (_, index) => ({
    t: START + index * 7 * DAY,
    T: START + (index + 1) * 7 * DAY,
    o: 100 + index,
    h: 110 + index,
    l: 95 + index,
    c: 105 + index,
    v: 1000,
    final: index < 5,
  })),
  trail: [
    { t: START, value: 90, direction: 'bearish' },
    { t: START + 7 * DAY, value: 92, direction: 'bearish' },
    { t: START + 14 * DAY, value: 96, direction: 'bullish' },
    { t: START + 21 * DAY, value: 97, direction: 'bullish' },
  ],
  atr: [{ t: START, value: 4 }],
  sma200: [],
  flips: [
    {
      event_id: 'sha256:flip',
      from: 'bearish',
      to: 'bullish',
      at: START + 21 * DAY,
      bar_open: START + 14 * DAY,
      price: 107,
      line: 96,
    },
  ],
  state: {
    direction: 'bullish',
    data_status: 'valid',
    last_flip_at: START + 21 * DAY,
    flip_price: 107,
    last_close: 110,
    line: 97,
    change_since_flip_pct: 2.8,
    last_bar_close: START + 35 * DAY,
    source_revision: 'sha256:data',
    key_digest: 'sha256:key',
    indicator_version: 'super_trend@1',
    param_hash: 'sha256:params',
  },
  spec: { atr_period: 10, multiplier: 3, basis: 'raw' },
}

export const SCAN: ScanPage = {
  timeframe: '1W',
  universe: { listings: 3, scanned: 3, truncated: false },
  counts: { total: 3, bullish: 1, bearish: 1, warming: 1, stale: 0, unavailable: 0 },
  superseded: 0,
  rows: [
    {
      ...LISTING,
      key_digest: 'sha256:a',
      direction: 'bullish',
      data_status: 'valid',
      last_flip_at: Date.now() - 3 * DAY,
      change_since_flip_pct: 5,
      last_close: 84300.01,
      flip_price: 80000,
      near_ath: false,
    },
    {
      ...LISTING,
      listing_id: 'listing:kraken:ETHUSD:spot',
      symbol: 'ETH',
      name: 'Ethereum',
      venue: 'Kraken',
      key_digest: 'sha256:b',
      direction: 'bearish',
      data_status: 'valid',
      last_flip_at: Date.now() - 30 * DAY,
      change_since_flip_pct: -2,
      last_close: 2684.47,
      flip_price: 2700,
      near_ath: false,
    },
  ],
}

export const SHARED: SharedAnalysis = {
  snapshot: {
    digest: 'sha256:snapshot',
    informational_only: true,
    excludes_positions: true,
    notices: {
      version: 1,
      informational_only: 'Engine notice: informational only.',
      hallucination: 'Engine notice: claims can be wrong.',
      mechanical_trigger: 'Engine notice: mechanical rule.',
    },
    draft: {
      window: { from_open: 0, to_close: 1, bars: 6 },
      source_revision: 'sha256:data',
      created_at: START * 1_000_000,
      layers: ['trail', 'flips'],
      claims: [
        {
          text: 'Volume rose into the flip.',
          author: 'person',
          sources: [{ title: 'Venue volume', url: 'https://example.org/volume' }],
        },
      ],
      key: { digest: 'sha256:key', indicator_version: 'super_trend@1', param_hash: 'sha256:params' },
    },
  },
  listing: LISTING,
  chart: CHART,
  reproduced: true,
  expires_at: START + DAY,
  can_revoke: true,
}
