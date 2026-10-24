// spec: WEBUI-APPS-R049.1.3
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { PageContextProvider, usePageContextEnvelope } from '@/lib/page-context'
import { PublicPageContextSchema, toPublicPageContext } from '@/lib/webmcp/contracts'
import { parseBoundedWebMcpOutput } from '@/lib/webmcp/validation'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { navigateWork, parseWorkState, workApi, workHref } from '@/lib/work-workspace'
import { useConversations } from '@/lib/chat-store'
import WorkWorkspace from '../WorkWorkspace'
const state = vi.hoisted(() => ({
  tools: [] as WebMcpToolDefinition[],
  role: 'user',
  loading: false,
  tenant: 'tenant-a',
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { userKey: 'user-a', role: state.role, needsSignIn: false, raw: { tenant: state.tenant } },
    loading: state.loading,
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({
  ...(await original<object>()),
  useConversations: vi.fn(() => [{ id: 'conversation-a', firstMessage: 'Investigate issue', timestamp: 1 }]),
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: function captureNavigation(tools: WebMcpToolDefinition[]) {
    // This suite inspects navigation; task review has its own mounted coverage.
    if (tools.some((tool) => tool.name === 'agent-webui.work.select')) state.tools = tools
  },
}))
vi.mock('@/lib/work-workspace', async (original) => ({
  ...(await original<object>()),
  workApi: {
    listTasks: vi.fn(async () => [{ id: 'task-a' }]),
    getTask: vi.fn(async () => ({ id: 'task-a', status: { state: 'working' } })),
    listRuns: vi.fn(async () => ({
      ok: true,
      unavailable: false,
      data: { result: [{ id: 'trace-a', name: 'Recorded trace' }] },
    })),
    getRun: vi.fn(async () => ({
      ok: true,
      unavailable: false,
      data: {
        result: {
          trace: { id: 'trace-a' },
          nodes: [{ id: 'node-a', parentId: null, kind: 'span', name: 'Recorded span' }],
        },
      },
    })),
  },
}))
function Probe() {
  const context = usePageContextEnvelope()
  parseBoundedWebMcpOutput(PublicPageContextSchema, toPublicPageContext(context))
  return <output aria-label="Selected evidence">{context.selection.map((entry) => entry.id).join(',')}</output>
}
function mount() {
  return renderWithProviders(
    <PageContextProvider route="/workspace/work" view="workspace.work-proof">
      <WorkWorkspace />
      <Probe />
    </PageContextProvider>,
  )
}
beforeEach(() => {
  window.history.replaceState({}, '', '/workspace/work')
  localStorage.clear()
  state.role = 'user'
  state.loading = false
  state.tenant = 'tenant-a'
  state.tools = []
  vi.clearAllMocks()
})
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})
describe('retained Work composition', () => {
  it('uses the same tenant-scoped conversation owner as the retained assistant', () => {
    const view = mount()
    expect(useConversations).toHaveBeenLastCalledWith(JSON.stringify(['owner-v1', 'tenant-a', 'user-a']))
    view.unmount()
    state.tenant = 'tenant-b'
    mount()
    expect(useConversations).toHaveBeenLastCalledWith(JSON.stringify(['owner-v1', 'tenant-b', 'user-a']))
  })
  it('selects a conversation and inspects independent task/trace/node contract fixtures', async () => {
    mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Available conversation' }), {
      target: { value: 'conversation-a' },
    })
    expect(await screen.findByText('Active: /conversation-a')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('link', { name: 'task-a' }))
    await screen.findByText('Status: working')
    fireEvent.click(await screen.findByRole('link', { name: 'Recorded trace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Recorded span · span' }))
    expect(await screen.findByText('Not reported')).toBeInTheDocument()
    expect(screen.getByLabelText('Selected evidence')).toHaveTextContent('node-a')
    expect(parseWorkState(window.location.href)).toEqual({
      conversation: 'conversation-a',
      task: 'task-a',
      run: 'trace-a',
      node: 'node-a',
    })
    expect(screen.getByText(/Conversation-to-run association is unavailable/)).toBeInTheDocument()
    act(() => {
      window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&task=task-a')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('heading', { name: 'Work' })).toHaveFocus()
    expect(screen.getByLabelText('Selected evidence')).toHaveTextContent('task-a')
  })
  it('follows a loaded parent and returns to the trace without losing conversation or task', async () => {
    vi.mocked(workApi.getRun).mockResolvedValueOnce({
      ok: true,
      unavailable: false,
      data: {
        result: {
          trace: { id: 'trace-a' },
          nodes: [
            { id: 'node-a', parentId: 'parent-a', name: 'Child' },
            { id: 'parent-a', parentId: null, name: 'Parent' },
          ],
        },
      },
    })
    window.history.replaceState(
      {},
      '',
      '/workspace/work?conversation=conversation-a&task=task-a&run=trace-a&node=node-a',
    )
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect recorded parent' }))
    expect(parseWorkState(window.location.href)).toEqual({
      conversation: 'conversation-a',
      task: 'task-a',
      run: 'trace-a',
      node: 'parent-a',
    })
    expect(screen.queryByRole('button', { name: 'Inspect recorded parent' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to trace' }))
    expect(parseWorkState(window.location.href)).toEqual({
      conversation: 'conversation-a',
      task: 'task-a',
      run: 'trace-a',
      node: null,
    })
    expect(screen.getByLabelText('Selected evidence')).toHaveTextContent('trace-a')
  })
  it('withdraws stale evidence on failed refresh and restores matching detail on retry', async () => {
    window.history.replaceState({}, '', '/workspace/work?run=trace-a&node=node-a')
    mount()
    await screen.findByRole('button', { name: 'Recorded span · span' })
    vi.mocked(workApi.getRun).mockRejectedValueOnce(new Error('Access lost'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh selected trace' }))
    await screen.findByText(/Selected trace could not be loaded/)
    expect(screen.queryByRole('button', { name: 'Recorded span · span' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Selected evidence').textContent).toBe('')
    })
    await expect(
      state.tools[0].execute(
        { conversation: null, task: null, run: 'trace-a', node: 'node-a' },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('outside')
    fireEvent.click(screen.getByRole('button', { name: 'Retry detail' }))
    await screen.findByRole('button', { name: 'Recorded span · span' })
    await waitFor(() => expect(screen.getByLabelText('Selected evidence')).toHaveTextContent('node-a'))
    expect(workApi.getRun).toHaveBeenCalledTimes(3)
  })
  it('withdraws cached task links after a failed list refresh', async () => {
    mount()
    await screen.findByRole('link', { name: 'task-a' })
    vi.mocked(workApi.listTasks).mockRejectedValueOnce(new Error('Denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }))
    await screen.findByText('Task listing failed. Refresh to retry.')
    expect(screen.queryByRole('link', { name: 'task-a' })).not.toBeInTheDocument()
    await expect(
      state.tools[0].execute(
        { conversation: null, task: 'task-a', run: null, node: null },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('outside')
  })
  it('shares known-target authority with tools and refuses unknown task/node targets', async () => {
    mount()
    await screen.findByRole('link', { name: 'task-a' })
    await act(async () => {
      await state.tools[0].execute(
        { conversation: 'conversation-a', task: 'task-a', run: null, node: null },
        { signal: new AbortController().signal },
      )
    })
    await screen.findByText('Status: working')
    await expect(
      state.tools[0].execute(
        { conversation: null, task: 'unknown', run: null, node: null },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('outside')
  })
  it('rejects returned task and trace identities that differ from the requested selection', async () => {
    vi.mocked(workApi.getTask).mockResolvedValueOnce({ id: 'wrong-task' })
    vi.mocked(workApi.getRun).mockResolvedValueOnce({
      ok: true,
      unavailable: false,
      data: { result: { trace: { id: 'wrong-trace' }, nodes: [{ id: 'wrong-node' }] } },
    })
    window.history.replaceState({}, '', '/workspace/work?task=task-a&run=trace-a')
    mount()
    await screen.findByText(/Task detail could not be loaded/)
    await screen.findByText(/Selected trace could not be loaded/)
    expect(screen.getByLabelText('Selected evidence').textContent).toBe('')
    expect(screen.queryByRole('button', { name: /wrong-node/ })).not.toBeInTheDocument()
  })

  it('acknowledges maximal multibyte selection without failing after committed navigation', async () => {
    const large = '界'.repeat(256)
    vi.mocked(workApi.getTask).mockResolvedValueOnce({ id: large })
    vi.mocked(workApi.getRun).mockResolvedValueOnce({
      ok: true,
      unavailable: false,
      data: { result: { trace: { id: large }, nodes: [{ id: large, name: 'Long node' }] } },
    })
    const selected = { conversation: large, task: large, run: large, node: null }
    window.history.replaceState({}, '', workHref(selected))
    mount()
    await screen.findByRole('button', { name: 'Long node' })
    await act(async () => {
      expect(
        await state.tools[0].execute({ ...selected, node: large }, { signal: new AbortController().signal }),
      ).toEqual({ selected: true })
    })
    expect(parseWorkState(window.location.href).node).toBe(large)
  })

  it('projects complete Unicode code points through the public context boundary', async () => {
    const conversation = '/' + '😀'.repeat(32)
    window.history.replaceState({}, '', workHref({ conversation, task: null, run: null, node: null }))
    mount()
    expect(await screen.findByText(`Active: ${conversation}`)).toBeInTheDocument()
  })

  it('preserves explicit unavailable trace capability instead of inventing an empty result', async () => {
    vi.mocked(workApi.listRuns).mockResolvedValueOnce({ ok: false, unavailable: true, data: null })
    mount()
    expect(await screen.findByText('Trace inspection is not activated on this backend.')).toBeInTheDocument()
    expect(screen.queryByText('No execution traces were returned.')).not.toBeInTheDocument()
  })
  it('does not read protected task or trace data before identity is resolved or permitted', () => {
    state.loading = true
    const view = mount()
    expect(screen.getByText('Checking Work access…')).toBeInTheDocument()
    expect(workApi.listTasks).not.toHaveBeenCalled()
    view.unmount()
    state.loading = false
    state.role = 'reader'
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    expect(workApi.listRuns).not.toHaveBeenCalled()
  })
})
describe('typed Work destinations', () => {
  it('round trips identifiers safely and rejects malformed state before history mutation', () => {
    const selected = { conversation: '/conversation', task: '../task#x', run: 'trace?x', node: 'node' }
    expect(parseWorkState(workHref(selected))).toEqual(selected)
    const push = vi.spyOn(window.history, 'pushState')
    expect(() => navigateWork({ ...selected, run: null }, 'user')).toThrow()
    expect(() => parseWorkState('/workspace/work?task=a&task=b')).toThrow()
    expect(() => navigateWork(selected, 'reader')).toThrow()
    expect(() => navigateWork({ ...selected, conversation: '\ud800' }, 'user')).toThrow()
    expect(push).not.toHaveBeenCalled()
  })
})
