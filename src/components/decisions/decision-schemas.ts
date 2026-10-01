import { z } from 'zod'

/**
 * @file decision-schemas.ts
 * @description Runtime shapes for the engine's committed decision-record log
 * (see `specs/decision-evidence/plan.md` for the data and interaction
 * contract these mirror). These schemas describe the conceptual read
 * contract the decision explorer and calibration dashboard render; a typed
 * Graph OS client is expected to supersede ad hoc validation here once it
 * lands on this repository (see `decisions-transport.ts`'s file doc).
 *
 * The wire shape mirrors the engine's serde encoding (snake_case fields,
 * adjacently-tagged discriminated unions for `class`/`violation`/
 * `provenance`/`outcome`/`reason`/`resolver`/`fidelity` — each carries its
 * own tag field by that same name). Nested union payloads whose full field
 * set this UI does not need to branch on (`provenance`, `violation`,
 * `certificate`, `inputs`, `source`) are validated only as an open record
 * and rendered generically via `tagOf`/`rawEntries` below — the record's
 * exact shape is the engine's contract to keep, not this view's to
 * re-derive field by field.
 */

const openRecord = z.record(z.string(), z.unknown())

/** One decision-log list row — the explorer's list. */
export const decisionListRowSchema = z.object({
  record_id: z.string().min(1),
  question_id: z.string().nullable().optional(),
  question_kind: z.string().nullable().optional(),
  safety: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  option_id: z.string().nullable().optional(),
  resolution_kind: z.string().nullable().optional(),
  evidence_class: z.string().nullable().optional(),
  policy_digest: z.string().nullable().optional(),
  committed_by: z.string().nullable().optional(),
  created_at_ms: z.number().nullable().optional(),
  committed_at_ms: z.number().nullable().optional(),
})
export type DecisionListRow = z.infer<typeof decisionListRowSchema>

/** One premise reference (the premise/class/provenance triad). */
export const premiseRefSchema = z.object({
  subject: z.string(),
  fact: z.string(),
  class: z.string(),
  provenance: openRecord,
})
export type PremiseRef = z.infer<typeof premiseRefSchema>

/** One eliminated candidate and the violation that removed it. */
export const eliminationSchema = z.object({
  component_id: z.string(),
  violation: openRecord,
})
export type Elimination = z.infer<typeof eliminationSchema>

const derivationEdgeSchema = z.object({
  narrower: z.string(),
  broader: z.string(),
  source: openRecord,
  class: z.string(),
})

/** How one required capability was covered (an `is_a` chain). */
export const coverageDerivationSchema = z.object({
  required: z.string(),
  covered_by: z.string().nullable().optional(),
  chain: z.array(derivationEdgeSchema),
})
export type CoverageDerivation = z.infer<typeof coverageDerivationSchema>

/** Why one candidate lost its slot — bounded, cited from the committed record. */
export const whyNotSchema = z.object({
  component_id: z.string(),
  slot: z.string(),
  forced_objective: z.unknown().nullable().optional(),
  violation: openRecord.nullable().optional(),
})
export type WhyNot = z.infer<typeof whyNotSchema>

const slotAssignmentSchema = z.object({
  slot: z.string(),
  component: openRecord,
})
export type SlotAssignment = z.infer<typeof slotAssignmentSchema>

/** The decision outcome: `Solved { graph_digest, slots, certificate }` or
 * `Abstained { reasons }`, discriminated by its own `outcome` tag field. */
export const decisionOutcomeSchema = z.object({
  outcome: z.string(),
  graph_digest: z.string().optional(),
  slots: z.array(slotAssignmentSchema).optional(),
  certificate: openRecord.optional(),
  reasons: z.array(openRecord).optional(),
})
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>

/** One committed decision record in full. */
export const decisionRecordSchema = z.object({
  schema_version: z.number(),
  record_id: z.string(),
  tenant_id: z.string(),
  caller_principal: z.string(),
  created_at_ms: z.number(),
  question: z.string(),
  candidate_source: openRecord,
  inputs: openRecord,
  inputs_digest: z.string(),
  resolution_kind: z.string(),
  evidence_class: z.string(),
  derivation_class: z.string(),
  trace_fidelity: openRecord,
  premises: z.array(premiseRefSchema),
  eliminated: z.array(eliminationSchema),
  derivations: z.array(coverageDerivationSchema),
  outcome: decisionOutcomeSchema,
  why_not: z.array(whyNotSchema),
  record_digest: z.string(),
})
export type DecisionRecord = z.infer<typeof decisionRecordSchema>

