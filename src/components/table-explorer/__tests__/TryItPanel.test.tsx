import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TryItPanel from '../TryItPanel'
import type { CatalogRelation } from '../types'

const relation: CatalogRelation = {
  catalog: 'eg',
  schema: 'public',
  name: 'widgets',
  kind: 'table',
  tableType: 'BASE TABLE',
  columns: [{ name: 'id', position: 1, dataType: 'text', udtName: 'text', nullable: false, primaryKey: true }],
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('TryItPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('surfaces the engine\'s typed "no server-side text embedder is bound" error on the vector leg honestly, without hiding the BM25 leg', async () => {
    let call = 0
    global.fetch = vi.fn(() => {
      call += 1
      // First call: vector leg (fails, as expected when EG_UQL_TEXT_EMBEDDER is unset).
      // Second call: BM25 leg (succeeds).
      if (call === 1) {
        return Promise.resolve(
          jsonResponse({ status: 'error', message: 'no server-side text embedder is bound' }, 500),
        )
      }
      return Promise.resolve(jsonResponse({ status: 'success', result: [{ id: '1', title: 'match' }] }))
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    render(<TryItPanel relation={relation} column="title" />)

    await user.type(screen.getByLabelText('Try it query'), 'leak')
    await user.click(screen.getByRole('button', { name: /run/i }))

    await waitFor(() => {
      expect(screen.getByText(/embedder is bound/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText(/id="1"/).length).toBeGreaterThan(0)
  })
})
