import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import DecisionDetailPanel from '../DecisionDetailPanel'
import { renderWithProviders } from '@/__tests__/fixtures'
import { baseRecord, createFixtureTransport, emptyProvenance } from './decisions-fixtures'

/**
 * DecisionDetailPanel's on-demand why-not explanation (requirement DEC-02,
 * part of WEBUI-DECIDE-R002): a fresh explanation is requested within a
 * bounded solve budget, and a timeout or refusal is shown to the reader
 * without altering the original committed decision record.
 */

afterEach(() => {
  vi.useRealTimers()
})

async function renderWithDetail(transport: ReturnType<typeof createFixtureTransport>) {
  transport.getDecision.mockResolvedValue(baseRecord)
  transport.getDecisionProvenance.mockResolvedValue(emptyProvenance)
  const view = renderWithProviders(<DecisionDetailPanel recordId={baseRecord.record_id} transport={transport} />)
  await screen.findByText('Decision')
  return view
}

describe('DecisionDetailPanel why-not on demand (DEC-02)', () => {
  // spec: DEC-02
  it('shows a freshly computed explanation without altering the original decision', async () => {
    const transport = createFixtureTransport()
    transport.getWhyNotOnDemand.mockResolvedValue({
      kind: 'explained',
      whyNot: { component_id: 'agent:reviewer', slot: 'writer', violation: { violation: 'capacity_exhausted' } },
    })
    const { user } = await renderWithDetail(transport)

    await user.click(screen.getByRole('button', { name: 'Explain on demand' }))

    expect(await screen.findByText(/capacity exhausted/i)).toBeInTheDocument()
    expect(transport.getWhyNotOnDemand).toHaveBeenCalledWith(
      baseRecord.record_id,
      { componentId: 'agent:reviewer', slot: 'writer', budgetMs: 5_000 },
      expect.anything(),
    )
    // The originally rendered record is untouched: its own why-not reason still renders.
    expect(screen.getAllByText(/retired/i).length).toBeGreaterThanOrEqual(1)
  })

  // spec: DEC-02
  it('shows a refusal reason returned by the engine', async () => {
    const transport = createFixtureTransport()
    transport.getWhyNotOnDemand.mockResolvedValue({ kind: 'refused', reason: 'policy_denied' })
    const { user } = await renderWithDetail(transport)

    await user.click(screen.getByRole('button', { name: 'Explain on demand' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/policy_denied/i)
  })

  // spec: DEC-02
  it('shows a timeout when the bounded solve budget elapses, and never mutates the record', async () => {
    const transport = createFixtureTransport()
    transport.getWhyNotOnDemand.mockImplementation(
      (_recordId, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const { getByRole } = await renderWithDetail(transport)

    vi.useFakeTimers()
    fireEvent.click(getByRole('button', { name: 'Explain on demand' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(getByRole('alert')).toHaveTextContent(/timed out/i)
    expect(transport.getDecision).toHaveBeenCalledTimes(1)
  })
})
