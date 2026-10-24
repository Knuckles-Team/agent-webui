// spec: WEBUI-APPS-R045, WEBUI-APPS-R049, WEBUI-APPS-R049.1.2, WEBUI-APPS-R049.1.3
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import { navigateWorkspace } from '@/lib/workspace-navigation'
const state = vi.hoisted(() => ({ role: 'admin', needsSignIn: false, loading: false, tenant: 'a', conversations: [] }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    loading: state.loading,
    identity: {
      userKey: 'entry-user',
      role: state.role,
      needsSignIn: state.needsSignIn,
      ssoConfigured: true,
      raw: { tenant: state.tenant },
    },
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({
  ...(await original<typeof import('@/lib/chat-store')>()),
  useConversations: () => state.conversations,
}))
vi.mock('@/lib/apps/catalog', async (original) => ({
  ...(await original<typeof import('@/lib/apps/catalog')>()),
  useAppAvailability: () => ({ loading: false, available: new Set(), reasons: new Map() }),
}))
vi.mock('@/lib/work-workspace', async (original) => ({
  ...(await original<object>()),
  workApi: {
    listTasks: vi.fn(async () => []),
    listRuns: vi.fn(async () => ({ ok: true, data: { result: [] } })),
  },
}))
vi.mock('@/components/workspace/OperateWorkspace', () => ({ default: () => <p>Reader workspace</p> }))
vi.mock('@/components/views/DashboardView', () => ({ default: () => <p>Legacy overview</p> }))
vi.mock('@/components/ChatPanel', () => ({ default: () => <p>Retained assistant</p> }))
vi.mock('@/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/PageHead', () => ({ PageHead: () => null }))
vi.mock('@/components/ConsentBanner', () => ({ ConsentBanner: () => null }))
vi.mock('@/lib/mcp-context', () => ({ MCPProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/webmcp/provider', () => ({
  WebMcpProvider: ({ children }: { children: ReactNode }) => children,
  WorkspaceWebMcpControl: () => null,
  useWebMcpToolSet: vi.fn(),
}))
beforeEach(() => {
  state.role = 'admin'
  state.needsSignIn = false
  state.loading = false
  state.tenant = 'a'
  localStorage.clear()
  window.history.replaceState({ retained: true }, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/prompts')
          ? [{ name: 'sample', title: 'Sample', goal: '', core_directive: '', file_path: 'sample.json' }]
          : { title: 'Sample', identity: { role: 'Original' }, tools: [] },
      ),
    ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function visit(path: string) {
  act(() => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new Event('history-state-changed'))
  })
}
it('mounts Work by default, replaces only the entry, and retains query/hash/history state', async () => {
  window.history.replaceState({ retained: true }, '', '/?conversation=existing#context')
  const length = window.history.length
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Work' })).toBeVisible()
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    '/workspace/work?conversation=existing#context',
  )
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ retained: true })
  expect(screen.queryByText('Legacy overview')).not.toBeInTheDocument()
  visit('/overview')
  expect(await screen.findByText('Legacy overview')).toBeVisible()
  act(() => {
    window.history.back()
  })
  await waitFor(() => {
    expect(window.location.pathname).toBe('/workspace/work')
  })
  expect(await screen.findByRole('heading', { name: 'Work' })).toBeVisible()
  act(() => {
    window.history.forward()
  })
  await waitFor(() => {
    expect(window.location.pathname).toBe('/overview')
  })
  expect(await screen.findByText('Legacy overview')).toBeVisible()
})
it('waits for identity, retains sign-in, and gives readers an admitted workspace', async () => {
  state.loading = true
  const view = render(<App />)
  expect(window.location.pathname).toBe('/')
  state.loading = false
  state.needsSignIn = true
  view.rerender(<App />)
  expect(window.location.pathname).toBe('/')
  expect(screen.queryByRole('heading', { name: 'Work' })).not.toBeInTheDocument()
  state.needsSignIn = false
  state.role = 'reader'
  view.rerender(<App />)
  expect(await screen.findByText('Reader workspace')).toBeVisible()
  expect(window.location.pathname).toBe('/workspace/operate')
})
it('preserves prompt drafts across compatibility and lens links, but retires them on owner change', async () => {
  window.history.replaceState({}, '', '/prompts?conversation=existing')
  const view = render(<App />)
  const field = await screen.findByRole('textbox', { name: 'Role / Title' })
  fireEvent.change(field, { target: { value: 'Private draft' } })
  fireEvent.click(screen.getByRole('link', { name: 'Investigation' }))
  visit('/prompts?conversation=existing')
  expect(await screen.findByRole('textbox', { name: 'Role / Title' })).toHaveValue('Private draft')
  expect(window.location.search).toContain('conversation=existing')
  act(() => {
    navigateWorkspace('/prompts', 'admin')
  })
  expect(screen.getByRole('textbox', { name: 'Role / Title' })).toHaveValue('Private draft')
  state.tenant = 'b'
  view.rerender(<App />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Role / Title' })).toHaveValue('Original'))
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('refuses unauthorized compatibility links before mounting prompt authoring', async () => {
  state.role = 'user'
  window.history.replaceState({}, '', '/prompts')
  render(<App />)
  expect(await screen.findByText('Insufficient role')).toBeVisible()
  expect(window.location.pathname).toBe('/prompts')
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/prompts'))).toBe(false)
})
it.each(['/prompts?lens=investigation', '/?conversation=a&conversation=b', '/prompts?draft=private'])(
  'retains malformed context and refuses instead of silently repairing %s',
  async (path) => {
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(await screen.findByText('This Work destination is invalid. Return to Work to continue.')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Role / Title' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  },
)

// spec: WEBUI-DESIGN-R002.1, WEBUI-APPS-R049.1.2
it('selects the real frame Work branch after entry while retaining an inert fragment', async () => {
  window.history.replaceState({}, '', '/#context')
  render(<App />)
  await screen.findByRole('heading', { name: 'Work' })
  fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
  const map = screen.getByRole('complementary', { name: 'Workspace map' })
  expect(
    within(map)
      .getAllByRole('link', { name: 'Work' })
      .some((link) => link.getAttribute('aria-current') === 'location'),
  ).toBe(true)
  expect(window.location.pathname + window.location.hash).toBe('/workspace/work#context')
})
it('retains the real editor DOM across frame presentation and compatibility navigation', async () => {
  window.history.replaceState({}, '', '/prompts')
  render(<App />)
  const field = await screen.findByRole('textbox', { name: 'Role / Title' })
  fireEvent.change(field, { target: { value: 'Retained in the real frame' } })
  const length = window.history.length
  fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
  fireEvent.click(screen.getByRole('button', { name: 'Focus current task' }))
  expect(screen.getByRole('region', { name: 'Current workspace task' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
  const map = screen.getByRole('complementary', { name: 'Workspace map' })
  fireEvent.click(within(map).getByRole('button', { name: 'List' }))
  fireEvent.click(within(map).getByRole('button', { name: 'Map' }))
  expect(window.history.length).toBe(length)
  visit('/prompts')
  expect(await screen.findByRole('textbox', { name: 'Role / Title' })).toBe(field)
  expect(field).toHaveValue('Retained in the real frame')
  expect(screen.getByRole('complementary', { name: 'Workspace map' })).toBe(map)
})
