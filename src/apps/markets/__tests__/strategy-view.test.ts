import { describe, expect, it } from 'vitest'
import { recommendationView, STRATEGY_VIEW_HAS_NO_ORDER_FIELD, type StrategyRecommendation } from '../strategy-view'

const CALIBRATED: StrategyRecommendation = {
  evidence: [{ scorecard_version: '7', record_ref: 'scorecard:abc' }],
  abstain_reason: null,
}

describe('strategy-view (FUI-09.1)', () => {
  it('shows a calibrated proposal with its cited evidence', () => {
    expect(recommendationView(CALIBRATED)).toEqual({ kind: 'proposal', evidence: CALIBRATED.evidence })
  })

  it('abstains with a reason for thin history', () => {
    expect(recommendationView({ evidence: [], abstain_reason: 'thin_history' })).toEqual({
      kind: 'abstain',
      reason: 'thin_history',
    })
  })

  it('abstains with a reason for warmup', () => {
    expect(recommendationView({ evidence: CALIBRATED.evidence, abstain_reason: 'warmup' })).toEqual({
      kind: 'abstain',
      reason: 'warmup',
    })
  })

  it('abstains with a reason for drift', () => {
    expect(recommendationView({ evidence: CALIBRATED.evidence, abstain_reason: 'drift' })).toEqual({
      kind: 'abstain',
      reason: 'drift',
    })
  })

  it('abstains for a missing scorecard even without an explicit reason', () => {
    expect(recommendationView({ evidence: [], abstain_reason: null })).toEqual({
      kind: 'abstain',
      reason: 'missing_scorecard',
    })
  })

  it('carries no field an order-submission call could read', () => {
    expect(STRATEGY_VIEW_HAS_NO_ORDER_FIELD).toBe(true)
    expect(Object.keys(recommendationView(CALIBRATED))).not.toContain('order')
  })
})
