// spec: WEBUI-APPS-R005.1.2
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
const state = vi.hoisted(() => ({ role: 'reader', needsSignIn: false, admin: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    loading: false,
    identity: {
      userKey: 'role-fixture',
      role: state.role,
      ssoConfigured: true,
      needsSignIn: state.needsSignIn,
      raw: null,
    },
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({
  ...(await original<typeof import('@/lib/chat-store')>()),
  useConversations: () => [],
}))
vi.mock('@/lib/apps/catalog', async (original) => ({
  ...(await original<typeof import('@/lib/apps/catalog')>()),
  useAppAvailability: () => ({ loading: false, available: new Set(), reasons: new Map() }),
}))
vi.mock('@/components/views/AdminView', () => ({
  default: () => {
    state.admin()
    return <p>Admin content</p>
  },
}))
vi.mock('@/components/workspace/OperateWorkspace', () => ({ default: () => <p>Reader workspace</p> }))
vi.mock('@/components/views/DashboardView', () => ({ default: () => <p>Allowed reader dashboard</p> }))
vi.mock('@/components/ChatPanel', () => ({ default: () => <p>Assistant</p> }))
vi.mock('@/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/PageHead', () => ({ PageHead: () => null }))
vi.mock('@/components/ConsentBanner', () => ({ ConsentBanner: () => null }))
vi.mock('@/lib/mcp-context', () => ({ MCPProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/webmcp/provider', () => ({
  WebMcpProvider: ({ children, controlPlacement }: { children: ReactNode; controlPlacement: string }) => (
    <div data-testid="control-placement" data-placement={controlPlacement}>
      {children}
    </div>
  ),
  WorkspaceWebMcpControl: () => null,
  useWebMcpToolSet: vi.fn(),
}))
afterEach(() => {
  window.history.replaceState({}, '', '/')
  state.role = 'reader'
  state.needsSignIn = false
  state.admin.mockClear()
})
describe('real shell and sidebar role filtering', () => {
  it('rejects a guessed admin path without mounting its view and keeps reader navigation', async () => {
    window.history.replaceState({}, '', '/admin')
    render(<App />)
    expect(await screen.findByText('Insufficient role')).toBeInTheDocument()
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/admin')).toBe(false)
    expect(state.admin).not.toHaveBeenCalled()
    const home = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/overview')
    expect(home).toBeDefined()
    fireEvent.click(home!)
    expect(await screen.findByText('Allowed reader dashboard')).toBeVisible()
    expect(screen.queryByText('Insufficient role')).not.toBeInTheDocument()
  })
  it('allows the same real route for an admin', async () => {
    state.role = 'admin'
    window.history.replaceState({}, '', '/admin')
    render(<App />)
    expect(await screen.findByText('Admin content')).toBeInTheDocument()
    expect(state.admin).toHaveBeenCalled()
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/admin')).toBe(true)
    expect(screen.queryByText('Insufficient role')).not.toBeInTheDocument()
  })
})

// spec: WEBUI-APPS-R005.6.2
it.each([
  ['/privacy', false, 'floating'],
  ['/terms', false, 'floating'],
  ['/unknown-route', false, 'floating'],
  ['/chat', true, 'floating'],
  ['/chat', false, 'workspace'],
  ['/', false, 'workspace'],
])('keeps control consumer available at %s with denied identity %s', (path, denied, placement) => {
  state.needsSignIn = denied
  window.history.replaceState({}, '', path)
  render(<App />)
  expect(screen.getByTestId('control-placement')).toHaveAttribute('data-placement', placement)
})
