// spec: WEBUI-APPS-R049.1.2
import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { OperateReadinessPanel } from '@/components/workspace/OperateReadinessPanel'
import { readOperateReadiness } from '@/lib/operate-readiness'

let status: number
let payload: unknown
const fetcher = vi.fn()
const snapshot = (overall = 'degraded') => ({
  schema_version: 'arbora.readiness.v1',
  snapshot_id: 'snapshot:first',
  observed_at: '2026-10-24T12:00:00Z',
  overall,
  checks: {
    engine: { state: 'ready' },
    custom: { state: 'degraded', reason: 'fixture lag', detail: { pending: 3 }, extra_evidence: ['retained'] },
  },
  required_failures: [],
  degraded_reasons: ['custom: fixture lag'],
})
beforeEach(() => {
  status = 503
  payload = snapshot()
  fetcher.mockReset().mockImplementation(async () => Response.json(payload, { status }))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

it('diagnoses a real adapter 503 snapshot, selects complete check evidence, and reprobes', async () => {
  renderWithProviders(<OperateReadinessPanel generation="first" />)
  expect(await screen.findByText('Backend readiness: degraded')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'custom: degraded' }))
  const evidence = within(screen.getByRole('region', { name: 'Readiness check custom' }))
  expect(evidence.getByText(/"pending": 3/)).toHaveTextContent('extra_evidence')
  expect(evidence.getByText('Evidence from snapshot snapshot:first')).toBeVisible()
  expect(screen.queryByText('synthetic_query')).not.toBeInTheDocument()
  payload = {
    ...snapshot('ready'),
    snapshot_id: 'snapshot:second',
    checks: { engine: { state: 'ready' } },
    degraded_reasons: [],
  }
  status = 200
  fireEvent.click(screen.getByRole('button', { name: 'Reprobe readiness' }))
  expect(screen.queryByRole('region', { name: 'Readiness check custom' })).not.toBeInTheDocument()
  expect(await screen.findByText('Backend readiness: ready')).toBeVisible()
  expect(screen.getByText('snapshot:second')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'custom: degraded' })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledWith(
    '/api/dashboard/readiness',
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
  )
})

it('withdraws prior evidence on refusal and recovers only after a fresh read', async () => {
  renderWithProviders(<OperateReadinessPanel generation="first" />)
  await screen.findByText('Backend readiness: degraded')
  status = 403
  fireEvent.click(screen.getByRole('button', { name: 'Reprobe readiness' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('access was denied')
  expect(screen.queryByText('snapshot:first')).not.toBeInTheDocument()
  status = 503
  fireEvent.click(screen.getByRole('button', { name: 'Reprobe readiness' }))
  expect(await screen.findByText('Backend readiness: degraded')).toBeVisible()
})

it('retires selection and data while a different admission is loading', async () => {
  function Harness() {
    const [generation, setGeneration] = useState('first')
    return (
      <>
        <button
          onClick={() => {
            setGeneration('second')
          }}
        >
          Change admission
        </button>
        <OperateReadinessPanel generation={generation} />
      </>
    )
  }
  renderWithProviders(<Harness />)
  fireEvent.click(await screen.findByRole('button', { name: 'custom: degraded' }))
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(() => {
        /* Pending new admission. */
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Change admission' }))
  expect(screen.queryByText('snapshot:first')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Readiness check custom' })).not.toBeInTheDocument()
})

it.each([401, 404, 500])('rejects HTTP %s rather than inventing a readiness state', async (code) => {
  status = code
  await expect(readOperateReadiness()).rejects.toThrow()
})
it('rejects malformed, oversized and contradictory snapshots', async () => {
  payload = { error: 'unavailable' }
  await expect(readOperateReadiness()).rejects.toThrow()
  payload = snapshot('ready')
  await expect(readOperateReadiness()).rejects.toThrow('could not be validated')
  payload = { ...snapshot(), extra: 'x'.repeat(262144) }
  await expect(readOperateReadiness()).rejects.toThrow('could not be validated')
})

it('prevents duplicate reprobes and retires the selected evidence while a read is pending', async () => {
  renderWithProviders(<OperateReadinessPanel generation="first" />)
  fireEvent.click(await screen.findByRole('button', { name: 'custom: degraded' }))
  let release!: (response: Response) => void
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve
      }),
  )
  const button = screen.getByRole('button', { name: 'Reprobe readiness' })
  fireEvent.click(button)
  expect(button).toBeDisabled()
  expect(screen.queryByRole('region', { name: 'Readiness check custom' })).not.toBeInTheDocument()
  fireEvent.click(button)
  expect(fetcher).toHaveBeenCalledTimes(2)
  release(Response.json(snapshot(), { status: 503 }))
  await screen.findByText('Backend readiness: degraded')
  expect(button).toBeEnabled()
  expect(screen.queryByRole('region', { name: 'Readiness check custom' })).not.toBeInTheDocument()
})

it.each([
  [404, 'not activated'],
  [501, 'not activated'],
  [401, 'access was denied'],
  [403, 'access was denied'],
  [500, 'could not be retrieved'],
])('preserves distinct HTTP %s failure feedback', async (code, message) => {
  status = code
  renderWithProviders(<OperateReadinessPanel generation="first" />)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.queryByText(/Backend readiness:/)).not.toBeInTheDocument()
})
it('preserves required failures and full returned evidence without claiming readiness', async () => {
  payload = {
    ...snapshot('unavailable'),
    checks: { synthetic_query: { state: 'unavailable', reason: 'fixture failed', evidence_count: 0 } },
    required_failures: ['synthetic_query'],
    degraded_reasons: [],
  }
  renderWithProviders(<OperateReadinessPanel generation="first" />)
  expect(await screen.findByText('Backend readiness: unavailable')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Required failures' })).toHaveTextContent('synthetic_query')
  fireEvent.click(screen.getByRole('button', { name: 'synthetic_query: unavailable' }))
  expect(screen.getByRole('region', { name: 'Readiness check synthetic_query' })).toHaveTextContent(
    '"evidence_count": 0',
  )
})

it('classifies interrupted response bodies as transport failures', async () => {
  const response = new Response('', { status: 503 })
  vi.spyOn(response, 'text').mockRejectedValue(new TypeError('synthetic stream failure'))
  fetcher.mockResolvedValue(response)
  await expect(readOperateReadiness()).rejects.toMatchObject({ kind: 'transport' })
})
it('preserves cancellation after response headers arrive', async () => {
  const response = new Response('', { status: 503 })
  const aborted = new DOMException('synthetic cancellation', 'AbortError')
  vi.spyOn(response, 'text').mockRejectedValue(aborted)
  fetcher.mockResolvedValue(response)
  await expect(readOperateReadiness()).rejects.toBe(aborted)
})
