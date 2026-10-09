import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/fixtures'
import * as catalog from '@/lib/apps/catalog'
import * as api from '../api'
import ChartPage from '../components/ChartPage'
import MarketsHome from '../components/MarketsHome'
import SharePage from '../components/SharePage'
import { CHART, LISTING, SCAN, SHARED } from './fixtures'

/**
 * The Markets pages against their REAL client module (spied, not replaced),
 * so a renamed or reshaped client call fails here rather than hiding behind a
 * hand-written fake.
 */

function available(reason?: string) {
  vi.spyOn(catalog, 'useAppAvailability').mockReturnValue({
    loading: false,
    available: new Set(reason ? [] : ['app:markets']),
    reasons: new Map(reason ? [['app:markets', reason]] : []),
  })
}

function visit(path: string) {
  window.history.pushState({}, '', path)
}

beforeEach(() => {
  available()
})

afterEach(() => {
  vi.restoreAllMocks()
  visit('/')
})

describe('Markets overview', () => {
  it('shows counts with their denominator and the engine-ordered rows', async () => {
    const scan = vi.spyOn(api, 'fetchScan').mockResolvedValue(SCAN)
    visit('/apps/markets')
    renderWithProviders(<MarketsHome />)
    expect(await screen.findByText('Signals')).toBeInTheDocument()
    expect(screen.getByText('of 3 listings')).toBeInTheDocument()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      expect.stringContaining('SOL'),
      expect.stringContaining('ETH'),
    ])
    expect(within(rows[0]).getByText('bullish')).toBeInTheDocument()
    expect(within(rows[0]).getByText('+5.0%')).toBeInTheDocument()
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '1W', direction: null }))
  })

  it('turns a filter click into a new engine scan and keeps it in the URL', async () => {
    const scan = vi.spyOn(api, 'fetchScan').mockResolvedValue(SCAN)
    visit('/apps/markets')
    renderWithProviders(<MarketsHome />)
    await screen.findByText('Signals')
    fireEvent.click(within(screen.getByRole('group', { name: 'Trend' })).getByRole('button', { name: '↑ Bullish' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Timeframe' })).getByRole('button', { name: 'Daily' }))
    await waitFor(() => {
      expect(scan).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'bullish', timeframe: '1D' }))
    })
    expect(window.location.search).toBe('?tf=1D&trend=bullish')
  })

  it('says a failed scan failed instead of showing an empty market', async () => {
    vi.spyOn(api, 'fetchScan').mockRejectedValue(new Error('API 503: engine down'))
    renderWithProviders(<MarketsHome />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an empty result')
  })

  it('states why the app is unavailable', () => {
    available('The engine does not serve market signals yet')
    renderWithProviders(<MarketsHome />)
    expect(screen.getByRole('status')).toHaveTextContent('The engine does not serve market signals yet')
  })
})

describe('Market chart', () => {
  beforeEach(() => {
    visit(`/apps/markets/chart/${encodeURIComponent(LISTING.listing_id)}?tf=1W`)
  })

  it('draws the engine chart with its state, flip timeline and provenance', async () => {
    const chart = vi.spyOn(api, 'fetchChart').mockResolvedValue(CHART)
    renderWithProviders(<ChartPage />)
    expect(await screen.findByRole('heading', { level: 1, name: /SOL \/ USDT/ })).toBeInTheDocument()
    expect(chart).toHaveBeenCalledWith(
      expect.objectContaining({ listing: LISTING.listing_id, timeframe: '1W', layers: ['trail', 'flips', 'volume'] }),
    )
    expect(screen.getByRole('list', { name: 'Flip timeline' })).toHaveTextContent('Flipped bullish')
    expect(screen.getByText(/400 bars thinned to 6/)).toBeInTheDocument()
    expect(screen.getByText(/rolled up from 1D/)).toBeInTheDocument()
    expect(screen.getByLabelText('About this information')).toHaveTextContent('Informational only')
  })

  it('walks the bars from the keyboard and announces each one', async () => {
    vi.spyOn(api, 'fetchChart').mockResolvedValue(CHART)
    renderWithProviders(<ChartPage />)
    const slider = await screen.findByRole('slider')
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('(bar still open)'))
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('open 100.00'))
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '1')
  })

  it('refetches with the layers a person turns on', async () => {
    const chart = vi.spyOn(api, 'fetchChart').mockResolvedValue(CHART)
    renderWithProviders(<ChartPage />)
    await screen.findByRole('slider')
    fireEvent.click(within(screen.getByRole('group', { name: 'Layers' })).getByRole('button', { name: 'ATR 14' }))
    await waitFor(() => {
      expect(chart).toHaveBeenLastCalledWith(expect.objectContaining({ layers: ['trail', 'flips', 'volume', 'atr'] }))
    })
  })

  it('will not share a note without a source', async () => {
    vi.spyOn(api, 'fetchChart').mockResolvedValue(CHART)
    const share = vi.spyOn(api, 'createShare')
    renderWithProviders(<ChartPage />)
    await screen.findByRole('slider')
    fireEvent.click(screen.getByRole('button', { name: /Share analysis/ }))
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Breakout.' } })
    expect(screen.getByText(/A note is a claim/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled()
    expect(share).not.toHaveBeenCalled()
  })
})

describe('Shared analysis', () => {
  beforeEach(() => {
    visit('/apps/markets/share/share-abcdefgh12')
  })

  it('shows the engine-stamped notices, sourced claims and verification', async () => {
    vi.spyOn(api, 'fetchShared').mockResolvedValue(SHARED)
    renderWithProviders(<SharePage />)
    expect(await screen.findByText('Engine notice: informational only.')).toBeInTheDocument()
    expect(screen.getByText('Engine notice: claims can be wrong.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Venue volume' })).toHaveAttribute('href', 'https://example.org/volume')
    expect(screen.getByText(/Verified: the record matches its digest/)).toBeInTheDocument()
  })

  it('lets the issuer revoke the link', async () => {
    vi.spyOn(api, 'fetchShared').mockResolvedValue(SHARED)
    const revoke = vi.spyOn(api, 'revokeShare').mockResolvedValue({ revoked: true })
    renderWithProviders(<SharePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke this link' }))
    expect(await screen.findByText(/This link is revoked/)).toBeInTheDocument()
    expect(revoke).toHaveBeenCalledWith('share-abcdefgh12')
  })

  it('says an unavailable link is unavailable', async () => {
    vi.spyOn(api, 'fetchShared').mockRejectedValue(new Error('API 404'))
    renderWithProviders(<SharePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('may have expired, been revoked')
  })
})
