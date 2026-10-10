import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstrumentRow } from '../components/InstrumentRow'
import type { Quote } from '../quote'

const NOW = Date.UTC(2026, 0, 31, 16, 0, 0)
const BASE: Quote = {
  listingId: 'listing:nasdaq:ACME:equity',
  symbol: 'ACME',
  price: 101.23,
  previousClose: 100,
  change: 1.23,
  changePct: 1.23,
  session: 'regular',
  source: 'nasdaq-last-sale',
  asOf: NOW - 60_000,
  delaySeconds: null,
  sparkline: [98, 99, 100.5, 101.23],
  logoUrl: 'https://logos.example/acme.svg',
  afterHours: null,
}

function fixture(overrides: Partial<Quote>): Quote {
  return { ...BASE, ...overrides }
}

describe('InstrumentRow', () => {
  it('renders a regular-session quote with licensed logo, prev close and change', () => {
    const { container } = render(<InstrumentRow quote={fixture({})} now={NOW} />)
    expect(screen.getByText('Regular')).toBeInTheDocument()
    expect(screen.getByText('· nasdaq-last-sale')).toBeInTheDocument()
    expect(screen.getByText('101.23')).toBeInTheDocument()
    expect(container.textContent).toContain('Prev close 100.00 · as of 1m ago')
    expect(container.textContent).toContain('+1.23 (+1.2%)')
    const logo = screen.getByRole('img')
    expect(logo).toHaveAttribute('src', BASE.logoUrl)
  })

  it('renders an unlicensed instrument with a text fallback instead of a logo', () => {
    render(<InstrumentRow quote={fixture({ logoUrl: null })} now={NOW} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('AC')).toBeInTheDocument()
  })

  // spec: FUI-04
  it('labels a pre-market quote and keeps the after-hours value separate', () => {
    const { container } = render(
      <InstrumentRow
        quote={fixture({
          session: 'pre',
          price: 102.5,
          change: 2.5,
          changePct: 2.5,
          afterHours: { price: 99.9, change: -0.1, changePct: -0.1, asOf: NOW },
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('Pre-market')).toBeInTheDocument()
    expect(container.textContent).toContain('After hours 99.90 (-0.1%)')
    // the regular session price and the after-hours price are both present and distinct
    expect(container.textContent).toContain('102.50')
    expect(container.textContent).toContain('99.90')
  })

  it('labels a post-market quote distinctly from regular and pre-market', () => {
    render(<InstrumentRow quote={fixture({ session: 'post' })} now={NOW} />)
    expect(screen.getByText('Post-market')).toBeInTheDocument()
    expect(screen.queryByText('Regular')).not.toBeInTheDocument()
    expect(screen.queryByText('Pre-market')).not.toBeInTheDocument()
  })

  it('shows a delayed quote with its delay, separate from the session', () => {
    render(<InstrumentRow quote={fixture({ delaySeconds: 900 })} now={NOW} />)
    expect(screen.getByText('Delayed 900s')).toBeInTheDocument()
    expect(screen.getByText('Regular')).toBeInTheDocument()
  })

  it('never shows a missing price as zero', () => {
    const { container } = render(
      <InstrumentRow
        quote={fixture({
          price: null,
          change: null,
          changePct: null,
          previousClose: null,
          asOf: null,
          sparkline: [],
          afterHours: null,
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('Price unavailable')).toBeInTheDocument()
    expect(container.textContent).not.toContain('0.00')
    expect(container.textContent).not.toContain('>0<')
    expect(container.textContent).toContain('Prev close — · as of — ago')
  })
})
