import { vi, type Mock } from 'vitest'
import type { DecisionsTransport } from '../decisions-transport'
import type {
  DecisionAggregate,
  DecisionEvalReceiptPage,
  DecisionEvalTimelinePage,
  DecisionListRow,
  DecisionProvenance,
  DecisionRecord,
} from '../decision-schemas'

/**
 * @file decisions-fixtures.ts
 * @description Synthetic fixtures and a mock `DecisionsTransport` for the
 * decision-evidence component tests. Every test drives the real components
 * against this explicit fixture transport (never a module-level spy, since
 * there is no production api module to spy on — see `decisions-transport.ts`'s
 * file doc), so a renamed/removed transport method fails the test at the
 * type level instead of hiding behind a hand-written fake.
 */

/** A `DecisionsTransport` whose methods are `vi.fn()`s a test configures per case. */
export function createFixtureTransport(): { [K in keyof DecisionsTransport]: Mock<DecisionsTransport[K]> } {
  return {
    listDecisions: vi.fn<DecisionsTransport['listDecisions']>(),
    getDecision: vi.fn<DecisionsTransport['getDecision']>(),
    getDecisionProvenance: vi.fn<DecisionsTransport['getDecisionProvenance']>(),
    getDecisionAggregate: vi.fn<DecisionsTransport['getDecisionAggregate']>(),
    getDecisionEvalReceipts: vi.fn<DecisionsTransport['getDecisionEvalReceipts']>(),
    getDecisionEvalTimeline: vi.fn<DecisionsTransport['getDecisionEvalTimeline']>(),
    getWhyNotOnDemand: vi.fn<DecisionsTransport['getWhyNotOnDemand']>(),
  }
}

export const baseRow: DecisionListRow = {
  record_id: 'decision:abc123',
  question_id: 'assemble',
  question_kind: null,
  safety: null,
  source: 'agent_library',
  outcome: 'solved',
  option_id: null,
  resolution_kind: 'optimization',
  evidence_class: 'claim',
  policy_digest: null,
  committed_by: null,
  created_at_ms: 1_700_000_000_000,
  committed_at_ms: 1_700_000_000_500,
}

export const baseRecord: DecisionRecord = {
  schema_version: 1,
  record_id: 'decision:abc123',
  tenant_id: 'tenant-a',
  caller_principal: 'principal:writer-1',
  created_at_ms: 1_700_000_000_000,
  question: 'assemble',
  candidate_source: { source: 'agent_library', kinds: ['AGENT_SKILL'] },
  inputs: { policy_digest: 'pol-1', catalog_digest: 'cat-1', ontology_digest: 'ont-1' },
  inputs_digest: 'digest-inputs',
  resolution_kind: 'optimization',
  evidence_class: 'claim',
  derivation_class: 'proof',
  trace_fidelity: { fidelity: 'full_step' },
  premises: [
    {
      subject: 'agent:writer',
      fact: 'classification',
      class: 'claim',
      provenance: { provenance: 'publisher', component_id: 'agent:writer' },
    },
  ],
  eliminated: [{ component_id: 'agent:reviewer', violation: { violation: 'retired' } }],
  derivations: [{ required: 'task:write', covered_by: 'agent:writer', chain: [] }],
  outcome: {
    outcome: 'solved',
    graph_digest: 'graph-digest-1',
    slots: [{ slot: 'writer', component: { component_id: 'agent:writer' } }],
    certificate: { status: 'optimal', nodes_expanded: 12 },
  },
  why_not: [{ component_id: 'agent:reviewer', slot: 'writer', violation: { violation: 'retired' } }],
  record_digest: 'digest-record',
}

export const emptyProvenance: DecisionProvenance = { evaluations: [], resolutions: [] }

export const baseAggregate: DecisionAggregate = {
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

export const emptyReceiptPage: DecisionEvalReceiptPage = { receipts: [], next_after: null }
export const emptyTimelinePage: DecisionEvalTimelinePage = { entries: [], next_after: null }
