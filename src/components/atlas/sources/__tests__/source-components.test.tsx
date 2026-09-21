import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { ConnectionDialog } from '../ConnectionDialog'
import { ConnectionStatus } from '../ConnectionStatus'
import { SourceCatalog } from '../SourceCatalog'
import { SyncPreview } from '../SyncPreview'
import { SyncRunPanel } from '../SyncRunPanel'
import type { SourceCatalog as SourceCatalogModel, SourceProvider } from '@/lib/atlas/sources/contracts'

const observedAt = '2026-08-29T12:00:00Z'

const provider: SourceProvider = {
  source_id: 'source:postgres',
  label: 'Postgres warehouse',
  description: 'A server-described source.',
  availability: { state: 'available', reason: null, observed_at: observedAt },
  query_modes: ['natural_language', 'uql'],
  capabilities: ['query', 'sync', 'explore', 'connect', 'cancel'],
  connection: { state: 'disconnected', reason: null, profile_ref: null, checked_at: observedAt },
}

const catalog: SourceCatalogModel = {
  observed_at: observedAt,
  providers: [provider],
}

describe('Atlas source components', () => {
  it('renders server-declared provider modes and capabilities without a provider list', () => {
    render(<SourceCatalog catalog={catalog} onConnect={vi.fn()} />)
    const card = screen.getByTestId('atlas-source-card-source:postgres')
    expect(within(card).getByText('Natural Language')).toBeInTheDocument()
    expect(within(card).getByText('UQL')).toBeInTheDocument()
    expect(within(card).getByText('query')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('keeps request errors distinct from unavailable and empty states', () => {
    render(<SourceCatalog catalog={null} error="HTTP 500" />)
    expect(screen.getByTestId('atlas-source-catalog-error')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
    expect(screen.queryByTestId('atlas-unavailable-notice')).not.toBeInTheDocument()
  })

  it('keeps unavailable providers visible and does not offer a connect action', () => {
    render(
      <SourceCatalog
        catalog={{
          ...catalog,
          providers: [{ ...provider, availability: { state: 'unavailable', reason: 'not reachable' } }],
        }}
        onConnect={vi.fn()}
      />,
    )
    const card = screen.getByTestId('atlas-source-card-source:postgres')
    expect(within(card).getByText('Unavailable')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Connect' })).toBeDisabled()
    expect(within(card).getByText('not reachable')).toBeInTheDocument()
  })

  it('fails closed for explore and connect unless availability and capabilities are explicit', () => {
    const onSelect = vi.fn()
    const onConnect = vi.fn()
    const { rerender } = render(
      <SourceCatalog
        catalog={{
          ...catalog,
          providers: [{ ...provider, capabilities: ['query'], availability: { state: 'degraded' } }],
        }}
        onSelect={onSelect}
        onConnect={onConnect}
      />,
    )
    expect(screen.getByTestId('atlas-source-select-source:postgres')).toBeDisabled()
    expect(screen.getByTestId('atlas-source-connect-source:postgres')).toBeDisabled()
    rerender(
      <SourceCatalog
        catalog={{
          ...catalog,
          providers: [{ ...provider, capabilities: [], availability: { state: 'available' } }],
        }}
        onSelect={onSelect}
        onConnect={onConnect}
      />,
    )
    expect(screen.getByTestId('atlas-source-select-source:postgres')).toBeDisabled()
    expect(screen.getByTestId('atlas-source-connect-source:postgres')).toBeDisabled()
    rerender(
      <SourceCatalog
        catalog={{
          ...catalog,
          providers: [
            {
              ...provider,
              availability: { state: 'unknown' },
            },
          ],
        }}
        onSelect={onSelect}
        onConnect={onConnect}
      />,
    )
    expect(screen.getByTestId('atlas-source-select-source:postgres')).toBeDisabled()
    expect(screen.getByTestId('atlas-source-connect-source:postgres')).toBeDisabled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('submits only a controlled profile reference', () => {
    const onSubmit = vi.fn()
    render(<ConnectionDialog open provider={provider} onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    const input = screen.getByTestId('atlas-connection-profile-ref')
    expect(screen.queryByLabelText(/endpoint|password|token/i)).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'postgres://db.example.test' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('controlled profile reference')
    fireEvent.change(input, { target: { value: 'secret://sources/postgres' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(onSubmit).toHaveBeenCalledWith({
      source_id: 'source:postgres',
      connection_profile_ref: 'secret://sources/postgres',
    })
  })

  it('renders connection status and sync preview evidence', () => {
    render(
      <>
        <ConnectionStatus
          sourceLabel="Postgres"
          status={{ state: 'connected', profile_ref: 'secret://sources/postgres' }}
        />
        <SyncPreview
          preview={{
            preview_id: 'preview:postgres:1',
            source_id: 'source:postgres',
            mode: 'delta',
            generated_at: observedAt,
            changes: { added: 1, updated: 2, removed: 0, unchanged: 4 },
            will_write: true,
            requires_approval: true,
            warnings: ['one record is stale'],
          }}
          onStart={vi.fn()}
        />
      </>,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Approval required')).toBeInTheDocument()
    expect(screen.getByText('one record is stale')).toBeInTheDocument()
    expect(screen.getByTestId('atlas-sync-start')).toBeDisabled()
  })

  it('requires an explicit approval state before enabling reviewed sync start', () => {
    const onStart = vi.fn()
    const onApprove = vi.fn()
    const preview = {
      preview_id: 'preview:postgres:approval',
      source_id: 'source:postgres',
      mode: 'delta' as const,
      generated_at: observedAt,
      changes: { added: 1, updated: 0, removed: 0, unchanged: 0 },
      will_write: true,
      requires_approval: true,
      warnings: [],
    }
    const { rerender } = render(<SyncPreview preview={preview} onStart={onStart} onApprove={onApprove} />)
    expect(screen.getByTestId('atlas-sync-start')).toBeDisabled()
    fireEvent.click(screen.getByTestId('atlas-sync-approve'))
    expect(onApprove).toHaveBeenCalledWith(preview)
    rerender(<SyncPreview preview={preview} onStart={onStart} approved onApprove={onApprove} />)
    expect(screen.getByTestId('atlas-sync-start')).toBeEnabled()
    fireEvent.click(screen.getByTestId('atlas-sync-start'))
    expect(onStart).toHaveBeenCalledWith(preview)
  })

  it('allows cancellation only for active runs and shows server aggregate counts', () => {
    const onCancel = vi.fn()
    render(
      <SyncRunPanel
        aggregate={{
          aggregate_state: 'running',
          observed_at: observedAt,
          counts: { total: 2, queued: 1, running: 1, succeeded: 0, failed: 0, cancelled: 0 },
          runs: [
            { run_id: 'run:postgres:1', source_id: 'source:postgres', mode: 'delta', state: 'running' },
            { run_id: 'run:postgres:0', source_id: 'source:postgres', mode: 'full', state: 'completed' },
          ],
        }}
        onCancel={onCancel}
        sourceAvailability={{ state: 'available' }}
        sourceCapabilities={['cancel']}
      />,
    )
    fireEvent.click(screen.getByTestId('atlas-sync-cancel-run:postgres:1'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('atlas-sync-cancel-run:postgres:0')).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('disables cancellation when the source is degraded or cancel is not declared', () => {
    const onCancel = vi.fn()
    render(
      <SyncRunPanel
        aggregate={{
          aggregate_state: 'running',
          observed_at: observedAt,
          counts: { total: 1, queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0 },
          runs: [{ run_id: 'run:postgres:degraded', source_id: 'source:postgres', mode: 'delta', state: 'running' }],
        }}
        onCancel={onCancel}
        sourceAvailability={{ state: 'degraded' }}
        sourceCapabilities={['cancel']}
      />,
    )
    const cancelButton = screen.getByTestId('atlas-sync-cancel-run:postgres:degraded')
    expect(cancelButton).toBeDisabled()
    fireEvent.click(cancelButton)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
