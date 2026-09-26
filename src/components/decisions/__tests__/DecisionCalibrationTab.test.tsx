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
    expect(screen.getByText(/a missing row does not mean zero trials/i)).toBeInTheDocument()
    expect(screen.getByText('Calibration: unavailable')).toBeInTheDocument()
    expect(screen.getByText('Coverage and act risk: unavailable')).toBeInTheDocument()
    expect(screen.getByText(/per-class sample sufficiency and intervals/i)).toBeInTheDocument()
  })

  it('does not interpret an empty aggregate as proof of zero outcomes', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue({
      schema_version: 1,
      min_support: 10,
      rows: [],
    })
    renderWithProviders(<DecisionCalibrationTab />)
    expect(await screen.findByText(/no reportable outcome rows in this window/i)).toBeInTheDocument()
    expect(screen.getByText(/data may be absent or withheld below minimum support/i)).toBeInTheDocument()
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

  it('labels policy cohorts and warns against comparing changed policies', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue({
      ...baseAggregate,
      rows: [
        { ...baseAggregate.rows[0], policy_digest: 'policy-a-123456789', option_id: 'agent:writer' },
        { ...baseAggregate.rows[0], policy_digest: 'policy-b-123456789', option_id: 'agent:reviewer' },
      ],
    })
    renderWithProviders(<DecisionCalibrationTab />)

    expect(await screen.findByText('agent:reviewer')).toBeInTheDocument()
    expect(screen.getByText('policy-a-123…')).toBeInTheDocument()
    expect(screen.getByText('policy-b-123…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('multiple policy versions')
    expect(screen.getAllByText(/no uncertainty interval or act-risk bound/i)).toHaveLength(2)
  })

  it('shows certified bounds only from a passing real full-label receipt', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisionAggregate').mockResolvedValue(baseAggregate)
    const receipts = vi.spyOn(decisionsApi, 'fetchDecisionEvalReceipts').mockResolvedValue({
      receipts: [
        {
          receipt_digest: 'sha256:real',
          policy_digest: 'sha256:policy',
          n_records: 40,
          passed: true,
          synthetic: false,
          failed_gates: [],
          metrics: {
            n_items: 40,
            covered: 38,
            coverage_lower: { numerator: 9, denominator: 10 },
            coverage_upper: { numerator: 99, denominator: 100 },
            acted: 30,
            acted_wrong: 1,
            act_risk_upper: { numerator: 1, denominator: 10 },
          },
        },
        {
          receipt_digest: 'sha256:synthetic',
          policy_digest: 'sha256:policy',
          n_records: 40,
          passed: true,
          synthetic: true,
          failed_gates: [],
          metrics: {
            n_items: 40,
            covered: 38,
            coverage_lower: { numerator: 9, denominator: 10 },
            coverage_upper: { numerator: 99, denominator: 100 },
            acted: 30,
            acted_wrong: 1,
            act_risk_upper: { numerator: 1, denominator: 10 },
          },
        },
      ],
    })
    const { user } = renderWithProviders(<DecisionCalibrationTab />)
    expect(receipts).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Load receipts' }))
    expect(await screen.findByText('Passed independent-label evaluation')).toBeInTheDocument()
    expect(screen.getByText('90.0%–99.0%')).toBeInTheDocument()
    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.getByText(/includes synthetic data/i)).toBeInTheDocument()
    expect(screen.getAllByText('Coverage interval')).toHaveLength(1)
  })
})
