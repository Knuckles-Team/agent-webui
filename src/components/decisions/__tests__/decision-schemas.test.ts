import { describe, expect, it } from 'vitest'
import { decisionEvalReceiptSchema } from '../decision-schemas'

const receipt = {
  receipt_digest: 'sha256:receipt',
  policy_digest: 'sha256:policy',
  n_records: 100,
  passed: true,
  synthetic: false,
  failed_gates: [],
  metrics: {
    n_items: 100,
    covered: 90,
    coverage_lower: { numerator: 9, denominator: 10 },
    coverage_upper: { numerator: 99, denominator: 100 },
    acted: 80,
    acted_wrong: 2,
    act_risk_upper: { numerator: 1, denominator: 20 },
  },
}

describe('DecisionEval receipt rational boundary', () => {
  it('accepts the EG unit rational limit and refuses impossible coverage or risk bounds', () => {
    expect(decisionEvalReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(
      decisionEvalReceiptSchema.safeParse({
        ...receipt,
        metrics: {
          ...receipt.metrics,
          coverage_lower: { numerator: 1_000_000_000_000, denominator: 1_000_000_000_000 },
        },
      }).success,
    ).toBe(true)
    for (const invalid of [
      { numerator: 11, denominator: 10 },
      { numerator: 1, denominator: 0 },
      { numerator: 1, denominator: 1_000_000_000_001 },
    ]) {
      expect(
        decisionEvalReceiptSchema.safeParse({
          ...receipt,
          metrics: { ...receipt.metrics, act_risk_upper: invalid },
        }).success,
      ).toBe(false)
    }
  })
})
