import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { toast } from 'sonner'
import EcosystemView from '@/components/views/EcosystemView'

// No `<Toaster />` is mounted by `render(<EcosystemView />)` alone, so a real
// `sonner` toast call renders no DOM text for a query to find -- mock the
// module so the "action failure feedback" suite below can assert on what
// EcosystemView actually told the toast library, not on rendered markup
// this test harness has no way to see.
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

/**
 * BUG-008 (GOC-28) proof: with every backend unreachable, the Ecosystem UI
 * must show an explicit unavailable/error state and never render numeric
 * telemetry, a fabricated success toast, or an invented queue/job row. This
 * is the DOM-level companion to `scripts/no_fabrication_gate.mjs`'s static
 * scan -- the gate proves the *source* has no fabrication pattern; this
 * suite proves the *rendered UI* behaves honestly when every request fails.
 *
 * All fixed numeric fallbacks this view used to render (24.5, 42.1, 6.7,
 * 16.0, 68.3, 341.5, 500.0, 450, 980, ...) are asserted absent by text
 * query -- if a regression reintroduces one of the removed hardcoded
 * fallbacks, these assertions catch it even though the gate's regex rules
 * would also (its `metric-fallback` rule targets the source pattern
 * directly; this asserts the user-visible symptom).
 */

function rejectingFetch() {
  return vi.fn(() => Promise.reject(new Error('network unreachable'))) as unknown as typeof fetch
}

function errorEnvelopeFetch() {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: 'error', detail: 'upstream unreachable' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch
}

function serverErrorFetch() {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: 'System resource metrics unavailable (psutil): OSError' }), {
        status: 503,
      }),
    ),
  ) as unknown as typeof fetch
}

// Numbers this view used to hardcode as fallbacks (BUG-008). None of these
// must ever appear as rendered telemetry once the backend is unreachable.
const REMOVED_FABRICATED_VALUES = ['24.5%', '42.1%', '68.3%', '6.7 GB', '16 GB', '341.5 GB', '500 GB']

