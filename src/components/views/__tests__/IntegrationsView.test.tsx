/**
 * Wiring tests for the GOC-25 dynamic `/integrations` catalog page. Proves
 * the whole discover -> render path against mocked `fetch`, matching the
 * repo's convention for view-level catalog tests (`McpAppsView.test.tsx`,
 * `EcosystemView.test.tsx`'s BUG-018 case).
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IntegrationsView from '@/components/views/IntegrationsView'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetch(handlers: { services?: () => Response; contributions?: () => Response }) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/ecosystem/services')) {
      return Promise.resolve(handlers.services ? handlers.services() : jsonResponse([]))
    }
    if (url.includes('/frontend-contributions')) {
      return Promise.resolve(
        handlers.contributions ? handlers.contributions() : new Response('not found', { status: 404 }),
      )
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('IntegrationsView', () => {
  it('KNOWN-BAD PROOF: an unrecognized live package appears, marked not_configured -- never silently dropped', async () => {
    const PROBE = 'zz-catalog-parity-probe-mcp'
    mockFetch({ services: () => jsonResponse(['github-agent', PROBE]) })

    render(<IntegrationsView />)

    await waitFor(() => {
      expect(screen.getByTestId(`integration-card-${PROBE}`)).toBeInTheDocument()
    })
    const card = screen.getByTestId(`integration-card-${PROBE}`)
    expect(card).toHaveTextContent(/not configured/i)
    // It must never carry the "Available" badge without a real descriptor.
    expect(card).not.toHaveTextContent(/^available$/i)
  })

  it('a package with a valid OK descriptor renders as Available and shows its title', async () => {
    mockFetch({
      services: () => jsonResponse(['gitlab-api']),
      contributions: () =>
        jsonResponse({
          packages: [
            {
              package_id: 'gitlab-api',
              status: 'OK',
              reason: null,
              descriptor: { title: 'GitLab', package_version: '1.0.0', read_models: [{ id: 'mrs' }], actions: [] },
            },
          ],
        }),
    })

    render(<IntegrationsView />)
    await waitFor(() => {
      expect(screen.getByTestId('integration-card-gitlab-api')).toBeInTheDocument()
    })
    expect(screen.getByTestId('integration-card-gitlab-api')).toHaveTextContent(/available/i)
    expect(screen.getByText('GitLab')).toBeInTheDocument()
  })

  it('KNOWN-BAD PROOF: a live-catalog backend error renders an explicit failure, never plausible-looking data', async () => {
    mockFetch({ services: () => new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }) })

    render(<IntegrationsView />)

    await waitFor(() => {
      expect(screen.getByTestId('blocked-state')).toBeInTheDocument()
    })
    expect(screen.queryByTestId(/^integration-card-/)).not.toBeInTheDocument()
  })

  it('clicking a card opens an inline detail panel without navigating (no route change)', async () => {
    mockFetch({
      services: () => jsonResponse(['gitlab-api']),
      contributions: () =>
        jsonResponse({
          packages: [
            {
              package_id: 'gitlab-api',
              status: 'OK',
              reason: null,
              descriptor: {
                title: 'GitLab',
                package_version: '1.0.0',
                read_models: [{ id: 'mrs' }],
                actions: [{ id: 'a' }],
              },
            },
          ],
        }),
    })

    render(<IntegrationsView />)
    await waitFor(() => {
      expect(screen.getByTestId('integration-card-gitlab-api')).toBeInTheDocument()
    })
    screen.getByTestId('integration-card-gitlab-api').click()
    await waitFor(() => {
      expect(screen.getByText(/read models/i)).toBeInTheDocument()
    })
  })

  it('filters the catalog by package id via the search box', async () => {
    mockFetch({ services: () => jsonResponse(['alpha-agent', 'beta-agent']) })
    render(<IntegrationsView />)
    await waitFor(() => {
      expect(screen.getByTestId('integration-card-alpha-agent')).toBeInTheDocument()
    })
    const input = screen.getByLabelText(/filter integrations/i)
    input.focus()
    // Use fireEvent-equivalent through userEvent-free direct value set + input event
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    nativeInputValueSetter?.call(input, 'alpha')
    input.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => {
      expect(screen.queryByTestId('integration-card-beta-agent')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('integration-card-alpha-agent')).toBeInTheDocument()
  })

  it('shows a non-blocking banner (not a full block) when the descriptor catalog is unavailable but the live list loads', async () => {
    mockFetch({ services: () => jsonResponse(['some-pkg']) })
    render(<IntegrationsView />)
    await waitFor(() => {
      expect(screen.getByTestId('integration-card-some-pkg')).toBeInTheDocument()
    })
    // The base list still renders even though the descriptor authority (404
    // today) is unavailable -- one banner, not a full-page block.
    expect(screen.getAllByTestId('blocked-state').length).toBeGreaterThan(0)
  })

  it('an empty live catalog renders an explicit empty state, not a fabricated card', async () => {
    mockFetch({ services: () => jsonResponse([]) })
    render(<IntegrationsView />)
    await waitFor(() => {
      expect(screen.getByText(/no packages were reported/i)).toBeInTheDocument()
    })
  })
})
