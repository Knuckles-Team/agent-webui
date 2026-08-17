import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import LiveDashboardsView from '../LiveDashboardsView'

describe('LiveDashboardsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Empty-but-OK backend for every /api/graph/* route.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    ) as unknown as typeof fetch
  })

  it('renders the shell with the default panels (op rate, p50, p99, logs, traces, chart)', async () => {
    render(<LiveDashboardsView />)
    expect(screen.getByText('Status')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-panel')).toHaveLength(6)
    })
    expect(screen.getByText('Engine op rate')).toBeInTheDocument()
    expect(screen.getByText('p50 latency')).toBeInTheDocument()
    expect(screen.getByText('p99 latency')).toBeInTheDocument()
    // The native engine-render Chart panel is now a DEFAULT panel, not an
    // opt-in add (GOC-88 KG-view adoption) — assert it ships out of the box.
    // (`getAllByText`, not `getByText`: the add-panel toolbar's "Chart"
    // button label matches too — both are legitimately present.)
    expect(screen.getAllByText('Chart').length).toBeGreaterThan(0)
  })

  it('exposes a time-range and auto-refresh selector', () => {
    render(<LiveDashboardsView />)
    expect(screen.getByLabelText('Time range')).toBeInTheDocument()
    expect(screen.getByLabelText('Auto refresh')).toBeInTheDocument()
  })

  it('adds a panel via the add-panel toolbar', async () => {
    render(<LiveDashboardsView />)
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-panel')).toHaveLength(6)
    })
    fireEvent.click(screen.getByRole('button', { name: /Metrics/i }))
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-panel')).toHaveLength(7)
    })
  })

  it('removes a panel via its remove control', async () => {
    render(<LiveDashboardsView />)
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-panel')).toHaveLength(6)
    })
    const firstPanel = screen.getAllByTestId('dashboard-panel')[0]
    fireEvent.click(within(firstPanel).getByRole('button', { name: /Remove panel/i }))
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-panel')).toHaveLength(5)
    })
  })
})
