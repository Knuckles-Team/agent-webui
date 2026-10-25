// spec: WEBUI-APPS-R045, WEBUI-APPS-R049, WEBUI-APPS-R049.1.2, WEBUI-APPS-R049.1.3
import { useEffect, useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import { navigateWorkspace } from '@/lib/workspace-navigation'
import { isWorkConversationLanding } from '@/lib/work-workspace'
const state = vi.hoisted(() => ({
  mounts: 0,
  role: 'admin',
  needsSignIn: false,
  loading: false,
  tenant: 'a',
  conversations: [],
}))
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
vi.mock('@/components/views/GraphView', () => ({ default: () => <p>Legacy graph reader and editor</p> }))
vi.mock('@/components/views/WorkflowEditorView', () => ({ default: () => <p>Legacy workflow page</p> }))
vi.mock('@/components/views/UsageView', () => ({ default: () => <p>Legacy usage page</p> }))
vi.mock('@/Chat', () => ({
  default: function ChatFixture() {
    const [draft, setDraft] = useState('')
    useEffect(() => {
      state.mounts += 1
    }, [])
    return (
      <textarea
        id="chat-message-input"
        aria-label="Message input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
      />
    )
  },
}))
vi.mock('@/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/PageHead', () => ({ PageHead: () => null }))
vi.mock('@/lib/mcp-context', () => ({ MCPProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/webmcp/provider', () => ({
  WebMcpProvider: ({ children }: { children: ReactNode }) => children,
  WorkspaceWebMcpControl: () => null,
  useWebMcpToolSet: vi.fn(),
}))
// Entry/history assertions exercise the real route after its code is available.
// Cold module transformation is not part of the DOM query's readiness contract.
beforeAll(async () => {
  await import('@/components/workspace/WorkWorkspace')
})
beforeEach(() => {
  state.mounts = 0
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
  const heading = await screen.findByRole('heading', { name: 'Tasks and conversations' })
  expect(heading).toBeVisible()
  expect(heading.closest('.workspace-route-content')).toHaveAttribute('data-workspace-route', 'workspace.work-proof')
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    '/workspace/work?conversation=existing#context',
  )
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ retained: true })
  expect(screen.queryByText('Legacy overview')).not.toBeInTheDocument()
})
it('restores the replaced Work entry through native Back and Forward', async () => {
  window.history.replaceState({ retained: true }, '', '/?conversation=existing#context')
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Tasks and conversations' })).toBeVisible()
  visit('/overview')
  expect(await screen.findByText('Legacy overview')).toBeVisible()
  act(() => {
    window.history.back()
  })
  await waitFor(() => {
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/workspace/work?conversation=existing#context',
    )
  })
  expect(window.history.state).toEqual({ retained: true })
  expect(await screen.findByRole('heading', { name: 'Tasks and conversations' })).toBeVisible()
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
  expect(screen.queryByRole('heading', { name: 'Tasks and conversations' })).not.toBeInTheDocument()
  state.needsSignIn = false
  state.role = 'reader'
  view.rerender(<App />)
  expect(await screen.findByText('Reader workspace')).toBeVisible()
  expect(screen.getByText('Reader workspace').closest('.workspace-route-content')).toHaveAttribute(
    'data-workspace-route',
    'workspace.operate',
  )
  expect(window.location.pathname).toBe('/workspace/operate')
})
it('preserves prompt drafts across compatibility and lens links, but retires them on owner change', async () => {
  window.history.replaceState({}, '', '/prompts?conversation=existing')
  const view = render(<App />)
  const field = await screen.findByRole('textbox', { name: 'Role / Title' })
  fireEvent.change(field, { target: { value: 'Private draft' } })
  fireEvent.click(screen.getByRole('link', { name: 'Task details' }))
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
  await screen.findByRole('heading', { name: 'Tasks and conversations' })
  fireEvent.click(screen.getByRole('button', { name: 'Skip to navigation' }))
  const map = screen.getByRole('complementary', { name: 'Workspace map' })
  expect(
    within(map)
      .getAllByRole('link', { name: 'Chat & tasks' })
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
  fireEvent.click(screen.getByRole('button', { name: 'Skip to navigation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide workspace navigation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip to content' }))
  expect(screen.getByRole('region', { name: 'Current workspace task' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Skip to navigation' }))
  const map = screen.getByRole('complementary', { name: 'Workspace map' })
  fireEvent.click(within(map).getByRole('button', { name: 'List' }))
  fireEvent.click(within(map).getByRole('button', { name: 'Tree' }))
  expect(window.history.length).toBe(length)
  visit('/prompts')
  expect(await screen.findByRole('textbox', { name: 'Role / Title' })).toBe(field)
  expect(field).toHaveValue('Retained in the real frame')
  expect(screen.getByRole('complementary', { name: 'Workspace map' })).toBe(map)
})

// spec: WEBUI-APPS-R049.1.14, WEBUI-APPS-R049.1.15, WEBUI-APPS-R049.1.16
it('redirects admitted workflows into the native in-memory editor without mounting the legacy page', async () => {
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input).endsWith('/workflows')
      ? Response.json([{ id: 'workflow:demo', name: 'Demo', steps: ['Check'], orchestrates: [] }])
      : Response.json({ detail: 'Unavailable' }, { status: 501 }),
  )
  window.history.replaceState({ retained: true }, '', '/workflows?conversation=kept&workflow=workflow%3Ademo')
  const length = window.history.length
  render(<App />)
  const name = await screen.findByRole('textbox', { name: 'workflow name' })
  await waitFor(() => expect(name).toHaveValue('Demo'))
  expect(window.location.pathname).toBe('/workspace/work')
  expect(new URLSearchParams(window.location.search).get('lens')).toBe('workflows')
  expect(new URLSearchParams(window.location.search).get('conversation')).toBe('kept')
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ retained: true })
  expect(screen.queryByText('Legacy workflow page')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('redirects admitted usage into Operate with retained session context', async () => {
  state.role = 'user'
  window.history.replaceState({}, '', '/usage?usageSession=session-a&usageDetail=timeline')
  const length = window.history.length
  render(<App />)
  expect(await screen.findByText('Reader workspace')).toBeVisible()
  expect(window.location.pathname + window.location.search).toBe(
    '/workspace/operate?usageSession=session-a&usageDetail=timeline&lens=usage',
  )
  expect(window.history.length).toBe(length)
  expect(screen.queryByText('Legacy usage page')).not.toBeInTheDocument()
})
it.each([
  ['/workflows', 'maintainer', 'Legacy workflow page'],
  ['/usage', 'reader', 'Legacy usage page'],
])('retains the source admission boundary for %s', async (path, role, legacy) => {
  state.role = role
  window.history.replaceState({}, '', path)
  render(<App />)
  expect(await screen.findByText('Insufficient role')).toBeVisible()
  expect(window.location.pathname).toBe(path)
  expect(screen.queryByText(legacy)).not.toBeInTheDocument()
  // The shell may read public host information, but no protected feature data.
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === '/api/enhanced/info')).toBe(true)
})
it('retains the legacy reader-admitted graph route rather than redirecting away unmigrated features', async () => {
  state.role = 'reader'
  window.history.replaceState({}, '', '/graph')
  render(<App />)
  expect(await screen.findByText('Legacy graph reader and editor')).toBeVisible()
  expect(window.location.pathname).toBe('/graph')
})
// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3, WEBUI-APPS-R049.2.1
it('shows the existing composer on entry without disclosure and retains its draft across contexts', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: 'Tasks and conversations' })
  const input = screen.getByRole('textbox', { name: 'Message input' })
  expect(input).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Chat & tasks' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Expand chat' })).not.toBeInTheDocument()
  expect(screen.getByText('Tasks and conversations').closest('details')).not.toHaveAttribute('open')
  expect(document.querySelector('.workspace-chat-layout')).toHaveAttribute('data-conversation-first', 'true')
  fireEvent.change(input, { target: { value: 'Keep my unsent request' } })
  visit('/workspace/operate')
  expect(await screen.findByText('Reader workspace')).toBeVisible()
  expect(input).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Expand chat' })).toBeVisible()
  visit('/workspace/work')
  await screen.findByRole('heading', { name: 'Tasks and conversations' })
  expect(screen.getByRole('textbox', { name: 'Message input' })).toBe(input)
  expect(input).toBeVisible()
  expect(input).toHaveValue('Keep my unsent request')
  expect(state.mounts).toBe(1)
})

