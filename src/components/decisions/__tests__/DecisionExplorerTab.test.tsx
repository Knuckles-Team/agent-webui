import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import DecisionExplorerTab from '@/components/decisions/DecisionExplorerTab'
import * as decisionsApi from '@/lib/decisions-api'
import type { DecisionListRow, DecisionProvenance, DecisionRecord } from '@/components/decisions/decision-schemas'
import { renderWithProviders } from '@/__tests__/fixtures'

/**
 * DecisionExplorerTab (EH-046): drives the REAL component against the REAL
 * `decisions-api` module (spied, not replaced) so a renamed/missing client
 * method fails the test instead of hiding behind a hand-written fake —
 * the same discipline `ObjectExplorerView.test.tsx` documents.
 */

const baseRow: DecisionListRow = {
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

const baseRecord: DecisionRecord = {
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

const emptyProvenance: DecisionProvenance = { evaluations: [], resolutions: [] }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DecisionExplorerTab', () => {
  it('lists decisions and shows a placeholder until one is selected', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisions').mockResolvedValue([baseRow])
    renderWithProviders(<DecisionExplorerTab />)

    await waitFor(() => {
      expect(decisionsApi.fetchDecisions).toHaveBeenCalled()
    })
    expect(await screen.findByText(/decision:abc123/i)).toBeInTheDocument()
    expect(screen.getByText(/select a decision/i)).toBeInTheDocument()
  })

  it('shows the empty state on a genuine zero-row result', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisions').mockResolvedValue([])
    renderWithProviders(<DecisionExplorerTab />)
    expect(await screen.findByText(/no decisions recorded yet/i)).toBeInTheDocument()
  })

  it('shows an honest unavailable notice on a failed fetch, never an empty list', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisions').mockRejectedValue(new Error('network down'))
    renderWithProviders(<DecisionExplorerTab />)
    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()
    expect(screen.queryByText(/no decisions recorded yet/i)).not.toBeInTheDocument()
  })

  it('selecting a row loads and renders its premises, outcome, and why-not', async () => {
    vi.spyOn(decisionsApi, 'fetchDecisions').mockResolvedValue([baseRow])
    vi.spyOn(decisionsApi, 'fetchDecision').mockResolvedValue(baseRecord)
    vi.spyOn(decisionsApi, 'fetchDecisionProvenance').mockResolvedValue(emptyProvenance)
    const { user } = renderWithProviders(<DecisionExplorerTab />)

    const row = await screen.findByRole('button', { name: /decision:abc123/i })
    await user.click(row)

    await waitFor(() => {
      expect(decisionsApi.fetchDecision).toHaveBeenCalledWith('decision:abc123')
    })
    const detail = await screen.findByText('Decision')
    const card = detail.closest('[class*="rounded"]')?.parentElement ?? document.body
    expect(within(card as HTMLElement).getByText('agent:writer')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByText(/graph-digest-1/i)).toBeInTheDocument()
    // "Retired" appears twice on purpose: once under Eliminated candidates,
    // once under Why not — both sections render the same violation tag.
    expect(within(card as HTMLElement).getAllByText(/retired/i).length).toBeGreaterThanOrEqual(2)
  })
})
