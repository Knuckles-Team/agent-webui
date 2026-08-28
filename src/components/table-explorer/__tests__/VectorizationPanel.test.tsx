import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import VectorizationPanel from '../VectorizationPanel'
import type { CatalogRelation } from '../types'

const relation: CatalogRelation = {
  catalog: 'eg',
  schema: 'public',
  name: 'widgets',
  kind: 'table',
  tableType: 'BASE TABLE',
  columns: [],
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('VectorizationPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('degrades honestly to the "not built yet" explanation when the route 404s', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({}, 404))) as unknown as typeof fetch
    render(<VectorizationPanel relation={relation} />)

    await waitFor(() => {
      expect(screen.getByText('EmbeddingBinding')).toBeInTheDocument()
    })
    expect(screen.getByText(/catalog object on the backend yet/i)).toBeInTheDocument()
    // The pane documents what it WILL show, not a fabricated chip.
    expect(screen.getByText(/state chip/i)).toBeInTheDocument()
  })

  it('renders per-column bindings with separate Disable/Drop actions once the route answers', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: 'success',
          result: {
            bindings: [
              {
                column: 'description',
                state: 'live',
                progressPct: null,
                lagSeconds: 12,
                model: 'bge-small',
                modelDigest: 'abcdef123456',
                dim: 384,
                metric: 'cosine',
                indexType: 'hnsw',
                bytesOnDisk: 1024,
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch
    render(<VectorizationPanel relation={relation} />)

    await waitFor(() => {
      expect(screen.getByText('description')).toBeInTheDocument()
    })
    expect(screen.getByText(/Live · lag 12s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /drop/i })).toBeInTheDocument()
  })
})
