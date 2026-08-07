import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import Chat from '@/Chat'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { PageContextEnvelope } from '@/lib/page-context'

/**
 * Coverage for SWE mode relocated from the former `/swe` page (SweView.tsx) into
 * the chat send path (OS-5.34 / OS-5.33). Verifies:
 *  - the toggle control exists in the chat toolbar and flips on click
 *  - enabling it and sending a message lazily creates a runtime session and
 *    drives it via the same `api.ts` methods SweView used directly
 *    (createSweSession -> EventSource on sweEventsUrl -> sweAct 'cmd_run')
 */

vi.mock('@/lib/api', () => ({
  api: {
    createSweSession: vi.fn(() => Promise.resolve({ session_id: 'sess-1', backend: 'local', workdir: '/tmp/ws' })),
    sweAct: vi.fn(() => Promise.resolve({ ok: true })),
    sweEventsUrl: vi.fn((sid: string) => `/api/runtime/sessions/${sid}/events`),
    stopSweSession: vi.fn(() => Promise.resolve()),
    sweProvenance: vi.fn(() => Promise.resolve({ run_id: 'r1', actions: [], mutated: [] })),
  },
}))

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

const pageContext: PageContextEnvelope = {
  schemaVersion: '1.0',
  route: '/chat',
  view: 'chat',
  selection: [],
  filters: {},
  allowedActions: [],
  capturedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      if (path.startsWith('/api/configure')) {
        return Promise.resolve(jsonResponse({ models: [], builtinTools: [] }))
      }
      if (path.startsWith('/api/enhanced/models')) {
        return Promise.resolve(jsonResponse({ models: [], default_id: null }))
      }
      if (path.startsWith('/auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: false, roles: [] }))
      }
      return Promise.resolve(jsonResponse([]))
    }),
  )
})

describe('Chat SWE mode', () => {
  it('renders a SWE-mode toggle that is off by default', () => {
    renderWithProviders(<Chat pageContext={pageContext} />)
    const toggle = screen.getByRole('button', { name: /toggle swe mode/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('flips aria-pressed when the toggle is clicked', async () => {
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
    const toggle = screen.getByRole('button', { name: /toggle swe mode/i })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('drives the developer-workspace runtime when a message is sent in SWE mode', async () => {
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)

    const toggle = screen.getByRole('button', { name: /toggle swe mode/i })
    await user.click(toggle)
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'pytest -q{Enter}')

    await waitFor(() => {
      expect(api.createSweSession).toHaveBeenCalledWith({ prefer_docker: false })
    })
    await waitFor(() => {
      expect(api.sweAct).toHaveBeenCalledWith('sess-1', { kind: 'cmd_run', command: 'pytest -q' })
    })
    expect(api.sweEventsUrl).toHaveBeenCalledWith('sess-1')
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/runtime/sessions/sess-1/events')

    // The session badge and stop control should now be visible.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop swe session/i })).toBeInTheDocument()
    })
  })

  it('stops the runtime session when SWE mode is toggled back off', async () => {
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)

    const toggle = screen.getByRole('button', { name: /toggle swe mode/i })
    await user.click(toggle)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'ls{Enter}')

    await waitFor(() => {
      expect(api.createSweSession).toHaveBeenCalled()
    })

    await user.click(toggle)

    await waitFor(() => {
      expect(api.stopSweSession).toHaveBeenCalledWith('sess-1')
    })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
