import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { ROUTES } from '@/lib/nav-registry'

const { registered, runMock } = vi.hoisted(() => ({
  registered: { tools: [] as readonly WebMcpToolDefinition[] },
  runMock: vi.fn(),
}))

vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: readonly WebMcpToolDefinition[]) => {
    registered.tools = tools
  },
}))
vi.mock('@/lib/dashboards/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dashboards/query')>()),
  runPanelQuery: runMock,
  listNodeTypes: () => Promise.resolve([]),
}))

import DashboardsView from '../DashboardsView'

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DashboardsView />
    </QueryClientProvider>,
  )
}

function tool(name: string): WebMcpToolDefinition {
  const found = registered.tools.find((t) => t.name === `agent-webui.dashboard.${name}`)
  if (!found) throw new Error(`tool ${name} is not registered`)
  return found
}

const call = (name: string, input: unknown) => tool(name).execute(input, { signal: new AbortController().signal })

// spec: WEBUI-DASH-R002, WEBUI-DASH-R006, WEBUI-DASH-R009, WEBUI-DASH-R014, WEBUI-DASH-R015
describe('DashboardsView (WEBUI-DASH-R002, R006, R009, R014, R015)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    runMock.mockReset()
    runMock.mockResolvedValue({
      state: 'ok',
      data: {
        columns: ['name', 'total'],
        rows: [
          { name: 'a', total: 3 },
          { name: 'b', total: 9 },
        ],
      },
    })
  })
  afterEach(() => {
    registered.tools = []
  })

  it('is mounted by the workspace.dashboards route', () => {
    expect(ROUTES.find((r) => r.id === 'workspace.dashboards')?.path).toBe('/data-dashboards')
    expect(ROUTES.find((r) => r.id === 'workspace.dashboards')?.label).toBe('Overstory Studio')
    renderView()
    expect(screen.getByRole('heading', { level: 1, name: 'Overstory Studio' })).toBeInTheDocument()
  })

  it('lets a person create a dashboard and add a KPI and a bar panel', async () => {
    renderView()
    fireEvent.change(screen.getByLabelText('New dashboard'), { target: { value: 'Ops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add panel' }))
    const form = screen.getByRole('form', { name: 'Add panel' })
    fireEvent.change(within(form).getByLabelText('Panel title'), { target: { value: 'Total' } })
    fireEvent.change(within(form).getByLabelText('Visualization'), { target: { value: 'kpi' } })
    fireEvent.change(within(form).getByLabelText(/UQL query/), { target: { value: 'MATCH (:A) |> LIMIT 5' } })
    fireEvent.change(within(form).getByLabelText('Y or value column'), { target: { value: 'total' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add panel' }))
    const panel = await screen.findByTestId('panel-total')
    await waitFor(() => {
      expect(within(panel).getByLabelText('Total: 3')).toBeInTheDocument()
    })
    expect(screen.getByTestId('save-status')).toHaveTextContent(/pending/i)
    expect(screen.getAllByText(/You:/)).toHaveLength(2)
  })

  it('renders an agent-built bar panel with a summary and data table, undoable', async () => {
    renderView()
    await act(async () => {
      await call('create', { title: 'Agent board' })
      await call('add_panel', {
        title: 'Totals',
        viz: 'bar',
        query: 'MATCH (:A) |> LIMIT 5',
        x_column: 'name',
        y_column: 'total',
      })
    })
    const panel = await screen.findByTestId('panel-totals')
    await waitFor(() => {
      expect(within(panel).getByRole('img')).toHaveAccessibleName(/Bar chart of total by name, 2 points/)
    })
    expect(within(panel).getByText('Data table')).toBeInTheDocument()
    expect(screen.getAllByText(/Agent:/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => {
      expect(screen.queryByTestId('panel-totals')).not.toBeInTheDocument()
    })
  })

  it('waits for the person to approve an agent removal', async () => {
    renderView()
    await act(async () => {
      await call('create', { title: 'Board' })
      await call('add_panel', { title: 'Totals', viz: 'table', query: 'MATCH (:A) |> LIMIT 5' })
    })
    let result: Promise<unknown> = Promise.resolve()
    await act(async () => {
      result = call('remove_panel', { panel_id: 'totals' })
    })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Totals')
    expect(screen.getByTestId('panel-totals')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deny' }))
    })
    expect(await result).toMatchObject({ ok: false })
    expect(screen.getByTestId('panel-totals')).toBeInTheDocument()
    await act(async () => {
      result = call('remove_panel', { panel_id: 'totals' })
    })
    await act(async () => {
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    })
    expect(await result).toMatchObject({ ok: true })
    expect(screen.queryByTestId('panel-totals')).not.toBeInTheDocument()
  })

  it('shows a failing panel as an error without hiding the others', async () => {
    runMock.mockResolvedValue({ state: 'error', error: 'engine offline' })
    renderView()
    await act(async () => {
      await call('create', { title: 'Board' })
      await call('add_panel', { title: 'Totals', viz: 'table', query: 'MATCH (:A) |> LIMIT 5' })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('engine offline')
  })
})
