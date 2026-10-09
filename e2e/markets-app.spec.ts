import { test, expect, type Page } from '@playwright/test'

/**
 * Markets app E2E (EH-420/EH-421, on the EH-429 apps section): a real
 * signed-in session (`e2e/auth.setup.ts`) driving the real app. By default the
 * `/api/apps*` host routes are STUBBED with the exact shapes
 * `agent/agent_webui/apps/markets/router.py` serves (see
 * `test_markets_app.py`), so the frontend is exercised end to end before the
 * engine's FinanceMarket ops and bar ingestion are deployed. With
 * `MARKETS_LIVE=1` the stubs are skipped and the same pages run against the
 * deployed host; the scanner then shows whatever the engine holds (or its
 * stated absence). Each test saves a full-page screenshot under
 * `test-results/` for visual review.
 */

const LIVE = process.env.MARKETS_LIVE === '1'
const DAY = 86_400_000
const START = Date.UTC(2025, 0, 6)
const LISTING = {
  listing_id: 'listing:binance:SOLUSDT:spot',
  symbol: 'SOL',
  name: 'Solana',
  venue: 'Binance',
  quote: 'USDT',
  listing_type: 'spot',
  asset_class: 'crypto',
  timeframes: ['1D'],
}

function bars(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + 20 * Math.sin(index / 6) + index / 4
    return {
      t: START + index * 7 * DAY,
      T: START + (index + 1) * 7 * DAY,
      o: close - 2,
      h: close + 4,
      l: close - 5,
      c: close,
      v: 1000 + (index % 7) * 150,
      final: index < count - 1,
    }
  })
}

function chart() {
  const series = bars(80)
  return {
    listing: LISTING,
    range: '5Y',
    timeframe: '1W',
    rolled_up_from: '1D',
    tick_size: '0.01',
    source_bars: 560,
    decimated: true,
    bars: series,
    trail: series.map((bar, index) => ({
      t: bar.t,
      value: index % 30 < 15 ? bar.l - 6 : bar.h + 6,
      direction: index % 30 < 15 ? 'bullish' : 'bearish',
    })),
    atr: series.map((bar) => ({ t: bar.t, value: 8 })),
    sma200: [],
    flips: [
      {
        event_id: 'sha256:f1',
        from: 'bearish',
        to: 'bullish',
        at: series[31].T,
        bar_open: series[30].t,
        price: series[30].c,
        line: series[30].l - 6,
      },
      {
        event_id: 'sha256:f2',
        from: 'bullish',
        to: 'bearish',
        at: series[46].T,
        bar_open: series[45].t,
        price: series[45].c,
        line: series[45].h + 6,
      },
    ],
    state: {
      direction: 'bearish',
      data_status: 'valid',
      last_flip_at: series[46].T,
      flip_price: series[45].c,
      last_close: series[78].c,
      line: series[78].h + 6,
      change_since_flip_pct: -3.2,
      last_bar_close: series[78].T,
      source_revision: 'sha256:data',
      key_digest: 'sha256:key',
      indicator_version: 'super_trend@1',
      param_hash: 'sha256:params',
    },
    spec: { atr_period: 10, multiplier: 3, basis: 'raw' },
  }
}

const scan = {
  timeframe: '1W',
  universe: { listings: 2, scanned: 2, truncated: false },
  counts: { total: 2, bullish: 1, bearish: 1, warming: 0, stale: 0, unavailable: 0 },
  superseded: 0,
  rows: [
    {
      ...LISTING,
      key_digest: 'sha256:a',
      direction: 'bullish',
      data_status: 'valid',
      last_flip_at: Date.now() - 17 * DAY,
      change_since_flip_pct: 5,
      last_close: 115.06,
      flip_price: 110,
      near_ath: false,
    },
    {
      ...LISTING,
      listing_id: 'listing:kraken:ETHUSD:spot',
      symbol: 'ETH',
      name: 'Ethereum',
      venue: 'Kraken',
      quote: 'USD',
      key_digest: 'sha256:b',
      direction: 'bearish',
      data_status: 'valid',
      last_flip_at: Date.now() - 31 * DAY,
      change_since_flip_pct: -2,
      last_close: 2684.47,
      flip_price: 2740,
      near_ath: false,
    },
  ],
}

async function stubMarkets(page: Page) {
  await page.route('**/api/apps', (route) =>
    route.fulfill({ json: { apps: [{ id: 'markets', available: true, detail: null }] } }),
  )
  await page.route('**/api/apps/markets/scanner**', (route) => route.fulfill({ json: scan }))
  await page.route('**/api/apps/markets/listings**', (route) =>
    route.fulfill({ json: { listings: [LISTING], total: 1 } }),
  )
  await page.route('**/api/apps/markets/chart**', (route) => route.fulfill({ json: chart() }))
  await page.route('**/api/apps/markets/macro-events', (route) => route.fulfill({ json: { events: [] } }))
}

test.describe('Markets app', () => {
  test.beforeEach(async ({ page }) => {
    if (!LIVE) await stubMarkets(page)
  })

  test('the overview lists the scan with its counts and filters', async ({ page }, info) => {
    await page.goto('/apps/markets')
    await expect(page.getByRole('link', { name: 'Markets' })).toBeVisible()
    if (!LIVE) {
      await expect(page.getByText('of 2 listings')).toBeVisible()
      await expect(page.getByRole('rowheader', { name: /SOL/ })).toBeVisible()
      await page.getByRole('button', { name: '↑ Bullish' }).click()
      await expect(page).toHaveURL(/trend=bullish/)
    }
    await page.screenshot({ path: info.outputPath('markets-overview.png'), fullPage: true })
  })

  test('symbol search opens a chart from the keyboard', async ({ page }) => {
    test.skip(LIVE, 'needs a known listing')
    await page.goto('/apps/markets')
    await page.getByRole('button', { name: 'Search symbols' }).click()
    await page.getByRole('combobox', { name: 'Symbol, name or venue' }).fill('SOL')
    await expect(page.getByRole('option', { name: /SOL/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/apps\/markets\/chart\//)
  })

  test('the chart draws the trend line, flips and panes and walks by keyboard', async ({ page }, info) => {
    test.skip(LIVE, 'needs a known listing')
    await page.goto(
      `/apps/markets/chart/${encodeURIComponent(LISTING.listing_id)}?tf=1W&range=5Y&layers=trail,flips,volume,atr`,
    )
    const slider = page.getByRole('slider')
    await expect(slider).toBeVisible()
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '0')
    await expect(page.getByRole('list', { name: 'Flip timeline' })).toContainText('Flipped bearish')
    await page.screenshot({ path: info.outputPath('markets-chart.png'), fullPage: true })
  })
})
