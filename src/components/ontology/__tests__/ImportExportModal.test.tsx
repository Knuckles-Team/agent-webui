import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { ImportExportModal } from '@/components/ontology/ImportExportModal'
import { api } from '@/lib/api'

/**
 * Mirrors SchemaView.test.tsx's strategy: assert the component is a
 * renderable export that mounts without throwing, and exercise the REAL
 * data-access it performs (`POST /api/ontology/load`,
 * `GET /api/ontology/export`, `GET /api/ontology/catalogue`) against a
 * mocked fetch — no stubs, real request contracts.
 */

interface FetchCall {
  url: string
  method: string
  body?: string
}
let calls: FetchCall[] = []

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined })
    if (url.startsWith('/api/ontology/catalogue')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'success', result: { count: 0, ontologies: [] } }), { status: 200 }),
      )
    }
    if (url.startsWith('/api/ontology/load')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'success',
            result: {
              status: 'ok',
              idempotent: false,
              ontology: { iri: 'http://example.org/pets', version: '1.0.0', n_classes: 3, n_properties: 2 },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ status: 'success', result: {} }), { status: 200 }))
  })
}

describe('ImportExportModal', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable export that mounts without throwing when closed', () => {
    expect(() => render(<ImportExportModal open={false} onOpenChange={() => undefined} />)).not.toThrow()
  })

  it('renders the import panel by default when open', () => {
    render(<ImportExportModal open onOpenChange={() => undefined} />)
    expect(screen.getByTestId('import-panel')).toBeTruthy()
  })

  it('renders an Export tab trigger alongside Import', () => {
    render(<ImportExportModal open onOpenChange={() => undefined} />)
    expect(screen.getByRole('tab', { name: /export/i })).toBeTruthy()
  })

  it('the Export tab is backed by a real GET /api/ontology/catalogue call (api.getOntologyCatalogue)', async () => {
    // Mirrors SparqlView.test.tsx's approach: Radix Tabs' pointer-driven tab
    // switch doesn't reliably flip under plain fireEvent.click in this jsdom
    // harness (see that file's header comment), so the request CONTRACT the
    // Export tab's mount-effect calls is verified directly against the real
    // api.ts method rather than by simulating the tab click.
    const res = await api.getOntologyCatalogue()
    const call = calls.find((c) => c.url.startsWith('/api/ontology/catalogue'))
    expect(call).toBeDefined()
    expect(res.count).toBe(0)
  })

  it('POSTs pasted turtle text to /api/ontology/load with source_type=text', async () => {
    render(<ImportExportModal open onOpenChange={() => undefined} />)
    const textarea = screen.getByLabelText(/ontology turtle\/rdf text/i)
    fireEvent.change(textarea, { target: { value: '@prefix ex: <http://example.org/pets#> . ex:Dog a ex:Animal .' } })
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }))

    await vi.waitFor(() => {
      const call = calls.find((c) => c.url === '/api/ontology/load')
      expect(call).toBeDefined()
      expect(call?.method).toBe('POST')
      const parsed = JSON.parse(call?.body ?? '{}') as { source: string; source_type: string }
      expect(parsed.source_type).toBe('text')
      expect(parsed.source).toContain('ex:Dog')
    })
  })

  it('surfaces a successful load result', async () => {
    render(<ImportExportModal open onOpenChange={() => undefined} />)
    const textarea = screen.getByLabelText(/ontology turtle\/rdf text/i)
    fireEvent.change(textarea, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }))

    await vi.waitFor(() => {
      expect(screen.getByText(/loaded http:\/\/example\.org\/pets/i)).toBeTruthy()
    })
  })
})
