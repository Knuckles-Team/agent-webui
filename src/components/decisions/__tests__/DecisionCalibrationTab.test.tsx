import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import DecisionCalibrationTab from '@/components/decisions/DecisionCalibrationTab'
import { renderWithProviders } from '@/__tests__/fixtures'
import { baseAggregate, createFixtureTransport, emptyReceiptPage, emptyTimelinePage } from './decisions-fixtures'

/**
 * DecisionCalibrationTab (requirements WEBUI-DECIDE-R001, DEC-03, DEC-04):
 * the real component against an explicit fixture `DecisionsTransport`.
 */

describe('DecisionCalibrationTab', () => {
  // spec: DEC-03
  it('renders per-option stat tiles, the success rate, and the min-support caption, labeled independently of the unavailable calibration/coverage notice (DEC-03)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    renderWithProviders(<DecisionCalibrationTab transport={transport} />)

    await waitFor(() => {
      expect(transport.getDecisionAggregate).toHaveBeenCalled()
    })
    expect(await screen.findByText('agent:writer')).toBeInTheDocument()
    // successRatePercent(32, 40) === 80
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText(/below 10 trials are withheld/i)).toBeInTheDocument()
    expect(screen.getByText(/a missing row does not mean zero trials/i)).toBeInTheDocument()
    expect(screen.getByText('Outcome aggregate calibration: unavailable')).toBeInTheDocument()
    expect(screen.getByText('Outcome aggregate coverage and act risk: unavailable')).toBeInTheDocument()
    expect(screen.getByText(/bounds for their evaluation set below/i)).toBeInTheDocument()
  })

  // spec: DEC-04
  it('does not interpret an empty aggregate as proof of zero outcomes (DEC-04)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue({ schema_version: 1, min_support: 10, rows: [] })
    renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    expect(await screen.findByText(/no reportable outcome rows in this window/i)).toBeInTheDocument()
    expect(screen.getByText(/data may be absent or withheld below minimum support/i)).toBeInTheDocument()
  })

  it('shows an honest unavailable notice on a failed fetch', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockRejectedValue(new Error('engine down'))
    renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()
  })

  it('re-queries with a new window when a time-window preset is chosen', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    const { user } = renderWithProviders(<DecisionCalibrationTab transport={transport} />)

    await waitFor(() => {
      expect(transport.getDecisionAggregate).toHaveBeenCalled()
    })
    const callsBefore = transport.getDecisionAggregate.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'All time' }))

    await waitFor(() => {
      expect(transport.getDecisionAggregate.mock.calls.length).toBeGreaterThan(callsBefore)
    })
    const lastCall = transport.getDecisionAggregate.mock.calls.at(-1)?.[0] as { fromMs?: number } | undefined
    expect(lastCall?.fromMs).toBe(0)
  })

  // spec: DEC-03
  it('labels policy cohorts independently and warns against comparing changed policies (DEC-03)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue({
      ...baseAggregate,
      rows: [
        { ...baseAggregate.rows[0], policy_digest: 'policy-a-123456789', option_id: 'agent:writer' },
        { ...baseAggregate.rows[0], policy_digest: 'policy-b-123456789', option_id: 'agent:reviewer' },
      ],
    })
    renderWithProviders(<DecisionCalibrationTab transport={transport} />)

    expect(await screen.findByText('agent:reviewer')).toBeInTheDocument()
    expect(screen.getByText('policy-a-123…')).toBeInTheDocument()
    expect(screen.getByText('policy-b-123…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('multiple policy versions')
    expect(screen.getAllByText(/no uncertainty interval or act-risk bound/i)).toHaveLength(2)
  })

  // spec: DEC-04
  it('shows certified bounds only from a passing, non-synthetic receipt and withholds them for a synthetic one (DEC-04)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    transport.getDecisionEvalReceipts.mockResolvedValue({
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
      next_after: null,
    })
    const { user } = renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    expect(transport.getDecisionEvalReceipts).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Load receipts' }))
    expect(await screen.findByText('Passed independent-label evaluation')).toBeInTheDocument()
    expect(screen.getByText('No deployable calibration claim')).toBeInTheDocument()
    expect(screen.getByText('90.0%–99.0%')).toBeInTheDocument()
    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.getByText(/no per-class breakdown/i)).toBeInTheDocument()
    expect(screen.getByText(/includes synthetic data/i)).toBeInTheDocument()
    expect(screen.getAllByText('Coverage interval')).toHaveLength(1)
  })

  // spec: DEC-04
  it('shows server job time and failed gates without inventing a drift alert (DEC-04)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    transport.getDecisionEvalTimeline.mockResolvedValue({
      entries: [
        {
          submitted_at_ms: 1700000000000,
          receipt: {
            receipt_digest: 'sha256:failed',
            policy_digest: 'sha256:policy',
            n_records: 40,
            passed: false,
            synthetic: false,
            failed_gates: ['coverage_floor'],
            metrics: {
              n_items: 40,
              covered: 34,
              coverage_lower: { numerator: 7, denominator: 10 },
              coverage_upper: { numerator: 9, denominator: 10 },
              acted: 30,
              acted_wrong: 4,
              act_risk_upper: { numerator: 2, denominator: 10 },
            },
          },
          threshold_alert: null,
        },
      ],
      next_after: null,
    })
    const { user } = renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    expect(transport.getDecisionEvalTimeline).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Load history' }))
    expect(await screen.findByText(/evaluation job submitted/i)).toBeInTheDocument()
    expect(screen.getByText(/failed gates: coverage_floor/i)).toBeInTheDocument()
    expect(screen.getByText(/policy threshold status unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/statistical drift detection and alert delivery remain unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText('70.0%–90.0%')).not.toBeInTheDocument()
  })

  it('reports only explicit stored policy breaches and withholds low-support claims (DEC-04)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    const receipt = {
      receipt_digest: 'sha256:failed',
      policy_digest: 'sha256:policy',
      n_records: 40,
      passed: false,
      synthetic: false,
      failed_gates: ['coverage_floor'],
      metrics: null,
    }
    const threshold = {
      policy_digest: 'sha256:policy',
      alpha: { numerator: 1, denominator: 10 },
      epsilon: { numerator: 1, denominator: 20 },
      delta: { numerator: 1, denominator: 20 },
      n_min: 30,
      insufficient_support: false,
      coverage_below_policy: true,
      act_risk_above_policy: null,
    }
    transport.getDecisionEvalTimeline.mockResolvedValue({
      entries: [
        { submitted_at_ms: 1700000000000, receipt, threshold_alert: threshold },
        {
          submitted_at_ms: 1700000000001,
          receipt: { ...receipt, receipt_digest: 'sha256:low' },
          threshold_alert: { ...threshold, insufficient_support: true, coverage_below_policy: null },
        },
        {
          submitted_at_ms: 1700000000002,
          receipt: { ...receipt, receipt_digest: 'sha256:synthetic', synthetic: true },
          threshold_alert: threshold,
        },
      ],
      next_after: null,
    })
    const { user } = renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    await user.click(screen.getByRole('button', { name: 'Load history' }))
    expect(await screen.findByText(/policy threshold breached: coverage below policy target/i)).toBeInTheDocument()
    expect(screen.getByText(/insufficient labeled support \(minimum 30\); no threshold claim/i)).toBeInTheDocument()
    expect(screen.getByText(/synthetic evaluation; production threshold status unavailable/i)).toBeInTheDocument()
    expect(screen.getAllByText(/policy threshold breached: coverage below policy target/i)).toHaveLength(1)
    expect(screen.queryByText(/statistical drift detected/i)).not.toBeInTheDocument()
  })

  // spec: DEC-06
  it('every status-bearing control is reachable by keyboard and carries text, not color alone (DEC-06)', async () => {
    const transport = createFixtureTransport()
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    transport.getDecisionEvalReceipts.mockResolvedValue(emptyReceiptPage)
    transport.getDecisionEvalTimeline.mockResolvedValue(emptyTimelinePage)
    const { user } = renderWithProviders(<DecisionCalibrationTab transport={transport} />)
    await waitFor(() => {
      expect(transport.getDecisionAggregate).toHaveBeenCalled()
    })

    const windowGroup = screen.getByRole('group', { name: 'Time window' })
    const allTimeButton = within(windowGroup).getByRole('button', { name: 'All time' })
    allTimeButton.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(transport.getDecisionAggregate.mock.calls.length).toBeGreaterThan(1)
    })

    const loadReceiptsButton = screen.getByRole('button', { name: 'Load receipts' })
    loadReceiptsButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/no evaluation receipts are available/i)).toBeInTheDocument()
  })
})
