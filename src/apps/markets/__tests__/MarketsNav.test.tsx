import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/fixtures'
import * as catalog from '@/lib/apps/catalog'
import * as api from '../api'
import { MarketsNav } from '../components/MarketsNav'
import MarketsCalendar from '../components/MarketsCalendar'
import MarketsMenu from '../components/MarketsMenu'
import MarketsNews from '../components/MarketsNews'
import MarketsPortfolio from '../components/MarketsPortfolio'

function available() {
  vi.spyOn(catalog, 'useAppAvailability').mockReturnValue({
    loading: false,
    available: new Set(['app:markets']),
    reasons: new Map(),
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

describe('Markets five-destination navigation (FUI-01)', () => {
  // spec: FUI-01
  it('marks only the current destination active in both the bottom bar and the side rail', () => {
    visit('/apps/markets/calendar')
    renderWithProviders(<MarketsNav />)
    const navs = screen.getAllByRole('navigation', { name: 'Markets' })
    expect(navs).toHaveLength(2)
    for (const nav of navs) {
      expect(within(nav).getAllByRole('button')).toHaveLength(5)
      expect(within(nav).getByRole('button', { name: /Calendar/ })).toHaveAttribute('aria-current', 'page')
      expect(within(nav).getByRole('button', { name: /^Markets/ })).not.toHaveAttribute('aria-current')
    }
  })

  // spec: FUI-01
  it('moves the active destination when the in-app location changes', () => {
    visit('/apps/markets')
    renderWithProviders(<MarketsNav />)
    expect(screen.getAllByRole('button', { name: /^Markets/ })[0]).toHaveAttribute('aria-current', 'page')

    act(() => {
      visit('/apps/markets/menu')
      window.dispatchEvent(new Event('history-state-changed'))
    })

    expect(screen.getAllByRole('button', { name: /^Menu/ })[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('button', { name: /^Markets/ })[0]).not.toHaveAttribute('aria-current')
  })
})

describe('Markets destination pages (FUI-01)', () => {
  // spec: FUI-01
  it('News states its pending reason rather than an empty feed', () => {
    visit('/apps/markets/news')
    renderWithProviders(<MarketsNews />)
    expect(screen.getByText('News is not available yet.')).toBeInTheDocument()
  })

  it('Portfolio states its pending reason rather than an empty portfolio', () => {
    visit('/apps/markets/portfolio')
    renderWithProviders(<MarketsPortfolio />)
    expect(screen.getByText('Portfolio is not available yet.')).toBeInTheDocument()
  })

  it('Menu shows the Markets notices and a way back to the overview', () => {
    visit('/apps/markets/menu')
    renderWithProviders(<MarketsMenu />)
    expect(screen.getByRole('heading', { name: 'Markets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Markets' })).toBeInTheDocument()
  })

  it('Calendar lists documented macro events with their public source', async () => {
    vi.spyOn(api, 'fetchMacroEvents').mockResolvedValue({
      events: [
        {
          id: 'evt1',
          action: 'rate decision',
          announced_at: '2026-01-05T00:00:00Z',
          title: 'Fed rate decision',
          source_url: 'https://example.com/fed',
        },
      ],
    })
    visit('/apps/markets/calendar')
    renderWithProviders(<MarketsCalendar />)
    expect(await screen.findByText('Fed rate decision')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com/fed')
  })

  it('Calendar states a failed fetch instead of an empty calendar', async () => {
    vi.spyOn(api, 'fetchMacroEvents').mockRejectedValue(new Error('API 503: engine down'))
    visit('/apps/markets/calendar')
    renderWithProviders(<MarketsCalendar />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
  })
})
