import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import UsageView from '@/components/views/UsageView'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/__tests__/fixtures'

/**
 * DS-05 rendered-state coverage for the Usage & Cost dashboard's shared
 * `StatusMessage` empty-state adoption (the local `Empty` wrapper). Spies on
 * the real `api` singleton (not a hand-written stand-in) so a renamed/removed
 * method fails the spy setup instead of silently passing.
 */

const EMPTY_SUMMARY = {
  session_count: 0,
  totals: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
  },
  cache_hit_rate: 0,
}

function stubEveryUsageEndpointEmpty() {
  vi.spyOn(api, 'getUsageSummary').mockResolvedValue(EMPTY_SUMMARY)
  vi.spyOn(api, 'getUsageByModel').mockResolvedValue([])
  vi.spyOn(api, 'getUsageByProject').mockResolvedValue([])
  vi.spyOn(api, 'getUsageByAgent').mockResolvedValue([])
  vi.spyOn(api, 'getUsageTools').mockResolvedValue([])
  vi.spyOn(api, 'getUsageActivity').mockResolvedValue([])
  vi.spyOn(api, 'getUsageTopSessions').mockResolvedValue([])
  vi.spyOn(api, 'getUsageTraces').mockResolvedValue({ enabled: false, host: '', traces: [] })
}

beforeEach(() => {
  // useIdentity() hits /auth/session; treat SSO as not configured so the
  // view renders as the default full-access operator without extra mocking.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('not json', { status: 404 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('UsageView — DS-05 status language', () => {
  it('shows the shared empty status message on every tab with no data', async () => {
    stubEveryUsageEndpointEmpty()
    const { user } = renderWithProviders(<UsageView />)

    await waitFor(() => {
      expect(screen.getByText('No data yet.')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: /tools & skills/i }))
    expect(await screen.findByText('No tool calls recorded yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /activity/i }))
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /sessions/i }))
    expect(await screen.findByText('No sessions yet.')).toBeInTheDocument()
  })

  it('shows the shared unavailable notice (not the empty status) when a breakdown fetch fails', async () => {
    stubEveryUsageEndpointEmpty()
    vi.spyOn(api, 'getUsageByModel').mockRejectedValue(new Error('boom'))
    renderWithProviders(<UsageView />)

    expect(await screen.findByText(/This breakdown could not be fetched/)).toBeInTheDocument()
    expect(screen.queryByText('No data yet.')).not.toBeInTheDocument()
  })
})
