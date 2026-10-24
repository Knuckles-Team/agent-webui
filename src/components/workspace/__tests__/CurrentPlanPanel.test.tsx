// spec: WEBUI-APPS-R004.4
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ArboraApiError } from '@/lib/arbora-api/invoke'
import { readCurrentPlan, type CurrentPlanRead } from '@/lib/current-plan'
import { CurrentPlanPanel } from '../CurrentPlanPanel'
vi.mock('@/lib/current-plan', () => ({ readCurrentPlan: vi.fn() }))
const props = { runId: 'run-a', taskId: 'task-a', generation: 'admission-a' }
function renderWithProviders(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}
function available(items = [{ text: 'Inspect evidence', status: 'in_progress' as const }]): CurrentPlanRead {
  return {
    availability: 'available',
    snapshot: {
      run_id: 'run-a',
      revision: 2,
      observed_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      items,
    },
  }
}
function deferred() {
  let resolve!: (value: CurrentPlanRead) => void
  const promise = new Promise<CurrentPlanRead>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.mocked(readCurrentPlan).mockReset()
  vi.mocked(readCurrentPlan).mockResolvedValue(available())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('read-only current plan presentation', () => {
  it('renders ordered text and statuses with refresh as its only control', async () => {
    vi.mocked(readCurrentPlan).mockResolvedValue({
      availability: 'available',
      snapshot: {
        ...available().snapshot!,
        items: [
          { text: '<script>First</script>', status: 'pending' },
          { text: 'Second', status: 'in_progress' },
          { text: 'Third', status: 'done' },
        ],
      },
    })
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('<script>First</script>')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '<script>First</script> (Pending)',
      'Second (In progress)',
      'Third (Done)',
    ])
    expect(screen.getAllByRole('button').map((item) => item.textContent)).toEqual(['Refresh current plan'])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
  it.each([
    [available([]), 'The current plan has no items.'],
    [
      { availability: 'unavailable', snapshot: null } as CurrentPlanRead,
      'Current plan is not available for this run.',
    ],
  ])('distinguishes successful empty and unavailable reads %#', async (value, message) => {
    vi.mocked(readCurrentPlan).mockResolvedValue(value)
    renderWithProviders(<CurrentPlanPanel {...props} />)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
  it('does not read or render a placeholder when no authoritative run reference exists', () => {
    renderWithProviders(<CurrentPlanPanel {...props} runId={null} />)
    expect(screen.getByText(/no valid run reference/)).toBeInTheDocument()
    expect(readCurrentPlan).not.toHaveBeenCalled()
  })
  it.each([401, 403, 404, 501, 503, 500])('clears the previous plan on refresh refusal %s', async (status) => {
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('Inspect evidence')
    vi.mocked(readCurrentPlan).mockRejectedValueOnce(new ArboraApiError('REFUSED', status, false, {}))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      [401, 403].includes(status) ? 'denied' : status === 500 ? 'could not be loaded' : 'not available',
    )
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
  it('clears previous content on unavailable or malformed refresh without turning either into empty', async () => {
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('Inspect evidence')
    vi.mocked(readCurrentPlan).mockResolvedValueOnce({ availability: 'unavailable', snapshot: null })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    await screen.findByText('Current plan is not available for this run.')
    expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
    vi.mocked(readCurrentPlan).mockRejectedValueOnce(new Error('invalid snapshot'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('validated')
    expect(screen.queryByText('The current plan has no items.')).not.toBeInTheDocument()
  })
  it.each(['task', 'run', 'admission'] as const)(
    'aborts a %s change and ignores a late retired result',
    async (change) => {
      const pending = deferred()
      vi.mocked(readCurrentPlan).mockReturnValueOnce(pending.promise)
      const view = renderWithProviders(<CurrentPlanPanel {...props} />)
      const signal = vi.mocked(readCurrentPlan).mock.calls[0][1]
      const next = {
        ...props,
        ...(change === 'task'
          ? { taskId: 'task-b' }
          : change === 'run'
            ? { runId: 'run-b' }
            : { generation: 'admission-b' }),
      }
      vi.mocked(readCurrentPlan).mockResolvedValueOnce({ availability: 'unavailable', snapshot: null })
      view.rerender(<CurrentPlanPanel {...next} />)
      expect(signal.aborted).toBe(true)
      await screen.findByText('Current plan is not available for this run.')
      await act(async () => {
        pending.resolve(available())
      })
      expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
    },
  )
  it('retires overlapping refreshes and does not let the older result replace the newer one', async () => {
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('Inspect evidence')
    const pending = deferred()
    vi.mocked(readCurrentPlan).mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    const signal = vi.mocked(readCurrentPlan).mock.calls[1][1]
    vi.mocked(readCurrentPlan).mockResolvedValueOnce(available([{ text: 'New plan', status: 'in_progress' }]))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    await screen.findByText('New plan')
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve(available())
    })
    expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
    expect(screen.getByText('New plan')).toBeInTheDocument()
  })
  it('aborts on unmount and never reuses the late old result when remounted', async () => {
    const pending = deferred()
    vi.mocked(readCurrentPlan).mockReturnValueOnce(pending.promise)
    const view = renderWithProviders(<CurrentPlanPanel {...props} />)
    const signal = vi.mocked(readCurrentPlan).mock.calls[0][1]
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve(available())
    })
    vi.mocked(readCurrentPlan).mockResolvedValueOnce({ availability: 'unavailable', snapshot: null })
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('Current plan is not available for this run.')
    expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
  })
  it('withdraws an expired snapshot without waiting for another interaction', async () => {
    renderWithProviders(<CurrentPlanPanel {...props} />)
    await screen.findByText('Inspect evidence')
    vi.useFakeTimers()
    vi.mocked(readCurrentPlan).mockResolvedValueOnce(available())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current plan' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('Inspect evidence')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.queryByText('Inspect evidence')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Current plan' })).getByRole('status')).toHaveTextContent(
      'expired',
    )
  })
})
