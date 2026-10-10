import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/fixtures'
import InstrumentGroups from '../InstrumentGroups'
import type { InstrumentGroupsResult, InstrumentGroupsTransport } from '../instrument-groups-transport'

/**
 * InstrumentGroups (FUI-02): a fixture-driven test for each of the six
 * distinguishable data states plus the ordinary ready state, and for
 * group/mode selection persisting in the URL. Depends on
 * EG-FINANCE-PRIMITIVES-R004 (PENDING); this exercises the typed
 * InstrumentGroupsTransport fixture, not a real backend.
 */

function makeTransport(result: InstrumentGroupsResult): InstrumentGroupsTransport {
  return { listGroups: vi.fn().mockResolvedValue(result) }
}

const readyGroups = [
  { groupId: 'g1', label: 'Retirement' },
  { groupId: 'g2', label: 'Speculative' },
]

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('InstrumentGroups', () => {
  it('shows a distinct loading state before data arrives', () => {
    const transport: InstrumentGroupsTransport = {
      listGroups: vi.fn(
        () =>
          new Promise<InstrumentGroupsResult>(() => {
            /* never resolves: asserts the loading state */
          }),
      ),
    }
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(screen.getByText('Loading your instrument groups…')).toBeInTheDocument()
  })

  // spec: FUI-02
  it('shows a distinct genuinely-empty state, not a loading or failure state', async () => {
    const transport = makeTransport({ status: 'empty' })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(await screen.findByText('You have not created any instrument groups yet.')).toBeInTheDocument()
    expect(screen.queryByText('Loading your instrument groups…')).not.toBeInTheDocument()
  })

  it('shows a distinct stale state labeled with its as-of time, alongside the groups', async () => {
    const transport = makeTransport({ status: 'stale', groups: readyGroups, asOf: '2026-10-01T00:00:00Z' })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(
      await screen.findByText(/Showing groups as of 2026-10-01T00:00:00Z\. This data is stale\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Retirement')).toBeInTheDocument()
  })

  it('shows a distinct partial state naming the groups that failed to load', async () => {
    const transport = makeTransport({ status: 'partial', groups: readyGroups, failedGroupIds: ['g3'] })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(await screen.findByText('Some groups could not be loaded: g3.')).toBeInTheDocument()
    expect(screen.getByText('Speculative')).toBeInTheDocument()
  })

  it('shows a distinct permission-denied state, not an empty result', async () => {
    const transport = makeTransport({ status: 'denied', reason: 'Account scope excludes groups.' })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(await screen.findByText(/You do not have permission to view instrument groups\./)).toBeInTheDocument()
    expect(screen.queryByText('You have not created any instrument groups yet.')).not.toBeInTheDocument()
  })

  it('shows a distinct unavailable state when the capability has not shipped', async () => {
    const transport = makeTransport({ status: 'unavailable', reason: 'Groups are not available on this deployment.' })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(await screen.findByText('Instrument groups is not available yet.')).toBeInTheDocument()
    expect(screen.getByText('Groups are not available on this deployment.')).toBeInTheDocument()
  })

  it('renders the ready state with group tabs and a Basic/Holdings mode toggle', async () => {
    const transport = makeTransport({ status: 'ready', groups: readyGroups })
    renderWithProviders(<InstrumentGroups transport={transport} />)
    expect(await screen.findByText('Retirement')).toBeInTheDocument()
    expect(screen.getByText('Speculative')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Basic' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Holdings' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('persists the selected group and mode in the URL across a simulated refresh', async () => {
    const transport = makeTransport({ status: 'ready', groups: readyGroups })
    const { user } = renderWithProviders(<InstrumentGroups transport={transport} />)
    await screen.findByText('Retirement')

    await user.click(screen.getByRole('button', { name: 'Speculative' }))
    await user.click(screen.getByRole('button', { name: 'Holdings' }))

    await waitFor(() => {
      expect(window.location.search).toContain('group=g2')
    })
    expect(window.location.search).toContain('mode=holdings')

    // Simulate a refresh: remount against the same URL and confirm the
    // selection is read back rather than reset to the first group/Basic.
    renderWithProviders(<InstrumentGroups transport={transport} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Speculative' })[1]).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.getAllByRole('button', { name: 'Holdings' })[1]).toHaveAttribute('aria-pressed', 'true')
  })
})
