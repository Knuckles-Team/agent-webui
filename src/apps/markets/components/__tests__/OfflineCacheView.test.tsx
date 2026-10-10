import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OfflineCacheView } from '../OfflineCacheView'
import type { CachedFact } from '../../offline-cache'

const PRICE_FACT: CachedFact<{ price: number }> = { data: { price: 100 }, cached_at: 1000 }

describe('OfflineCacheView (FUI-12.2)', () => {
  // spec: FUI-12.2
  it('shows previously cached data while offline, marked stale, with current-data actions disabled', () => {
    render(
      <OfflineCacheView
        cached={PRICE_FACT}
        isOnline={false}
        now={2000}
        maxAgeMs={60_000}
        children={(data) => <span data-testid="price">{data.price}</span>}
        disabledFallback={(actionId) => <span>{actionId} unavailable</span>}
      />,
    )
    expect(screen.getByTestId('offline-cache-view')).toHaveAttribute('data-stale', 'true')
    expect(screen.getByTestId('offline-cache-stale-badge')).toBeInTheDocument()
    // The previously valid data still renders.
    expect(screen.getByTestId('price')).toHaveTextContent('100')
    expect(screen.getByText('place_order unavailable')).toBeInTheDocument()
  })

  // spec: FUI-12.2
  it('renders a fresh online cache with no stale badge and no disabled actions', () => {
    render(
      <OfflineCacheView
        cached={PRICE_FACT}
        isOnline={true}
        now={2000}
        maxAgeMs={60_000}
        children={(data) => <span data-testid="price">{data.price}</span>}
        disabledFallback={(actionId) => <span>{actionId} unavailable</span>}
      />,
    )
    expect(screen.getByTestId('offline-cache-view')).toHaveAttribute('data-stale', 'false')
    expect(screen.queryByTestId('offline-cache-stale-badge')).toBeNull()
    expect(screen.queryByTestId('offline-cache-disabled-action')).toBeNull()
  })

  // spec: FUI-12.2
  it('marks an expired cache stale and disables current-data actions even while online', () => {
    render(
      <OfflineCacheView
        cached={PRICE_FACT}
        isOnline={true}
        now={70_000}
        maxAgeMs={60_000}
        children={(data) => <span data-testid="price">{data.price}</span>}
        disabledFallback={(actionId) => <span>{actionId} unavailable</span>}
      />,
    )
    expect(screen.getByTestId('offline-cache-view')).toHaveAttribute('data-stale', 'true')
    expect(screen.getAllByTestId('offline-cache-disabled-action').length).toBeGreaterThan(0)
  })
})
