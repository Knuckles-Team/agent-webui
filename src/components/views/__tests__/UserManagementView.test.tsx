import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import UserManagementView from '@/components/views/UserManagementView'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { Identity } from '@/lib/auth'

// A plain closure variable (rather than `vi.fn()`) keeps the mocked hook's
// return type concrete instead of `any` -- same pattern UserMenu.test.tsx uses.
let identityResult: { identity: Identity; loading: boolean } | null = null

vi.mock('@/lib/auth', () => ({
  useIdentity: () => {
    if (!identityResult) throw new Error('set identityResult before rendering UserManagementView in this suite')
    return identityResult
  },
}))

const ADMIN_IDENTITY: Identity = {
  userKey: 'admin-1',
  role: 'admin',
  ssoConfigured: true,
  needsSignIn: false,
  raw: {
    authenticated: true,
    subject: 'admin-1',
    username: 'alice',
    email: 'alice@example.test',
    name: 'Alice Admin',
    picture: null,
    tenant: 'homelab',
    roles: ['webui:admin', 'kg:admin'],
    webui_role: 'admin',
    expires_at: null,
  },
}

const READER_IDENTITY: Identity = {
  userKey: 'reader-1',
  role: 'reader',
  ssoConfigured: true,
  needsSignIn: false,
  raw: {
    authenticated: true,
    subject: 'reader-1',
    username: 'bob',
    email: 'bob@example.test',
    name: 'Bob Reader',
    picture: null,
    tenant: 'homelab',
    roles: ['tenant:homelab'],
    webui_role: 'reader',
    expires_at: null,
  },
}

interface ConfigureBody {
  action?: string
}

/**
 * Mock `fetch` for `POST /api/graph/configure`, branching on the request's
 * `action` field the way the real dispatcher does. Any action not given a
 * canned response falls back to the dispatcher's real, empirically-observed
 * "unknown configuration action" reply (HTTP 200) -- so a test that forgets
 * to configure an action exercises the true default instead of a fetch
 * failure, matching what the live backend actually answers today.
 */
function mockConfigureFetch(
  responses: Partial<Record<'rbac_list' | 'rbac_grant' | 'rbac_revoke', { status?: number; body: unknown }>>,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes('/api/graph/configure')) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('not found'),
      }) as unknown as Promise<Response>
    }
    const parsed = init?.body ? (JSON.parse(init.body as string) as ConfigureBody) : {}
    const cfg = parsed.action ? responses[parsed.action as keyof typeof responses] : undefined
    if (!cfg) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'success', result: { error: 'unknown configuration action' } }),
        text: () => Promise.resolve(''),
      }) as unknown as Promise<Response>
    }
    const status = cfg.status ?? 200
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(status < 400 ? { status: 'success', result: cfg.body } : cfg.body),
      text: () => Promise.resolve(typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body)),
    }) as unknown as Promise<Response>
  })
}

describe('UserManagementView', () => {
  beforeEach(() => {
    identityResult = null
  })

  it("renders the signed-in principal's own identity/roles from a real /auth/session-shaped response", async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({}) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    expect(screen.getByTestId('user-mgmt-self-id')).toHaveTextContent('admin-1')
    expect(screen.getByTestId('user-mgmt-self-tenant')).toHaveTextContent('homelab')
    expect(screen.getByTestId('user-mgmt-self-admin')).toHaveTextContent('Yes')
    expect(screen.getByTestId('user-mgmt-self-roles')).toHaveTextContent('admin')
    expect(screen.getByTestId('user-mgmt-self-roles')).toHaveTextContent('kg:admin')
  })

  it('renders a distinct "unavailable" state when the backend does not recognize the RBAC action', async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    // No canned response for rbac_list -> falls back to the real dispatcher's
    // "unknown configuration action" reply.
    global.fetch = mockConfigureFetch({}) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('principals-state-unavailable')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('principals-state-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('principals-state-forbidden')).not.toBeInTheDocument()
    expect(screen.getByText(/could not be fetched/i)).toBeInTheDocument()
  })

  it('renders a distinct "empty" state when the backend answers with a genuinely empty roster', async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({
      rbac_list: { body: { roles: [], grants: [], identities: [] } },
    }) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('principals-state-empty')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('principals-state-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('principals-state-forbidden')).not.toBeInTheDocument()
    expect(screen.getByText(/confirmed empty roster/i)).toBeInTheDocument()
  })

  it('renders a distinct "forbidden" state when the backend refuses the read with HTTP 403', async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({
      rbac_list: { status: 403, body: 'caller lacks kg:admin' },
    }) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('principals-state-forbidden')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('principals-state-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('principals-state-empty')).not.toBeInTheDocument()
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument()
  })

  it('renders live roles for a ready policy and lets an admin see revoke controls', async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({
      rbac_list: {
        body: {
          roles: [{ name: 'admin' }],
          grants: [],
          identities: [{ id: 'principal-42', roles: ['admin', 'kg:read'] }],
        },
      },
    }) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('principals-state-ready')).toBeInTheDocument()
    })
    expect(screen.getByText('principal-42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revoke admin from principal-42/i })).toBeInTheDocument()
  })

  it('does not show a grant/revoke control to a non-admin caller', async () => {
    identityResult = { identity: READER_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({
      rbac_list: {
        body: { roles: [], grants: [], identities: [{ id: 'principal-42', roles: ['admin'] }] },
      },
    }) as unknown as typeof fetch

    renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('principals-state-ready')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('user-mgmt-grant-form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Grant/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Admin role required to grant or revoke roles/i)).toBeInTheDocument()
    expect(screen.getByTestId('user-mgmt-self-admin')).toHaveTextContent('No')
  })

  it('surfaces an error instead of silently succeeding when a grant is refused', async () => {
    identityResult = { identity: ADMIN_IDENTITY, loading: false }
    global.fetch = mockConfigureFetch({
      rbac_list: { body: { roles: [], grants: [], identities: [] } },
      rbac_grant: { status: 403, body: 'caller lacks kg:admin' },
    }) as unknown as typeof fetch

    const { user } = renderWithProviders(<UserManagementView />)

    await waitFor(() => {
      expect(screen.getByTestId('user-mgmt-grant-form')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/principal id/i), 'some-principal')
    await user.click(screen.getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      expect(screen.getByText(/Forbidden: you are not permitted to grant roles/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/^Granted /)).not.toBeInTheDocument()
  })
})
