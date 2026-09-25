import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import UserManagementView from '@/components/views/UserManagementView'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { Identity } from '@/lib/auth'

const identity: Identity = {
  userKey: 'admin-1',
  role: 'admin',
  ssoConfigured: true,
  needsSignIn: false,
  raw: { authenticated: true, subject: 'admin-1', tenant: 'homelab', roles: ['webui:admin'], webui_role: 'admin' },
}
vi.mock('@/lib/auth', () => ({ useIdentity: () => ({ identity, loading: false }) }))

const meta = { registry_digest: 'digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'session-csrf' }

function response(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(Response.json(body, { status }))
}

describe('UserManagementView identity operations', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('distinguishes an unavailable API from an empty roster and never calls legacy configure', async () => {
    const fetcher = vi.fn((url: string) => (url === '/auth/session' ? response(200, session) : response(404, {})))
    vi.stubGlobal('fetch', fetcher)
    renderWithProviders(<UserManagementView />)
    await waitFor(() => {
      expect(screen.getByTestId('users-unavailable')).toBeInTheDocument()
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/ops/identity.users.list',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetcher.mock.calls.some(([url]) => url.includes('/api/graph/configure'))).toBe(false)
  })

  it('shows a confirmed empty roster distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/auth/session'
          ? response(200, session)
          : response(200, { ok: true, result: { items: [], next_cursor: null }, meta }),
      ),
    )
    renderWithProviders(<UserManagementView />)
    await waitFor(() => {
      expect(screen.getByText('No users matched this search.')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('users-unavailable')).not.toBeInTheDocument()
  })

  it('shows roster actions but never reports an unconfirmed mutation as successful', async () => {
    const fetcher = vi.fn((url: string) =>
      url === '/auth/session'
        ? response(200, session)
        : url.includes('identity.users.list')
          ? response(200, {
              ok: true,
              result: { items: [{ principal_id: 'u-2', username: 'Bob', roles: ['reader'] }], next_cursor: null },
              meta,
            })
          : response(403, {
              ok: false,
              error: { code: 'SCOPE_REQUIRED', source: 'graphos', message: 'denied', retryable: false },
              meta,
            }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { user } = renderWithProviders(<UserManagementView />)
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Disable' }))
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/ops/identity.users.disable',
      expect.objectContaining({ body: JSON.stringify({ principal_id: 'u-2' }) }),
    )
    expect(screen.queryByText('Identity action completed.')).not.toBeInTheDocument()
  })
})