// spec: WEBUI-APPS-R049.1.3
it.each([
  '/workspace/work?task=task-a',
  '/workspace/work?run=trace-a',
  '/workspace/work?run=trace-a&node=node-a',
  '/workspace/work?lens=prompts',
  '/workspace/work?lens=workflows',
  '/workspace/work?conversation=a&conversation=b',
])('does not let the primary Chat hide the intended inspection or editor at %s', (location) => {
  expect(isWorkConversationLanding(location)).toBe(false)
})

// spec: WEBUI-APPS-R049.2.1
it('keeps privacy out of the workspace until Settings is opened without changing consent', async () => {
  state.role = 'user'
  render(<App />)
  await screen.findByRole('heading', { name: 'Tasks and conversations' })
  expect(screen.queryByRole('complementary', { name: 'Privacy consent' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Privacy settings' })).not.toBeVisible()
  expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
  expect(localStorage.getItem('agent-webui.consent')).toBeNull()
  fireEvent.click(screen.getByText('Settings'))
  expect(screen.getByRole('region', { name: 'Privacy settings' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Disable optional' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Privacy policy and details' })).toHaveAttribute('href', '/privacy')
  expect(localStorage.getItem('agent-webui.consent')).toBeNull()
})

// spec: WEBUI-APPS-R049.2.1
it.each(['/overview', '/contact'])(
  'does not mount automatic privacy consent on retained or public route %s',
  async (path) => {
    window.history.replaceState({}, '', path)
    render(<App />)
    if (path === '/overview') {
      expect(await screen.findByText('Legacy overview')).toBeVisible()
      expect(screen.getByText('Settings').closest('details')).not.toHaveAttribute('open')
    } else {
      await screen.findByRole('heading', { name: 'Contact the service owner' })
    }
    expect(screen.queryByRole('complementary', { name: 'Privacy consent' })).not.toBeInTheDocument()
    expect(localStorage.getItem('agent-webui.consent')).toBeNull()
  },
)
