import { test, expect } from '@playwright/test'

/**
 * DecisionsView E2E (EH-046/047): a real signed-in session (this suite's
 * standard `setup` project auth, `e2e/auth.setup.ts`) driving the real app,
 * against a STUBBED `/api/enhanced/decisions*` backend
 * (`page.route`) rather than a live engine — the decide-consumers lane's
 * `epistemic_graph.decision_client` and the EG `decide` surface it needs
 * land in this same train and are not yet installed anywhere this suite
 * could reach, so a stub is the only way to exercise the real frontend
 * end-to-end today. Every response shape here mirrors
 * `agent/graph_os_webui/api_extensions.py`'s Decisions section exactly (see
 * that file's own docstrings and `test_decision_endpoints.py`'s fixtures).
 */

const listResponse = [
  {
    record_id: 'decision:e2e-abc123',
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
  },
]

const recordResponse = {
  schema_version: 1,
  record_id: 'decision:e2e-abc123',
  tenant_id: 'tenant-e2e',
  caller_principal: 'principal:e2e-writer',
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
  eliminated: [],
  derivations: [{ required: 'task:write', covered_by: 'agent:writer', chain: [] }],
  outcome: {
    outcome: 'solved',
    graph_digest: 'graph-digest-e2e',
    slots: [{ slot: 'writer', component: { component_id: 'agent:writer' } }],
    certificate: { status: 'optimal', nodes_expanded: 12 },
  },
  why_not: [],
  record_digest: 'digest-record-e2e',
}

const provenanceResponse = { evaluations: [], resolutions: [] }

const aggregateResponse = {
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

/**
 * Playwright matches the MOST RECENTLY registered pattern first, so the two
 * patterns that can both match the exact same URL (`/decisions/aggregate`
 * matches both the single-record glob `decisions/*` and the aggregate glob)
 * must be registered least-specific-first, most-specific-last. `*` (not a
 * literal `?`) is what makes a glob match an optional query string here —
 * Playwright's glob `?` means "any one character", not "a literal `?`".
 */
async function stubDecisionsApi(page: import('@playwright/test').Page) {
  await page.route('**/api/enhanced/decisions*', async (route) => {
    await route.fulfill({ json: listResponse })
  })
  await page.route('**/api/enhanced/decisions/*', async (route) => {
    await route.fulfill({ json: recordResponse })
  })
  await page.route('**/api/enhanced/decisions/*/provenance', async (route) => {
    await route.fulfill({ json: provenanceResponse })
  })
  await page.route('**/api/enhanced/decisions/aggregate**', async (route) => {
    await route.fulfill({ json: aggregateResponse })
  })
}

test.describe('DecisionsView E2E (stubbed API)', () => {
  test.beforeEach(async ({ page }) => {
    await stubDecisionsApi(page)
    await page.goto('/decisions')
    await page.waitForLoadState('networkidle')
  })

  test('lists a decision from the stub and shows the explorer placeholder', async () => {
    await expect.poll(async () => (await page.title()) !== '').toBeTruthy()
    await expect(page.getByText('decision:e2e-abc123')).toBeVisible()
    await expect(page.getByText(/select a decision/i)).toBeVisible()
  })

  test('selecting a decision renders its premises and solved certificate', async ({ page }) => {
    await page.getByRole('button', { name: /decision:e2e-abc123/i }).click()
    await expect(page.getByText('agent:writer').first()).toBeVisible()
    await expect(page.getByText(/graph-digest-e2e/i)).toBeVisible()
  })

  test('the calibration tab renders the stubbed aggregate', async ({ page }) => {
    await page.getByRole('tab', { name: 'Calibration' }).click()
    await expect(page.getByText('agent:writer')).toBeVisible()
    await expect(page.getByText('80%')).toBeVisible()
  })
})
