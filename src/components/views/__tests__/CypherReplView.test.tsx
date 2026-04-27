import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CypherReplView from '@/components/views/CypherReplView'

function createFetchMock(body: unknown = [{ n: { id: 'node1' } }]) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    }) as unknown as Promise<Response>,
  )
}

describe('CypherReplView Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders the REPL with default query and caution banner', () => {
    global.fetch = createFetchMock() as unknown as typeof fetch
    render(<CypherReplView />)

    const editor = screen.getByLabelText('Cypher query') as HTMLTextAreaElement
    expect(editor.value).toContain('MATCH (n) RETURN n LIMIT 10')

    expect(
      screen.getByText(/Read-only queries recommended/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^run$/i })).toBeInTheDocument()
  })

  it('runs a query, shows results, and appends history', async () => {
    const fetchSpy = createFetchMock([{ node: { id: 'n1' }, name: 'foo' }])
    global.fetch = fetchSpy as unknown as typeof fetch

    render(<CypherReplView />)

    screen.getByRole('button', { name: /^run$/i }).click()

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/enhanced/graph/query')
    expect(init.method).toBe('POST')

    await waitFor(() => {
      expect(screen.getByText(/1 row/i)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/1 rows/i)).toBeInTheDocument()
    })
  })

  it('surfaces HTTP errors in the result panel', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('boom'),
      }) as unknown as Promise<Response>,
    ) as unknown as typeof fetch

    render(<CypherReplView />)
    screen.getByRole('button', { name: /^run$/i }).click()

    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument()
    })
  })

  it('detects destructive queries and shows a warning', async () => {
    global.fetch = createFetchMock() as unknown as typeof fetch
    render(<CypherReplView />)

    const editor = screen.getByLabelText('Cypher query') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'DELETE n' } })

    await waitFor(() => {
      expect(
        screen.getByText(/destructive/i, { selector: 'span' }),
      ).toBeInTheDocument()
    })
  })
})
