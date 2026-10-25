// spec: WEBUI-APPS-R049.1.3, WEBUI-APPS-R004.4, WEBUI-APPS-R049.1.15
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { PageContextProvider, usePageContextEnvelope } from '@/lib/page-context'
import { PublicPageContextSchema, toPublicPageContext } from '@/lib/webmcp/contracts'
import { parseBoundedWebMcpOutput } from '@/lib/webmcp/validation'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { ApiError } from '@/lib/api-validation'
import { api } from '@/lib/api'
import { readCurrentPlan } from '@/lib/current-plan'
import { navigateWork, parseWorkState, workApi, workHref } from '@/lib/work-workspace'
import { useConversations } from '@/lib/chat-store'
import WorkWorkspace from '../WorkWorkspace'
const state = vi.hoisted(() => ({
  tools: [] as WebMcpToolDefinition[],
  role: 'user',
  loading: false,
  tenant: 'tenant-a',
}))
vi.mock('@/lib/current-plan', async (original) => ({
  ...(await original<object>()),
  readCurrentPlan: vi.fn(async () => ({ availability: 'unavailable', snapshot: null })),
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
function mount(expand = true) {
  const view = renderWithProviders(
    <PageContextProvider route="/workspace/work" view="workspace.work-proof">
      <WorkWorkspace />
      <Probe />
    </PageContextProvider>,
  )
  if (expand && screen.queryByText('Tasks and conversations')) {
    const summary = screen.getByText('Tasks and conversations').closest('summary')!
    if (!summary.closest('details')!.open) fireEvent.click(summary)
    const traces = screen.getByText('Technical traces')
    if (!traces.closest('details')!.open) fireEvent.click(traces)
  }
  return view
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
    expect(await screen.findByText('Current conversation selected')).toBeInTheDocument()
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
    expect(screen.getByText(/These technical records are not linked/)).toBeInTheDocument()
    act(() => {
      window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&task=task-a')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('heading', { name: 'Tasks and conversations' })).toHaveFocus()
    expect(screen.getByLabelText('Selected evidence')).toHaveTextContent('task-a')
  })
  it('reads only the selected task run metadata, never its independent trace URL or reference', async () => {
    vi.mocked(workApi.getTask).mockResolvedValueOnce({
      id: 'task-a',
      metadata: {
        arbora: {
          runId: 'authoritative-run',
          runTraceRef: 'trace-not-a-run',
        },
      },
    })
    window.history.replaceState({}, '', '/workspace/work?task=task-a&run=trace-a')
    mount()
    await screen.findByText('Current plan is not available for this run.')
    expect(readCurrentPlan).toHaveBeenCalledExactlyOnceWith('authoritative-run', expect.any(AbortSignal))
    expect(parseWorkState(window.location.href)).toMatchObject({ task: 'task-a', run: 'trace-a' })
    fireEvent.click(screen.getByRole('button', { name: 'All traces' }))
    expect(parseWorkState(window.location.href)).toMatchObject({ task: 'task-a', run: null })
    expect(readCurrentPlan).toHaveBeenCalledTimes(1)
  })
  it('retires the previous task plan request when selecting another task', async () => {
    vi.mocked(workApi.listTasks).mockResolvedValueOnce([{ id: 'task-a' }, { id: 'task-b' }])
    vi.mocked(workApi.getTask)
      .mockResolvedValueOnce({ id: 'task-a', metadata: { arbora: { runId: 'run-a' } } })
      .mockResolvedValueOnce({ id: 'task-b', metadata: { arbora: { runId: 'run-b' } } })
    let resolve!: (value: Awaited<ReturnType<typeof readCurrentPlan>>) => void
    vi.mocked(readCurrentPlan).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    window.history.replaceState({}, '', '/workspace/work?task=task-a')
    mount()
    await screen.findByText('Loading current plan…')
    const signal = vi.mocked(readCurrentPlan).mock.calls[0][1]
    fireEvent.click(await screen.findByRole('link', { name: 'task-b' }))
    await screen.findByText('Current plan is not available for this run.')
    expect(signal.aborted).toBe(true)
    expect(readCurrentPlan).toHaveBeenLastCalledWith('run-b', expect.any(AbortSignal))
    await act(async () => {
      resolve({
        availability: 'available',
        snapshot: {
          run_id: 'run-a',
          revision: 1,
          observed_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          items: [{ text: 'Retired task plan', status: 'pending' }],
        },
      })
    })
    expect(screen.queryByText('Retired task plan')).not.toBeInTheDocument()
    expect(parseWorkState(window.location.href).task).toBe('task-b')
  })
  it('does not manufacture a plan selector from a trace or missing task metadata', async () => {
    window.history.replaceState({}, '', '/workspace/work?task=task-a&run=trace-a')
    mount()
    await screen.findByText(/no valid run reference/)
    expect(readCurrentPlan).not.toHaveBeenCalled()
  })
  it('inspects only returned task output and keeps the conversation while refreshing', async () => {
    vi.mocked(workApi.getTask).mockResolvedValueOnce({
      id: 'task-a',
      status: { state: 'completed' },
      contextId: 'opaque-task-context',
      metadata: { arbora: { runId: 'opaque-run', runTraceRef: 'urn:trace:unresolved' } },
      artifacts: [
        {
          artifactId: 'reply-a',
          name: 'Recorded output',
          parts: [{ kind: 'text', text: '<script>untrusted output</script>' }],
        },
      ],
    })
    window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&task=task-a')
    mount()
    await screen.findByText('<script>untrusted output</script>')
    expect(screen.getByText('urn:trace:unresolved').closest('a')).toBeNull()
    expect(screen.getByText('opaque-task-context')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(parseWorkState(window.location.href).conversation).toBe('conversation-a')
    vi.mocked(workApi.getTask).mockRejectedValueOnce(new ApiError(403, 'Denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh task' }))
    await screen.findByText(/Task detail could not be loaded/)
    expect(screen.queryByText('<script>untrusted output</script>')).not.toBeInTheDocument()
  })
  it.each(['success', 'refusal', 'navigation'] as const)(
    'withdraws selected-task evidence during a deferred refresh: %s',
    async (outcome) => {
      const recorded = {
        id: 'task-a',
        status: { state: 'working' },
        contextId: 'old-context',
        artifacts: [{ artifactId: 'reply-a', parts: [{ kind: 'text', text: 'Old recorded output' }] }],
      }
      vi.mocked(workApi.getTask).mockResolvedValueOnce(recorded)
      window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&task=task-a')
      mount()
      await screen.findByText('Old recorded output')
      let resolve!: (value: typeof recorded) => void
      let reject!: (error: Error) => void
      const pending = new Promise<typeof recorded>((yes, no) => {
        resolve = yes
        reject = no
      })
      vi.mocked(workApi.getTask).mockReturnValueOnce(pending)
      const refresh = screen.getByRole('button', { name: 'Refresh task' })
      refresh.focus()
      await userEvent.setup().keyboard('{Enter}')
      await screen.findByText('Loading task…')
      expect(screen.getByRole('button', { name: 'Refresh task' })).toBe(refresh)
      expect(refresh).toHaveFocus()
      expect(screen.queryByText('Old recorded output')).not.toBeInTheDocument()
      expect(screen.queryByText('old-context')).not.toBeInTheDocument()
      expect(screen.queryByText('Status: working')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
      expect(parseWorkState(window.location.href).conversation).toBe('conversation-a')
      if (outcome === 'navigation') {
        vi.mocked(workApi.getTask).mockResolvedValueOnce({ id: 'task-b', status: { state: 'completed' } })
        await act(async () => {
          navigateWork({ conversation: 'conversation-a', task: 'task-b', run: null, node: null }, 'user')
        })
        await screen.findByText('Task task-b')
      }
      await act(async () => {
        if (outcome === 'refusal') reject(new ApiError(403, 'Denied'))
        else resolve({ ...recorded, contextId: 'renewed-context', artifacts: [] })
      })
      if (outcome === 'success') {
        await screen.findByText('renewed-context')
        expect(screen.getByRole('button', { name: 'Refresh task' })).toBe(refresh)
        expect(refresh).toHaveFocus()
        expect(screen.getByText('Status: working')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeEnabled()
      } else if (outcome === 'refusal') {
        await screen.findByText(/Task detail could not be loaded/)
        expect(screen.queryByRole('button', { name: 'Cancel task…' })).not.toBeInTheDocument()
      } else {
        expect(screen.getByText('Task task-b')).toBeInTheDocument()
        expect(screen.queryByText('renewed-context')).not.toBeInTheDocument()
      }
      expect(screen.queryByText('Old recorded output')).not.toBeInTheDocument()
      expect(screen.queryByText('old-context')).not.toBeInTheDocument()
    },
  )
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
  it('does not infer navigation to a recorded parent absent from the loaded trace', async () => {
    vi.mocked(workApi.getRun).mockResolvedValueOnce({
      ok: true,
      unavailable: false,
      data: {
        result: {
          trace: { id: 'trace-a' },
          nodes: [{ id: 'node-a', parentId: 'unloaded-parent', name: 'Child' }],
        },
      },
    })
    const selected = { conversation: 'conversation-a', task: 'task-a', run: 'trace-a', node: 'node-a' }
    window.history.replaceState({}, '', workHref(selected))
    mount()
    await screen.findByText('unloaded-parent')
    expect(screen.queryByRole('button', { name: 'Inspect recorded parent' })).not.toBeInTheDocument()
    expect(parseWorkState(window.location.href)).toEqual(selected)
    await expect(
      state.tools[0].execute({ ...selected, node: 'unloaded-parent' }, { signal: new AbortController().signal }),
    ).rejects.toThrow('outside')
    expect(parseWorkState(window.location.href)).toEqual(selected)
    fireEvent.click(screen.getByRole('button', { name: 'Back to trace' }))
    expect(parseWorkState(window.location.href)).toEqual({ ...selected, node: null })
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
    vi.mocked(workApi.listTasks).mockRejectedValueOnce(new ApiError(403, 'Denied'))
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
    expect(await screen.findByText('Current conversation selected')).toBeInTheDocument()
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

// The mounted Work surface consumes the contextual editor, never the old page.
it('keeps a workflow preview while inspecting the selected task without retargeting conversation', async () => {
  state.role = 'admin'
  vi.spyOn(api, 'listWorkflows').mockResolvedValue([
    { id: 'workflow:demo', name: 'Demo', steps: ['Check'], orchestrates: [] },
  ])
  vi.spyOn(api, 'listWorkflowCapabilities').mockResolvedValue({ agents: [], tools: [], skills: [] })
  const save = vi.spyOn(api, 'saveWorkflow')
  const run = vi.spyOn(api, 'runWorkflow')
  window.history.replaceState(
    {},
    '',
    '/workspace/work?conversation=conversation-a&task=task-a&lens=workflows&workflow=workflow%3Ademo',
  )
  mount()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Demo'))
  fireEvent.change(screen.getByRole('textbox', { name: 'workflow name' }), {
    target: { value: 'Retained local plan' },
  })
  fireEvent.click(screen.getByRole('link', { name: 'Inspect tasks and traces' }))
  await screen.findByRole('heading', { name: 'Task task-a' })
  expect(screen.queryByRole('region', { name: 'Workflow plan editor' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Workflow plans' }))
  expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Retained local plan')
  expect(screen.getByText('Current conversation selected')).toBeInTheDocument()
  expect(parseWorkState(window.location.href)).toMatchObject({
    conversation: 'conversation-a',
    task: 'task-a',
    workflow: 'workflow:demo',
  })
  expect(save).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})

// spec: WEBUI-APPS-R049.1.3, WEBUI-APPS-R049.2.1
it('keeps inspection secondary by default and opens real task deep links', async () => {
  const view = mount(false)
  expect(screen.getByText('Tasks and conversations').closest('details')).not.toHaveAttribute('open')
  act(() => {
    window.history.pushState({}, '', '/workspace/work?task=task-a')
    window.dispatchEvent(new Event('history-state-changed'))
  })
  expect(await screen.findByText('Status: working')).toBeVisible()
  expect(screen.getByText('Tasks and conversations').closest('details')).toHaveAttribute('open')
  expect(
    screen.getByText('Tasks you can access. They are not automatically linked to this conversation.'),
  ).toBeVisible()
  view.unmount()
})