const provenanceRowSchema = z.object({
  evaluation_id: z.string().nullable().optional(),
  resolution_id: z.string().nullable().optional(),
  option_id: z.string().nullable().optional(),
  resolver: z.string().nullable().optional(),
  class: z.string().nullable().optional(),
  fidelity: z.string().nullable().optional(),
  producer: z.string().nullable().optional(),
  success: z.boolean().nullable().optional(),
  recorded_at_ms: z.number().nullable().optional(),
})
export type ProvenanceRow = z.infer<typeof provenanceRowSchema>

/** Every independent evaluation and abstention resolution logged against one record. */
export const decisionProvenanceSchema = z.object({
  evaluations: z.array(provenanceRowSchema),
  resolutions: z.array(provenanceRowSchema),
})
export type DecisionProvenance = z.infer<typeof decisionProvenanceSchema>

const fidelityCountsSchema = z.object({
  full_step: z.number(),
  tool_calls: z.number(),
  final_output: z.number(),
  censored: z.number(),
})
export type FidelityCounts = z.infer<typeof fidelityCountsSchema>

const optionAggregateSchema = z.object({
  option_id: z.string(),
  question_id: z.string().nullable().optional(),
  policy_digest: z.string().nullable().optional(),
  trials: z.number(),
  successes: z.number(),
  refused: z.number(),
  by_fidelity: fidelityCountsSchema,
  pooled_rate: z.unknown().nullable().optional(),
})
export type OptionAggregate = z.infer<typeof optionAggregateSchema>

/** The outcome aggregate — observed trials/successes per option, never a
 * calibrated claim on its own (see `decisionEvalReceiptSchema` for that). */
export const decisionAggregateSchema = z.object({
  schema_version: z.number(),
  min_support: z.number(),
  rows: z.array(optionAggregateSchema),
})
export type DecisionAggregate = z.infer<typeof decisionAggregateSchema>

/** Independently labeled full-label evaluation receipt, distinct from the
 * observational decision-log aggregate above. The engine owns every interval
 * and every withholding decision; this UI invents none of it. */
const unitRationalSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().positive(),
})

export const decisionEvalReceiptSchema = z.object({
  receipt_digest: z.string(),
  policy_digest: z.string(),
  n_records: z.number().int().nonnegative(),
  passed: z.boolean(),
  synthetic: z.boolean(),
  failed_gates: z.array(z.string()),
  metrics: z
    .object({
      n_items: z.number().int().nonnegative(),
      covered: z.number().int().nonnegative(),
      coverage_lower: unitRationalSchema,
      coverage_upper: unitRationalSchema,
      acted: z.number().int().nonnegative(),
      acted_wrong: z.number().int().nonnegative(),
      act_risk_upper: unitRationalSchema,
    })
    .nullable()
    .optional(),
})
export type DecisionEvalReceipt = z.infer<typeof decisionEvalReceiptSchema>

export const decisionEvalReceiptPageSchema = z.object({
  receipts: z.array(decisionEvalReceiptSchema),
  next_after: z.string().nullable().optional(),
})
export type DecisionEvalReceiptPage = z.infer<typeof decisionEvalReceiptPageSchema>

/** Server-submission-time ordered full-label receipts. Legacy receipts remain
 * on the digest read and never receive a fabricated timestamp. */
export const decisionEvalTimelinePageSchema = z.object({
  entries: z.array(
    z.object({
      submitted_at_ms: z.number().int().nonnegative(),
      receipt: decisionEvalReceiptSchema,
      threshold_alert: z
        .object({
          policy_digest: z.string(),
          alpha: unitRationalSchema,
          epsilon: unitRationalSchema,
          delta: unitRationalSchema,
          n_min: z.number().int().nonnegative(),
          insufficient_support: z.boolean(),
          coverage_below_policy: z.boolean().nullable().optional(),
          act_risk_above_policy: z.boolean().nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  ),
  next_after: z.string().nullable().optional(),
})
export type DecisionEvalTimelinePage = z.infer<typeof decisionEvalTimelinePageSchema>

/** The discriminant tag of an adjacently-tagged union payload validated only
 * as an open record (e.g. `{"violation": "denied"}`), or `null` when this
 * particular value carries none under that key. */
export function tagOf(value: Record<string, unknown> | null | undefined, tag: string): string | null {
  const found = value?.[tag]
  return typeof found === 'string' ? found : null
}

/** `Object.entries`, minus the tag key itself, sorted for stable rendering —
 * the generic fallback for an open record's non-tag fields. */
export function rawEntries(value: Record<string, unknown> | null | undefined, tag: string): [string, unknown][] {
  if (!value) return []
  return Object.entries(value)
    .filter(([key]) => key !== tag)
    .sort(([a], [b]) => a.localeCompare(b))
}