describe('EcosystemView (BUG-008 truthful-state proof)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows an explicit unavailable/error state for system telemetry when the backend is unreachable, never a fabricated number', async () => {
    global.fetch = rejectingFetch()
    render(<EcosystemView />)

    // Research domain hosts the CPU/RAM/Disk gauges that used to fall back
    // to hardcoded numbers (resources?.cpu_percent ?? 24.5, etc).
    const researchTab = screen.getByRole('button', { name: /data & research/i })
    researchTab.click()

    await waitFor(() => {
      expect(screen.getByText(/could not be reached/i)).toBeInTheDocument()
    })

    for (const value of REMOVED_FABRICATED_VALUES) {
      expect(screen.queryByText(value)).not.toBeInTheDocument()
    }
  })

  it('shows an unavailable notice (not a silent empty list) when a service reports capability_unavailable/error', async () => {
    global.fetch = errorEnvelopeFetch()
    render(<EcosystemView />)

    await waitFor(() => {
      // DevOps domain is the default active tab; kanban board should report
      // the honest backend error rather than an empty "Column Empty" board.
      // Every section hits the same mocked error envelope, so multiple
      // ServiceNotice instances legitimately render it -- assert at least
      // one, not exactly one.
      expect(screen.getAllByText(/upstream unreachable/i).length).toBeGreaterThan(0)
    })

    // The old fabricated latency-trace table is gone entirely.
    expect(screen.queryByText('tr-9a1b')).not.toBeInTheDocument()
    expect(screen.queryByText('POST /api/enhanced/agent/chat')).not.toBeInTheDocument()
  })

  it('surfaces the backend detail message on a non-2xx response instead of rendering nothing', async () => {
    global.fetch = serverErrorFetch()
    render(<EcosystemView />)

    const researchTab = screen.getByRole('button', { name: /data & research/i })
    researchTab.click()

    await waitFor(() => {
      expect(screen.getAllByText(/psutil/i).length).toBeGreaterThan(0)
    })
  })

  it('renders no interactive controls that fabricate success without a backend call (Home Assistant / Stirling PDF / yt-dlp)', async () => {
    global.fetch = rejectingFetch()
    render(<EcosystemView />)

    const mediaTab = screen.getByRole('button', { name: /media & utilities/i })
    mediaTab.click()

    await waitFor(() => {
      expect(screen.getByText(/not available in this view/i)).toBeInTheDocument()
    })

    // The fabricated "Queue Download" / "Merge PDFs" action buttons that used
    // to mutate local state and show a fake success toast are gone.
    expect(screen.queryByRole('button', { name: /queue download/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /merge pdfs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /split pdf/i })).not.toBeInTheDocument()
  })

  it('BUG-018: every server the live catalog reports appears somewhere in the UI, or carries an explicit blocked/unavailable reason -- an unknown MCP server is never silently omitted', async () => {
    // `GET /api/enhanced/ecosystem/services` (agent_webui/api_extensions.py
    // `list_ecosystem_services`) is the runtime catalog authority: it
    // dynamically scans `agent-packages/agents/*` plus a small guaranteed
    // set. Prior to BUG-018's fix, EcosystemView never fetched this endpoint
    // at all -- its ~20 integration cards were a fixed, hand-written list,
    // so any server not on that list (most of the ~65-strong fleet) had
    // zero surface presence: no card, no blocked reason, nothing.
    const KNOWN_UNCOVERED_SERVER = 'zz-catalog-parity-probe-mcp'
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/ecosystem/services')) {
        return Promise.resolve(
          new Response(JSON.stringify(['github-agent', KNOWN_UNCOVERED_SERVER]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.reject(new Error('network unreachable'))
    }) as unknown as typeof fetch

    render(<EcosystemView />)

    const otherTab = screen.getByRole('button', { name: /other integrations/i })
    otherTab.click()

    // The probe name must surface once its tab is open, proving the live
    // catalog -- not a hard-coded list -- is the availability authority. A
    // server with no dedicated card still gets a generic descriptor with an
    // explicit blocked/degraded reason; it is never dropped on the floor.
    await waitFor(
      () => {
        expect(screen.queryAllByText(new RegExp(KNOWN_UNCOVERED_SERVER, 'i')).length).toBeGreaterThan(0)
      },
      { timeout: 3000 },
    )
    expect(screen.getAllByText(/no dedicated dashboard implemented yet/i).length).toBeGreaterThan(0)
  })

  it('renders no fabricated Mealie/Wger data and reports both as unavailable', async () => {
    global.fetch = rejectingFetch()
    render(<EcosystemView />)

    const lifestyleTab = screen.getByRole('button', { name: /lifestyle & home/i })
    lifestyleTab.click()

    await waitFor(() => {
      expect(screen.getAllByText(/no backend endpoint is wired/i).length).toBeGreaterThan(0)
    })

    // The hardcoded five-day meal plan / six-exercise workout split are gone.
    expect(screen.queryByText('Protein Power Salmon & Quinoa')).not.toBeInTheDocument()
    expect(screen.queryByText('Dumbbell Incline Bench Press')).not.toBeInTheDocument()
    expect(screen.queryByText(/servings/i)).not.toBeInTheDocument()
  })
})

/**
 * BUG-012 (GOC-27) proof: the GitHub/GitLab cards' `checks`/`run_number`
 * field mismatch and the missing repository selector, plus the typed
 * schema-validation fix.
 *
 * The `prs[0]`/`workflows[0]`/`mrs[0]`/`pipelines[0]` fixtures below are the
 * *backend-mapped shape* of real, captured GitHub/GitLab API responses --
 * see `agent-utilities` `tests/fixtures/enterprise/github_gitlab/` for the
 * raw upstream payloads and provenance (sha256 digests, capture method) and
 * `agent_utilities/protocols/enterprise/read_models.py` for the normalizer
 * that maps them into `ChangeRequest`/`Build`. Field values here
 * (`Knucklessg1`, `feat/ontology-operator-ui`, run `#5` "Release", GitLab MR
 * `!250339`, ...) come directly from those captures, not invented.
 */
