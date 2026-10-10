import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StrategyPanel } from '../StrategyPanel'
import type { StrategyRecommendation } from '../../strategy-view'

const CALIBRATED_PROPOSAL: StrategyRecommendation = {
  evidence: [{ scorecard_version: '7', record_ref: 'scorecard://trend-flip/2026-10-01' }],
  abstain_reason: null,
}

const THIN_HISTORY: StrategyRecommendation = { evidence: [], abstain_reason: 'thin_history' }
const WARMUP: StrategyRecommendation = { evidence: [], abstain_reason: 'warmup' }
const DRIFT: StrategyRecommendation = { evidence: [], abstain_reason: 'drift' }
const MISSING_SCORECARD: StrategyRecommendation = { evidence: [], abstain_reason: 'missing_scorecard' }

describe('StrategyPanel (FUI-09.2)', () => {
  // spec: FUI-09.2
  it('shows the cited evidence for a calibrated proposal and submits no order from the panel', () => {
    render(<StrategyPanel recommendation={CALIBRATED_PROPOSAL} />)
    expect(screen.getByTestId('strategy-panel')).toHaveAttribute('data-state', 'proposal')
    expect(screen.getByText(/scorecard v7/)).toBeInTheDocument()
    // No order-submission path exists in the rendered UI: no buttons at all.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  // spec: FUI-09.2
  it.each([
    [THIN_HISTORY, 'Not enough price history to recommend yet'],
    [WARMUP, 'Strategy is still warming up'],
    [DRIFT, 'Strategy has drifted outside its calibrated range'],
    [MISSING_SCORECARD, 'No scorecard is available for this strategy'],
  ])('shows the abstention reason instead of a proposal, and submits no order', (recommendation, label) => {
    render(<StrategyPanel recommendation={recommendation} />)
    expect(screen.getByTestId('strategy-panel')).toHaveAttribute('data-state', 'abstain')
    expect(screen.getByTestId('strategy-panel-abstain-reason')).toHaveTextContent(label)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
