import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import DecisionExplorerTab from '@/components/decisions/DecisionExplorerTab'
import { renderWithProviders } from '@/__tests__/fixtures'
import { baseRecord, baseRow, createFixtureTransport, emptyProvenance } from './decisions-fixtures'

/**
 * DecisionExplorerTab (requirement DEC-01, part of WEBUI-DECIDE-R002): the
 * real component against an explicit fixture `DecisionsTransport` (see
 * `decisions-fixtures.ts`) — no network, no module mocking.
 */

describe('DecisionExplorerTab', () => {
  it('lists decisions and shows a placeholder until one is selected', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockResolvedValue([baseRow])
    renderWithProviders(<DecisionExplorerTab transport={transport} />)

    await waitFor(() => {
      expect(transport.listDecisions).toHaveBeenCalled()
    })
    expect(await screen.findByText(/decision:abc123/i)).toBeInTheDocument()
    expect(screen.getByText(/select a decision/i)).toBeInTheDocument()
  })

  it('shows the empty state on a genuine zero-row result', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockResolvedValue([])
    renderWithProviders(<DecisionExplorerTab transport={transport} />)
    expect(await screen.findByText(/no decisions recorded yet/i)).toBeInTheDocument()
  })

  it('shows an honest unavailable notice on a failed fetch, never an empty list', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockRejectedValue(new Error('network down'))
    renderWithProviders(<DecisionExplorerTab transport={transport} />)
    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()
    expect(screen.queryByText(/no decisions recorded yet/i)).not.toBeInTheDocument()
  })

  it('selecting a row loads and renders its premises, outcome, and why-not (DEC-01)', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockResolvedValue([baseRow])
    transport.getDecision.mockResolvedValue(baseRecord)
    transport.getDecisionProvenance.mockResolvedValue(emptyProvenance)
    const { user } = renderWithProviders(<DecisionExplorerTab transport={transport} />)

    const row = await screen.findByRole('button', { name: /decision:abc123/i })
    await user.click(row)

    await waitFor(() => {
      expect(transport.getDecision).toHaveBeenCalledWith('decision:abc123', expect.anything())
    })
    const detail = await screen.findByText('Decision')
    const card = detail.closest('[class*="rounded"]')?.parentElement ?? document.body
    expect(within(card as HTMLElement).getByText('agent:writer')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByText(/graph-digest-1/i)).toBeInTheDocument()
    // "Retired" appears twice on purpose: once under Eliminated candidates,
    // once under Why not -- both sections render the same violation tag.
    expect(within(card as HTMLElement).getAllByText(/retired/i).length).toBeGreaterThanOrEqual(2)
  })

  it('selecting a row with the keyboard alone (no pointer) loads its detail (DEC-06)', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockResolvedValue([baseRow])
    transport.getDecision.mockResolvedValue(baseRecord)
    transport.getDecisionProvenance.mockResolvedValue(emptyProvenance)
    const { user } = renderWithProviders(<DecisionExplorerTab transport={transport} />)

    const row = await screen.findByRole('button', { name: /decision:abc123/i })
    expect(row).toHaveAttribute('aria-pressed', 'false')
    row.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(transport.getDecision).toHaveBeenCalledWith('decision:abc123', expect.anything())
    })
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Decision')).toBeInTheDocument()
  })
})
