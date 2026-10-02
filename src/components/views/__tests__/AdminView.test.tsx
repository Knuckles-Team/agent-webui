import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import AdminView from '@/components/views/AdminView'
import { renderWithProviders } from '@/__tests__/fixtures'

function reply(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as Response)
}

const META = { registry_digest: 'test-digest', api_version: 'v1' }

/** A successful operation envelope, with the `meta` block the envelope schema requires. */
function okReply(result: unknown): Promise<Response> {
  return reply(200, { ok: true, result, meta: META })
}

// The typed Graph OS transport reads a CSRF token from `/auth/session` before
// every operation call, so every fetcher below must answer it with a valid
// authenticated session -- a 404 or an unauthenticated session there blocks
// the operation call before it is ever attempted.
const AUTHENTICATED_SESSION = { authenticated: true, csrf_token: 'test-csrf-token' }

/** Wrap a fetcher that only needs to answer operation calls: `/auth/session`
 *  is handled here so every test does not have to repeat that branch. */
function withSession(opFetcher: (url: string) => Promise<Response>) {
  return vi.fn((url: string) => (url === '/auth/session' ? reply(200, AUTHENTICATED_SESSION) : opFetcher(url)))
}

describe('AdminView identity tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      withSession((url) => (url.includes('/api/v1/ops/') ? reply(404, {}) : reply(200, { authenticated: false }))),
    )
  })

  it('renders the identity and engine admin destinations', () => {
    renderWithProviders(<AdminView />)
    for (const label of [
      'users',
      'groups',
      'roles',
      'idps',
      'sessions',
      'api keys',
      'audit',
      'security mode',
      'tenants',
      'shards',
      'backup',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('requires an explicit principal before listing key metadata', async () => {
    const { user } = renderWithProviders(<AdminView />)
    await user.click(screen.getByRole('tab', { name: 'api keys' }))
    expect(screen.getByText(/Enter a principal id/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('API key principal id'), 'u-1')
    await user.click(screen.getByRole('button', { name: 'Load api-keys' }))
    await waitFor(() => {
      expect(screen.getByText(/not available on this server/)).toBeInTheDocument()
    })
  })

  it('requires an explicit principal before listing sessions', async () => {
    const fetcher = withSession((url) =>
      url.includes('identity.sessions.list')
        ? okReply({ items: [], next_cursor: null })
        : reply(404, {}),
    )
    vi.stubGlobal('fetch', fetcher)
    const { user } = renderWithProviders(<AdminView />)
    await user.click(screen.getByRole('tab', { name: 'sessions' }))
    expect(screen.getByText(/Enter a principal id/)).toBeInTheDocument()
    expect(fetcher.mock.calls.some(([url]) => url.includes('identity.sessions.list'))).toBe(false)
    await user.type(screen.getByLabelText('Session principal id'), 'u-1')
    await user.click(screen.getByRole('button', { name: 'Load sessions' }))
    await waitFor(() => {
      expect(fetcher.mock.calls.some(([url]) => url.includes('identity.sessions.list'))).toBe(true)
    })
  })

  it('revokes by the opaque session handle and does not render a token', async () => {
    const fetcher = withSession((url) =>
      url.includes('identity.sessions.list')
        ? okReply({ items: [{ handle: 'opaque123456' }], next_cursor: null })
        : okReply({ changed: true }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { user } = renderWithProviders(<AdminView />)
    await user.click(screen.getByRole('tab', { name: 'sessions' }))
    await user.type(screen.getByLabelText('Session principal id'), 'u-1')
    await user.click(screen.getByRole('button', { name: 'Load sessions' }))
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/ops/identity.sessions.revoke',
      expect.objectContaining({ body: JSON.stringify({ id: 'opaque123456' }) }),
    )
  })

  it('requires an explicit acknowledgement and surfaces MFA step-up for mode transitions', async () => {
    const fetcher = withSession((url) =>
      url.includes('identity.mode.status')
        ? okReply({ mode: 'none', epoch: 1 })
        : reply(428, {
            ok: false,
            error: { code: 'STEP_UP_REQUIRED', source: 'graphos', message: 'step-up required', retryable: false },
            meta: META,
          }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { user } = renderWithProviders(<AdminView />)
    await user.click(screen.getByRole('tab', { name: 'security mode' }))
    await waitFor(() => {
      expect(screen.getByText('none')).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText('Target mode'), 'local')
    expect(screen.getByRole('button', { name: 'Request transition' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /revokes current sessions/i }))
    await user.click(screen.getByRole('button', { name: 'Request transition' }))
    await waitFor(() => {
      expect(screen.getByText('A fresh administrator MFA confirmation is required.')).toBeInTheDocument()
    })
  })
})