describe('EcosystemView (BUG-012 GitHub/GitLab contract-mismatch proof)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function fixtureFetch() {
    return vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/ecosystem/github/prs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'success',
              source: 'live',
              repo: 'Knuckles-Team/agent-webui',
              prs: [
                {
                  id: 1,
                  title: 'Operator UI for the ontology system (Object Explorer, Object View, Vertex)',
                  author: 'Knucklessg1',
                  branch: 'feat/ontology-operator-ui',
                  status: 'closed',
                  web_url: 'https://github.com/Knuckles-Team/agent-webui/pull/1',
                },
              ],
              workflows: [
                { id: 31969737553, run_number: 5, name: 'Release', status: 'completed', conclusion: 'failure' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/ecosystem/gitlab/mrs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'success',
              source: 'live',
              mrs: [
                {
                  id: 250339,
                  project_id: 278964,
                  title: 'Document save_ tool action-fold exception for lifecycle actions',
                  author: 'adruid',
                  target_branch: 'master',
                  status: 'opened',
                  web_url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/250339',
                },
              ],
              pipelines: [
                { id: 2764458303, project_id: 278964, ref: 'refs/workloads/c1a9bdb4956', status: 'running' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      // Every other `/ecosystem/*` endpoint the same `Promise.all` batch
      // fetches: answer with a benign, well-formed envelope rather than
      // rejecting -- `loadEcosystemData` fetches GitHub/GitLab/Atlassian/
      // Portainer in one `Promise.all`, so an unmocked reject here would
      // fail that whole batch and leave the GitHub/GitLab sections stuck
      // in `loading` for a reason that has nothing to do with BUG-012.
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'success', source: 'live' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch
  }

  it('renders the real backend-mapped run_number and drops the unsourced checks field', async () => {
    global.fetch = fixtureFetch()
    render(<EcosystemView />)

    await waitFor(() => {
      expect(screen.getByText(/Run #5 - Release/i)).toBeInTheDocument()
    })

    // BUG-012: `checks` never had a backend data source -- it must not
    // appear anywhere in the rendered PR row.
    expect(screen.queryByText(/^checks$/i)).not.toBeInTheDocument()

    // The PR/MR titles render as real source links now that `web_url` is
    // modeled and validated instead of silently discarded.
    const prLink = screen.getByRole('link', {
      name: /Operator UI for the ontology system/i,
    })
    expect(prLink).toHaveAttribute('href', 'https://github.com/Knuckles-Team/agent-webui/pull/1')

    const mrLink = screen.getByRole('link', {
      name: /Document save_ tool action-fold exception/i,
    })
    expect(mrLink).toHaveAttribute('href', 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/250339')
  })

  it('lets an operator supply the required GitHub repository selector', async () => {
    global.fetch = fixtureFetch()
    render(<EcosystemView />)

    // BUG-012: `get_github_prs` requires an explicit `owner/name` selector
    // and the view used to never provide a way to enter one.
    const repoInput = await screen.findByLabelText(/github repository/i)
    expect(repoInput).toBeInTheDocument()
  })

  it('known-bad proof: a drifted GitHub PR field fails typed and diagnosable, not as a silent undefined', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/ecosystem/github/prs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'success',
              source: 'live',
              // `id` renamed to `number` -- simulates exactly the class of
              // vendor/adapter drift BUG-012 found (a field the frontend
              // depends on silently stops arriving under the name it
              // expects).
              prs: [
                {
                  number: 1,
                  title: 'Drifted PR',
                  author: 'someone',
                  branch: 'main',
                  status: 'open',
                  web_url: null,
                },
              ],
              workflows: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      // See `fixtureFetch` above for why unrelated endpoints in the same
      // `Promise.all` batch must not reject.
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'success', source: 'live' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    render(<EcosystemView />)

    await waitFor(
      () => {
        expect(screen.getByText(/does not match the expected schema/i)).toBeInTheDocument()
      },
      { timeout: 3000 },
    )

    // The drifted title never silently renders -- the section is in its
    // typed error state, not a "successful, empty-looking" one.
    expect(screen.queryByText('Drifted PR')).not.toBeInTheDocument()
  })
})

/**
 * Regression proof for the "stuck spinner" / "silent no-op" class of defect
 * found auditing GOC-28's action paths: a mutation whose `!res.ok` branch
 * was simply absent left the operator with either a permanently-spinning
 * button (`runBulkRepoAction`) or a dialog that silently did nothing
 * (`handleAddHost`) on a real backend refusal -- worse than the
 * error-as-emptiness class this lane otherwise targets, since there was no
 * rendered signal AT ALL, not even a misleading one.
 */
describe('EcosystemView (action failure feedback)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  /** Route-aware fetch: known GET endpoints resolve with a minimal fixture
   * so unrelated on-mount fetches in the same view don't reject/crash;
   * `overrides` intercepts specific paths for the behavior under test. */
  function routedFetch(overrides: Record<string, () => Promise<Response>>) {
    return vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      for (const [path, handler] of Object.entries(overrides)) {
        if (url.includes(path)) return handler()
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }) as unknown as typeof fetch
  }

  it('shows a visible error toast when adding a host fails, instead of the dialog silently doing nothing', async () => {
    global.fetch = routedFetch({
      '/api/enhanced/tunnel-manager/hosts': () =>
        Promise.resolve(new Response('backend refused the host', { status: 403 })),
    })
    render(<EcosystemView />)

    // Host Aliases Inventory lives on the Infrastructure Hub domain tab.
    screen.getByRole('button', { name: /infrastructure hub/i }).click()

    const addHostButton = await screen.findByRole('button', { name: /add host/i })
    addHostButton.click()

    fireEvent.change(await screen.findByPlaceholderText('production-node'), { target: { value: 'test-host' } })
    fireEvent.change(screen.getByPlaceholderText('192.0.2.12'), { target: { value: '192.0.2.99' } })
    fireEvent.change(screen.getByPlaceholderText('ubuntu'), { target: { value: 'ubuntu' } })

    screen.getByRole('button', { name: /register host/i }).click()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/failed to save host configuration.*http 403/i))
    })

    // The dialog must not have quietly closed as if the add had succeeded.
    expect(screen.getByRole('button', { name: /register host/i })).toBeInTheDocument()
  })

  it('resets the bulk-action spinner and shows an error on a non-ok bulk status response, instead of spinning forever', async () => {
    global.fetch = routedFetch({
      '/api/enhanced/repository-manager/repos': () =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { reference: 'org/repo', label: 'repo', branch_state: 'clean', modified_count: 0, status: 'ok' },
            ]),
            { status: 200 },
          ),
        ),
      '/api/enhanced/repository-manager/bulk': () =>
        Promise.resolve(new Response('bulk action refused', { status: 500 })),
    })
    render(<EcosystemView />)

    // Repositories Workspace Matrix lives on the Media & Utilities domain tab.
    screen.getByRole('button', { name: /media & utilities/i }).click()

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    })
    const rowCheckbox = screen.getAllByRole('checkbox').find((cb) => !cb.closest('thead'))
    if (!rowCheckbox) throw new Error('expected at least one repo row checkbox')
    fireEvent.click(rowCheckbox)

    const checkStatusButton = await screen.findByRole('button', { name: /check status/i, hidden: false })
    await waitFor(() => {
      expect(checkStatusButton).not.toBeDisabled()
    })
    checkStatusButton.click()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/bulk status failed.*http 500/i))
    })

    // The spinner must have been reset, not left running forever.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check status/i })).not.toBeDisabled()
    })
  })
})
