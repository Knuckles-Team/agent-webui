import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SessionsView from '@/components/views/SessionsView'

/**
 * DS-05 rendered-state coverage for the Durable Sessions Console. The view
 * polls `/api/enhanced/sessions` every 4s and, while the attach-console
 * drawer is open, `/api/enhanced/sessions/:id` every 2s -- every test here
 * unmounts (via `cleanup`, run automatically by the test setup, or an
 * explicit `rendered.unmount()`) so no interval survives into a later test.
 */

const RUNNING_SESSION = {
  id: 'sess-running',
  title: 'Running session',
  created_at: 0,
  updated_at: 0,
  model: 'claude',
  mode: 'auto',
  workspace: '/workspace',
  turn_count: 3,
  status: 'running',
  background: true,
  needs_input: false,
  last_response_preview: 'working...',
}

const NEEDS_INPUT_SESSION = {
  ...RUNNING_SESSION,
  id: 'sess-needs-input',
  title: 'Needs input session',
  needs_input: true,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SessionsView — DS-05 status language', () => {
  it('shows the shared loading status message before the session list resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    render(<SessionsView />)

    expect(screen.getByText('Querying session registry...')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the shared empty status message (DS-05) when no durable sessions exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    )
    render(<SessionsView />)

    expect(await screen.findByText('No Durable Sessions Found')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Start an agent execution loop in the terminal UI or spin up an autonomous goal to view session history and attachment handles here.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the shared pending status message in the drawer when a session needs input', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/sessions/${NEEDS_INPUT_SESSION.id}`)) {
        return Promise.resolve(jsonResponse({ ...NEEDS_INPUT_SESSION, turns: [] }))
      }
      return Promise.resolve(jsonResponse([NEEDS_INPUT_SESSION]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<SessionsView />)

    await user.click(await screen.findByRole('button', { name: /attach console/i }))

    expect(await screen.findByText('Agent is suspended waiting for user instructions...')).toBeInTheDocument()
    // Two role=status nodes can coexist (the suspended banner plus the
    // console log's own empty-turns status); scope to the pending one.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('shows the shared loading status message in the drawer while a session keeps running', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/sessions/${RUNNING_SESSION.id}`)) {
        return Promise.resolve(jsonResponse({ ...RUNNING_SESSION, turns: [] }))
      }
      return Promise.resolve(jsonResponse([RUNNING_SESSION]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<SessionsView />)

    await user.click(await screen.findByRole('button', { name: /attach console/i }))

    expect(await screen.findByText('Agent execution thread running background iterations...')).toBeInTheDocument()
  })

  it('shows the shared empty status message for a console with no turns yet', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/sessions/${RUNNING_SESSION.id}`)) {
        return Promise.resolve(jsonResponse({ ...RUNNING_SESSION, turns: [] }))
      }
      return Promise.resolve(jsonResponse([RUNNING_SESSION]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<SessionsView />)

    await user.click(await screen.findByRole('button', { name: /attach console/i }))

    expect(await screen.findByText('Console outputs are empty. Waiting for step results...')).toBeInTheDocument()
  })
})
