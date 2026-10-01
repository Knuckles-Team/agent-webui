import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import DecisionsView from '@/components/views/DecisionsView'
import { renderWithProviders } from '@/__tests__/fixtures'
import { baseAggregate, baseRow, createFixtureTransport } from '@/components/decisions/__tests__/decisions-fixtures'

/**
 * DecisionsView (requirements WEBUI-DECIDE-R001, WEBUI-DECIDE-R002): the
 * composed explorer + calibration tabs render against one shared injected
 * transport and switching tabs does not lose or duplicate either query.
 */

describe('DecisionsView', () => {
  it('renders the explorer by default and switches to the calibration dashboard on request', async () => {
    const transport = createFixtureTransport()
    transport.listDecisions.mockResolvedValue([baseRow])
    transport.getDecisionAggregate.mockResolvedValue(baseAggregate)
    const { user } = renderWithProviders(<DecisionsView transport={transport} />)

    expect(await screen.findByText(/decision:abc123/i)).toBeInTheDocument()
    expect(transport.getDecisionAggregate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Outcomes and calibration' }))
    await waitFor(() => {
      expect(transport.getDecisionAggregate).toHaveBeenCalled()
    })
    expect(await screen.findByText('agent:writer')).toBeInTheDocument()
  })
})
