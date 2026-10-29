// spec: OVERSTORY-APPS-R049.1.13, OVERSTORY-API-R011.4
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { PageContextProvider } from '@/lib/page-context'
import { ApiError } from '@/lib/api-validation'
import { workApi } from '@/lib/work-workspace'
import fixture from '@/lib/__tests__/fixtures/execution-graph.json'
import WorkWorkspace from '../WorkWorkspace'

const state = vi.hoisted(() => ({ tenant: 'tenant-a', role: 'user', loading: false }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { userKey: 'user-a', role: state.role, needsSignIn: false, raw: { tenant: state.tenant } },
    loading: state.loading,
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({
  ...(await original<object>()),
  useConversations: () => [{ id: 'conversation-a', firstMessage: 'Retained root draft', timestamp: 1 }],
}))
vi.mock('@/lib/webmcp/provider', () => ({ useWebMcpToolSet: vi.fn() }))
vi.mock('@/lib/current-plan', async (original) => ({
  ...(await original<object>()),
  readCurrentPlan: vi.fn(async () => ({ availability: 'unavailable', snapshot: null })),
}))
vi.mock('@/lib/work-workspace', async (original) => ({
  ...(await original<object>()),
  workApi: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    listRuns: vi.fn(async () => ({ ok: true, data: { result: [] } })),
    getRun: vi.fn(async () => ({ ok: true, data: { result: { trace: { id: 'independent-trace' }, nodes: [] } } })),
  },
}))
function success(value: unknown = fixture) {
  return new Response(
    JSON.stringify({ ok: true, result: { value }, meta: { registry_digest: 'test-digest', api_version: 'v1' } }),
  )
}
function denied() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'FORBIDDEN', source: 'arbora', message: 'denied', retryable: false },
      meta: { registry_digest: 'test-digest', api_version: 'v1' },
    }),
    { status: 403 },
  )
}
let operation: ReturnType<typeof vi.fn<(...args: [RequestInit | undefined]) => Promise<Response>>>
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <PageContextProvider route="/workspace/work" view="workspace.work">
          {children}
        </PageContextProvider>
      </QueryClientProvider>
    )
  }
  return { user: userEvent.setup(), ...render(<WorkWorkspace />, { wrapper: Wrapper }) }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.tenant = 'tenant-a'
  state.role = 'user'
  state.loading = false
  window.history.replaceState(
    {},
    '',
    `/workspace/work?conversation=conversation-a&task=${fixture.task_id}&run=independent-trace`,
  )
  vi.mocked(workApi.listTasks).mockResolvedValue([{ id: fixture.task_id }, { id: 'task-two' }])
  vi.mocked(workApi.getTask).mockImplementation(async (taskId) => ({
    id: taskId,
    metadata: { arbora: { runId: taskId === fixture.task_id ? fixture.run_id : 'run-two', runTraceRef: 'not-a-run' } },
  }))
  operation = vi.fn(async () => success())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === '/auth/session')
        return new Response(JSON.stringify({ authenticated: true, csrf_token: 'test-token' }))
      if (url === '/api/v1/ops/runs.execution_graph') return operation(init)
      throw new Error(`Unexpected endpoint: ${String(url)}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('flat graph in the real Work selection path', () => {
  it('renders producer fan-out/fan-in with an accessible equivalent and preserves root conversation and trace', async () => {
    const { user } = mount()
    const list = await screen.findByRole('list', { name: 'Execution step dependency list' })
    expect(operation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: JSON.stringify({
          schema_version: 'arbora-execution-graph-v1',
          run_id: fixture.run_id,
          task_id: fixture.task_id,
        }),
      }),
    )
    expect(screen.getByText('Complete declared topology · Incomplete lifecycle evidence')).toBeInTheDocument()
    expect(screen.getByText(/not proof of completed execution/)).toBeInTheDocument()
    const join = within(list).getByText('join', { selector: 'summary span' }).closest('summary')!
    join.focus()
    expect(join).toHaveFocus()
    await user.click(join)
    expect(join.parentElement).toHaveAttribute('open')
    expect(within(join.parentElement!).getByText('left, right')).toBeInTheDocument()
    expect(screen.getByText('Current conversation selected')).toBeInTheDocument()
    expect(window.location.search).toContain('run=independent-trace')
    expect(
      screen.queryByRole('button', { name: /Message active child|Continue completed child/ }),
    ).not.toBeInTheDocument()
  })
  it('uses the authoritative task run even at the producer Unicode code-point bound', async () => {
    const value = structuredClone(fixture)
    value.run_id = '🌳'.repeat(512)
    const keys = new Map(
      value.snapshot.nodes.map((node) => [node.key, JSON.stringify([value.run_id, 'plan_step', node.task_id])]),
    )
    value.snapshot.nodes = value.snapshot.nodes.map((node) => ({ ...node, key: keys.get(node.key)! }))
    value.snapshot.edges = value.snapshot.edges.map((edge) => ({
      ...edge,
      source: keys.get(edge.source)!,
      target: keys.get(edge.target)!,
    }))
    vi.mocked(workApi.getTask).mockResolvedValueOnce({
      id: fixture.task_id,
      metadata: { arbora: { runId: value.run_id } },
    })
    operation.mockResolvedValueOnce(success(value))
    mount()
    await screen.findByRole('list', { name: 'Execution step dependency list' })
    expect(operation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: JSON.stringify({
          schema_version: 'arbora-execution-graph-v1',
          run_id: value.run_id,
          task_id: fixture.task_id,
        }),
      }),
    )
  })
  it('does not derive a run selector from trace IDs or missing task metadata', async () => {
    vi.mocked(workApi.getTask).mockResolvedValueOnce({
      id: fixture.task_id,
      metadata: { arbora: { runTraceRef: fixture.run_id } },
    })
    mount()
    await screen.findByText(/missing an authoritative run binding/)
    expect(operation).not.toHaveBeenCalled()
  })
  it('clears old evidence immediately on refresh and keeps it cleared after denial', async () => {
    mount()
    await screen.findByRole('list', { name: 'Execution step dependency list' })
    let resolve!: (value: Response) => void
    operation.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh execution graph' }))
    expect(screen.queryByRole('list', { name: 'Execution step dependency list' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(operation).toHaveBeenCalledTimes(2)
    })
    await act(async () => {
      resolve(denied())
    })
    await screen.findByText('Execution graph access was denied.')
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(2)
  })
  it('withdraws graph evidence when the selected task refresh loses access', async () => {
    mount()
    await screen.findByRole('list', { name: 'Execution step dependency list' })
    let reject!: (reason: unknown) => void
    vi.mocked(workApi.getTask).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh task' }))
    await screen.findByText('Loading task…')
    expect(screen.queryByRole('list', { name: 'Execution step dependency list' })).not.toBeInTheDocument()
    await act(async () => {
      reject(new ApiError(403, 'Denied'))
    })
    await screen.findByText(/Task detail could not be loaded/)
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(1)
  })
  it('aborts older selections and ignores a late successful response', async () => {
    let resolve!: (value: Response) => void
    operation.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    mount()
    await waitFor(() => {
      expect(operation).toHaveBeenCalledTimes(1)
    })
    const signal = operation.mock.calls[0][0]!.signal!
    operation.mockResolvedValueOnce(
      success({ ...fixture, run_id: 'run-two', task_id: 'task-two', availability: 'unavailable', snapshot: null }),
    )
    fireEvent.click(await screen.findByRole('link', { name: 'task-two' }))
    await screen.findByText('Execution graph is unavailable for this run.')
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(success())
    })
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    expect(window.location.search).toContain('task=task-two')
    expect(screen.getByText('Current conversation selected')).toBeInTheDocument()
  })
  it('retires protected graph data when the observed identity changes', async () => {
    const view = mount()
    await screen.findByRole('list', { name: 'Execution step dependency list' })
    operation.mockResolvedValueOnce(denied())
    state.tenant = 'tenant-b'
    view.rerender(<WorkWorkspace />)
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    await screen.findByText('Execution graph access was denied.')
  })
  it.each([
    [
      'malformed',
      () => success({ ...fixture, schema_version: 'future' }),
      'Execution graph could not be loaded or validated. Refresh to retry.',
    ],
    [
      'unavailable',
      () => success({ ...fixture, availability: 'unavailable', snapshot: null }),
      'Execution graph is unavailable for this run.',
    ],
    ['absent', () => new Response('Not found', { status: 404 }), 'Execution graph is unavailable on this backend.'],
  ])('renders %s distinctly without falling back', async (_name, response, message) => {
    operation.mockResolvedValueOnce(response())
    mount()
    await screen.findByText(message)
    expect(screen.queryByRole('list', { name: 'Execution step dependency list' })).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(1)
  })
  it('renders hostile labels as text and states partial coverage without implying pending work', async () => {
    const value = structuredClone(fixture)
    value.snapshot.nodes[1].task_id = '<img src=x onerror=alert(1)>'
    const oldKey = value.snapshot.nodes[1].key
    const key = JSON.stringify([value.run_id, 'plan_step', value.snapshot.nodes[1].task_id])
    value.snapshot.nodes[1].key = key
    value.snapshot.edges = value.snapshot.edges.map((edge) => ({
      ...edge,
      source: edge.source === oldKey ? key : edge.source,
      target: edge.target === oldKey ? key : edge.target,
    }))
    value.snapshot.has_more = true
    operation.mockResolvedValueOnce(success(value))
    mount()
    await screen.findByRole('list', { name: 'Execution step dependency list' })
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(/More evidence is available beyond this snapshot/)).toBeInTheDocument()
    expect(screen.getByText(/not queued or completed/)).toBeInTheDocument()
  })
  it('does not read before admission or after role withdrawal', async () => {
    state.loading = true
    const view = mount()
    expect(operation).not.toHaveBeenCalled()
    state.loading = false
    state.role = 'reader'
    view.rerender(<WorkWorkspace />)
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    expect(operation).not.toHaveBeenCalled()
  })
})
