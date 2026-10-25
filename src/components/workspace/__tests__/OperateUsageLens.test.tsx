// spec: WEBUI-APPS-R049.1.16
import { useState } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { api, ApiError, type UsageSessionDetail, type UsageSummary } from '@/lib/api'
import { navigateOperate, parseOperateState } from '@/lib/operate-workspace'
import OperateWorkspace from '../OperateWorkspace'
const identity = vi.hoisted(() => ({
  userKey: 'a',
  role: 'admin',
  needsSignIn: false,
  raw: { tenant: 'tenant-a', csrf_token: 'session-a', roles: ['usage:read'] },
}))
vi.mock('@/lib/auth', () => ({ useIdentity: () => ({ identity, loading: false }) }))
vi.mock('@/lib/webmcp/provider', () => ({ useWebMcpToolSet: vi.fn() }))
vi.mock('../OperateReadinessPanel', () => ({ OperateReadinessPanel: () => <p>Readiness checks</p> }))
vi.mock('@/lib/operate-catalog', () => ({
  readOperateCatalog: vi.fn(async () => ({ source: 'epistemic_graph', servers: [], components: [] })),
}))
vi.mock('@/lib/operate-workspace', async (original) => ({
  ...(await original<object>()),
  operateApi: {
    status: vi.fn(async () => ({ value: { children: { source: { state: 'running' } } } })),
    catalog: vi.fn(async () => ({ value: { items: [], next_cursor: null } })),
  },
}))
const summary: UsageSummary = {
  session_count: 1,
  totals: {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 7,
  },
  cache_hit_rate: 0,
}
const detail: UsageSessionDetail = {
  session: {
    id: 'session-one',
    project: 'Selected project',
    agent: 'agent-one',
    message_count: 1,
    total_output_tokens: 20,
    cost_usd: 7,
    outcome: 'complete',
    origin: 'runtime',
  },
  messages: [
    {
      ordinal: 1,
      role: 'user',
      content: 'Visible session message',
      model: 'model-one',
      context_tokens: 10,
      output_tokens: 20,
      has_tool_use: true,
    },
  ],
  tool_calls: [{ tool_name: 'read', category: 'tool', status: 'success' }],
  usage_events: [{ model: 'model-one', input_tokens: 10, output_tokens: 20, cost_usd: 7 }],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function current() {
  return parseOperateState(window.location.pathname + window.location.search)
}
function Harness() {
  const [, render] = useState(0)
  return (
    <>
      <button
        onClick={() => {
          render((value) => value + 1)
        }}
      >
        Update identity
      </button>
      <OperateWorkspace />
    </>
  )
}
beforeEach(() => {
  Object.assign(identity, {
    userKey: 'a',
    role: 'admin',
    needsSignIn: false,
    raw: { tenant: 'tenant-a', csrf_token: 'session-a', roles: ['usage:read'] },
  })
  window.history.replaceState({}, '', '/workspace/operate?lens=usage&server=source&q=sou')
  vi.spyOn(api, 'getUsageSummary').mockResolvedValue(summary)
  vi.spyOn(api, 'getUsageByModel').mockResolvedValue([
    { key: 'model-one', session_count: 1, input_tokens: 10, output_tokens: 20, cost_usd: 7 },
  ])
  vi.spyOn(api, 'getUsageByProject').mockResolvedValue([])
  vi.spyOn(api, 'getUsageByAgent').mockResolvedValue([])
  vi.spyOn(api, 'getUsageTools').mockResolvedValue([
    { name: 'read', category: 'tool', calls: 1, success: 1, success_rate: 1 },
  ])
  vi.spyOn(api, 'getUsageActivity').mockResolvedValue([{ day_of_week: 0, hour: 9, sessions: 1, cost_usd: 7 }])
  vi.spyOn(api, 'getUsageTopSessions').mockResolvedValue([detail.session])
  vi.spyOn(api, 'getUsageSessionDetail').mockResolvedValue(detail)
  vi.spyOn(api, 'getUsageSearch').mockResolvedValue([
    {
      session_id: 'session-one',
      ordinal: 1,
      role: 'user',
      snippet: 'Matched message',
      agent: 'agent-one',
      project: 'Selected project',
    },
  ])
  vi.spyOn(api, 'getUsageTraces').mockResolvedValue({
    enabled: true,
    host: 'https://traces.example',
    traces: [{ session_id: 'session-one', project: 'Selected project', url: 'https://traces.example/session-one' }],
  })
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})
describe('Operate contextual usage', () => {
  it('retains fleet, filter, session and timeline across lenses and history events', async () => {
    const { user } = renderWithProviders(<OperateWorkspace />)
    await screen.findByText('model-one')
    await user.click(screen.getByText('Usage filters', { selector: 'summary' }))
    await user.type(screen.getByLabelText('Project'), 'project-one')
    await user.click(screen.getByRole('button', { name: 'Apply usage filters' }))
    await waitFor(() => {
      expect(api.getUsageSummary).toHaveBeenLastCalledWith(expect.objectContaining({ project: 'project-one' }))
    })
    await user.click(screen.getByRole('tab', { name: 'Sessions' }))
    await user.click(await screen.findByRole('button', { name: 'Open session Selected project' }))
    await screen.findByRole('article', { name: 'Usage session detail' })
    await user.click(screen.getByRole('button', { name: 'Session timeline' }))
    await screen.findByText('Visible session message')
    expect(screen.getByRole('heading', { name: 'Usage & cost analysis' })).toHaveFocus()
    const timelineUrl = window.location.pathname + window.location.search
    await user.click(screen.getByRole('link', { name: 'Health' }))
    expect(screen.getByText('Readiness checks')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Services' }))
    expect(await screen.findByRole('link', { name: 'source' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Filter fleet children' })).toHaveValue('sou')
    await user.click(screen.getByRole('link', { name: 'Usage' }))
    expect(await screen.findByText('Visible session message')).toBeVisible()
    expect(current()).toMatchObject({
      server: 'source',
      q: 'sou',
      usageProject: 'project-one',
      usageSession: 'session-one',
      usageDetail: 'timeline',
    })
    await user.click(screen.getByRole('button', { name: 'Back to usage results' }))
    expect(await screen.findByRole('table', { name: 'Usage sessions' })).toBeVisible()
    act(() => {
      window.history.replaceState({}, '', timelineUrl)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('article', { name: 'Session timeline' })).toBeVisible()
  })
  it('retains accessible KPI, breakdown, tool, activity, search and trace primitives', async () => {
    const { user } = renderWithProviders(<OperateWorkspace />)
    expect(await screen.findByRole('progressbar', { name: 'model-one cost' })).toHaveAttribute('aria-valuenow', '7')
    await user.click(screen.getByRole('tab', { name: 'Tools & Skills' }))
    expect(screen.getByRole('progressbar', { name: 'read calls' })).toHaveAttribute('aria-valuenow', '1')
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByRole('table', { name: 'Session activity by day and hour' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search sessions and messages' }), 'message{Enter}')
    expect(await screen.findByRole('button', { name: /Matched message/ })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Traces' }))
    expect(screen.getByRole('link', { name: /session-one/ })).toHaveAttribute(
      'href',
      'https://traces.example/session-one',
    )
    expect(screen.queryByText(/Direct LLM calls: Captured/)).not.toBeInTheDocument()
  })
  it('never falls back to own-tenant detail, search or traces for a foreign tenant', async () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/operate?lens=usage&usageTenant=foreign&usagePanel=search&usageSearch=needle&usageSession=session-one',
    )
    renderWithProviders(<OperateWorkspace />)
    expect(await screen.findByText(/Cross-tenant session detail is unavailable/)).toBeVisible()
    await waitFor(() => {
      expect(api.getUsageSummary).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'foreign' }))
    })
    expect(api.getUsageSessionDetail).not.toHaveBeenCalled()
    expect(api.getUsageSearch).not.toHaveBeenCalled()
    expect(api.getUsageTraces).not.toHaveBeenCalled()
  })
  it.each(['reader', 'foreign'])('refuses %s usage before issuing analytics reads', (kind) => {
    identity.role = kind === 'reader' ? 'reader' : 'user'
    if (kind === 'foreign') window.history.replaceState({}, '', '/workspace/operate?lens=usage&usageTenant=foreign')
    renderWithProviders(<OperateWorkspace />)
    expect(screen.getByRole('alert')).toHaveTextContent('Only an administrator')
    expect(api.getUsageSummary).not.toHaveBeenCalled()
  })
  it('does not claim an unconfigured exporter while reads are paused offline', async () => {
    onlineManager.setOnline(false)
    window.history.replaceState({}, '', '/workspace/operate?lens=usage&usagePanel=traces')
    renderWithProviders(<OperateWorkspace />)
    expect(await screen.findByText('Awaiting trace evidence…')).toBeVisible()
    expect(screen.queryByText('No trace exporter is enabled in the returned configuration.')).not.toBeInTheDocument()
    expect(api.getUsageTraces).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable and loading from a measured zero', async () => {
    const pending = deferred<UsageSummary>()
    vi.mocked(api.getUsageSummary).mockReturnValueOnce(pending.promise)
    renderWithProviders(<OperateWorkspace />)
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    await act(async () => {
      pending.resolve({ ...summary, totals: { ...summary.totals, cost_usd: 0 } })
    })
    expect(await screen.findByText('$0.00')).toBeVisible()
    vi.mocked(api.getUsageSummary).mockRejectedValueOnce(new Error('missing producer'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(await screen.findByText('The usage summary is unavailable. This is not measured zero.')).toBeVisible()
  })
  it('withdraws all protected data when refresh is denied', async () => {
    renderWithProviders(<OperateWorkspace />)
    await screen.findByText('model-one')
    vi.mocked(api.getUsageSummary).mockRejectedValueOnce(new ApiError(403, 'denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    await screen.findByText(/Usage access was denied/)
    expect(screen.queryByText('model-one')).not.toBeInTheDocument()
    expect(screen.queryByText('$7.00')).not.toBeInTheDocument()
  })
  it('does not accept an older response after a newer refresh', async () => {
    const older = deferred<UsageSummary>()
    const newer = deferred<UsageSummary>()
    vi.mocked(api.getUsageSummary).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    renderWithProviders(<OperateWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    await act(async () => {
      newer.resolve({ ...summary, totals: { ...summary.totals, cost_usd: 19 } })
    })
    await screen.findByText('$19.00')
    await act(async () => {
      older.resolve(summary)
    })
    expect(screen.getByText('$19.00')).toBeVisible()
    expect(screen.queryAllByText('$7.00')).toHaveLength(1) // Only the separately measured breakdown.
  })
  it.each(['owner', 'session', 'scope'])('retires old analytics on %s changes', async (kind) => {
    renderWithProviders(<Harness />)
    await screen.findByText('model-one')
    vi.mocked(api.getUsageByModel).mockReturnValueOnce(
      new Promise(() => {
        /* Current-admission request deliberately remains pending. */
      }),
    )
    vi.mocked(api.getUsageSummary).mockReturnValueOnce(
      new Promise(() => {
        /* Current-admission request deliberately remains pending. */
      }),
    )
    if (kind === 'owner') identity.userKey = 'b'
    if (kind === 'session') identity.raw.csrf_token = 'session-b'
    if (kind === 'scope') identity.raw.roles = ['other:read']
    fireEvent.click(screen.getByRole('button', { name: 'Update identity' }))
    expect(screen.queryByText('model-one')).not.toBeInTheDocument()
    expect(screen.queryByText('$7.00')).not.toBeInTheDocument()
  })
  it('rejects mismatched session responses and late detail after a different selection', async () => {
    const older = deferred<UsageSessionDetail>()
    vi.mocked(api.getUsageSessionDetail)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ...detail, session: { ...detail.session, id: 'wrong-session' } })
    window.history.replaceState({}, '', '/workspace/operate?lens=usage&usageSession=session-one')
    renderWithProviders(<OperateWorkspace />)
    act(() => {
      navigateOperate({ ...current(), usageSession: 'session-two' }, 'admin')
    })
    expect(await screen.findByText(/does not match the selected session/)).toBeVisible()
    await act(async () => {
      older.resolve(detail)
    })
    expect(screen.queryByText('Visible session message')).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Usage session detail' })).not.toBeInTheDocument()
  })
  it('uses native keyboard tabs and rejects invalid filter ranges without navigation', async () => {
    const { user } = renderWithProviders(<OperateWorkspace />)
    await screen.findByText('model-one')
    screen.getByRole('tab', { name: 'Models' }).focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByText('Usage filters', { selector: 'summary' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-10' } })
    const before = window.location.href
    await user.click(screen.getByRole('button', { name: 'Apply usage filters' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid date range')
    expect(window.location.href).toBe(before)
  })
})
