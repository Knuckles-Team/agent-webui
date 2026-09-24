import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import DecisionCalibrationTab from '@/components/decisions/DecisionCalibrationTab'
import * as decisionsApi from '@/lib/decisions-api'
import type { DecisionAggregate } from '@/components/decisions/decision-schemas'
import { renderWithProviders } from '@/__tests__/fixtures'

/**
 * DecisionCalibrationTab (EH-047): drives the REAL component against the
 * REAL `decisions-api` module (spied, not replaced) — see
 * DecisionExplorerTab.test.tsx's docstring for why.
 */

const baseAggregate: DecisionAggregate = {
  schema_version: 1,
  min_support: 10,
  rows: [
    {
      option_id: 'agent:writer',
      question_id: 'assemble',
      policy_digest: null,
      trials: 40,
      successes: 32,
      refused: 2,
      by_fidelity: { full_step: 30, tool_calls: 8, final_output: 2, censored: 0 },
      pooled_rate: null,
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DecisionCalibrationTab', () => {
  it('renders per-option stat tiles, the success rate, and the min-support caption', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue(baseAggregate)
    renderWithProviders(<DecisionCalibrationTab />)

    await waitFor(() => {
      expect(decisionsApi.fetchDecisionAggregate).toHaveBeenCalled()
    })
    expect(await screen.findByText('agent:writer')).toBeInTheDocument()
    // successRatePercent(32, 40) === 80
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText(/below 10 trials are withheld/i)).toBeInTheDocument()
  })

  it('shows the genuine empty-window state distinctly from an unavailable aggregate', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue({
      schema_version: 1,
      min_support: 10,
      rows: [],
    })
    renderWithProviders(<DecisionCalibrationTab />)
    expect(await screen.findByText(/no outcome data in this window/i)).toBeInTheDocument()
  })

  it('shows an honest unavailable notice on a failed fetch', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockRejectedValue(new Error('engine down'))
    renderWithProviders(<DecisionCalibrationTab />)
    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()
  })

  it('re-queries with a new window when a time-window preset is chosen', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue(baseAggregate)
    const { user } = renderWithProviders(<DecisionCalibrationTab />)

    await waitFor(() => {
      expect(decisionsApi.fetchDecisionAggregate).toHaveBeenCalled()
    })
    const callsBefore = vi.mocked(decisionsApi.fetchDecisionAggregate).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'All time' }))

    await waitFor(() => {
      expect(vi.mocked(decisionsApi.fetchDecisionAggregate).mock.calls.length).toBeGreaterThan(callsBefore)
    })
    const lastCall = vi.mocked(decisionsApi.fetchDecisionAggregate).mock.calls.at(-1)?.[0]
    expect(lastCall?.fromMs).toBe(0)
  })
})
