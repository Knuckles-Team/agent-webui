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

describe('AdminView identity tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url.includes('/api/v1/ops/') ? reply(404, {}) : reply(200, { authenticated: false }))),
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
    const fetcher = vi.fn((url: string) =>
      url.includes('identity.sessions.list')
        ? reply(200, { ok: true, result: { items: [], next_cursor: null } })
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
    const fetcher = vi.fn((url: string) =>
      url.includes('identity.sessions.list')
        ? reply(200, { ok: true, result: { items: [{ handle: 'opaque123456' }], next_cursor: null } })
        : reply(200, { ok: true, result: { changed: true } }),
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
    const fetcher = vi.fn((url: string) =>
      url.includes('identity.mode.status')
        ? reply(200, { ok: true, result: { mode: 'none', epoch: 1 } })
        : reply(428, { ok: false, error: { code: 'STEP_UP_REQUIRED' } }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { user } = renderWithProviders(<AdminView />)
    await user.click(screen.getByRole('tab', { name: 'security mode' }))
    await user.selectOptions(screen.getByLabelText('Target mode'), 'local')
    expect(screen.getByRole('button', { name: 'Request transition' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /revokes current sessions/i }))
    await user.click(screen.getByRole('button', { name: 'Request transition' }))
    await waitFor(() => {
      expect(screen.getByText(/fresh administrator MFA confirmation/i)).toBeInTheDocument()
    })
  })
})
