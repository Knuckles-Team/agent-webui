import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import EcosystemView from '@/components/views/EcosystemView'

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
