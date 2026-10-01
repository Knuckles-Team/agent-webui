import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FleetView from '@/components/views/FleetView'

/**
 * FleetView polls `api.getFleetHealth`/`getFleetTopology`/`getFleetApprovals`
 * every REFRESH_MS (5s) via `setInterval` -- well outside these tests'
 * runtime, so real timers are fine. `cleanup()` unmounts the component,
 * which clears the interval in its effect teardown, so it never fires into a
 * later test.
 *
 * Domain health, topology and approvals each live on their own tab
 * (`Tabs defaultValue="health"`), so a test must switch tabs to see a
 * non-default section's status message.
 */
vi.mock('@/lib/api', () => ({
  api: {
    getFleetHealth: vi.fn(() =>
      Promise.resolve({
        generated_at: 0,
        sessions: { total: 0, by_status: {} },
        goals: { active: 0, tracked: 0 },
        domains: {},
      }),
    ),
    getFleetTopology: vi.fn(() => Promise.resolve({ domains: [], goals: [], totals: { domains: 0, sessions: 0 } })),
    getFleetApprovals: vi.fn(() => Promise.resolve({ pending: [] })),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FleetView status language (DS-05)', () => {
  it('shows the shared empty status message for an empty, confirmed-healthy fleet, per tab', async () => {
    const user = userEvent.setup()
    render(<FleetView />)

    // Domain Health tab is the default.
    await waitFor(() => {
      expect(screen.getByText('No active sessions.')).toBeInTheDocument()
    })
    // Confirmed-empty renders as `status`, never conflated with the
    // `UnavailableNotice` "could not be confirmed" case (BUG-008).
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Topology' }))
    await waitFor(() => {
      expect(screen.getByText('No active sessions.')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: /Approvals/ }))
    await waitFor(() => {
      expect(screen.getByText('No pending approvals.')).toBeInTheDocument()
    })
  })

  it('still distinguishes "could not be confirmed" from confirmed-empty when a section fails', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getFleetHealth).mockRejectedValueOnce(new Error('network error'))
    render(<FleetView />)
    await waitFor(() => {
      expect(screen.getByText(/Domain health could not be fetched/)).toBeInTheDocument()
    })
    // Health is confirmed-unavailable above; it never also claims "No active
    // sessions." (BUG-008's false-reassurance bug).
    expect(screen.queryByText('No active sessions.')).not.toBeInTheDocument()
  })
})
