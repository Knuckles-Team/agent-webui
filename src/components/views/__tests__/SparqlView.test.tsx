import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import SparqlView from '@/components/views/SparqlView'
import { api } from '@/lib/api'

/**
 * Mirrors VertexView.test.tsx / SchemaView.test.tsx's strategy: assert the
 * view is a renderable default export, then exercise the REAL `api.ts`
 * methods it calls (`runSparqlQuery` → POST /api/sparql,
 * `validateOntologyCandidate` → POST /api/ontology/validate) against a
 * mocked fetch — real wiring, real request contracts, no stubs.
 */

interface FetchCall {
  url: string
  init?: RequestInit
}
let calls: FetchCall[] = []

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(call.init?.body as string) as Record<string, unknown>
}

const SPARQL_RESPONSE = {
  status: 'success',
  head: { vars: ['s', 'p', 'o'] },
  results: { bindings: [{ s: { value: 'ex:a' }, p: { value: 'ex:knows' }, o: { value: 'ex:b' } }] },
}

const VALIDATE_RESPONSE = {
  status: 'success',
  result: {
    valid: true,
    errors: [],
    warnings: [],
    summary: { n_classes: 3 },
    shacl_report: { conforms: true, text: 'Validation Report\nConforms: True\n' },
  },
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    calls.push({ url, init })
    if (url.includes('/api/sparql'))
      return Promise.resolve(new Response(JSON.stringify(SPARQL_RESPONSE), { status: 200 }))
    if (url.includes('/api/ontology/validate'))
      return Promise.resolve(new Response(JSON.stringify(VALIDATE_RESPONSE), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected route' }), { status: 404 }))
  })
}

describe('SparqlView', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof SparqlView).toBe('function')
    expect(() => render(<SparqlView />)).not.toThrow()
  })

  it('runSparqlQuery POSTs to /api/sparql and returns SPARQL-JSON bindings', async () => {
    const res = await api.runSparqlQuery('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25')

    const call = calls.find((c) => c.url.includes('/api/sparql'))
    expect(call).toBeDefined()
    expect(call?.init?.method).toBe('POST')
    expect(parseBody(call!).query).toBe('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25')
    expect(res.status).toBe('success')
    expect(res.head?.vars).toEqual(['s', 'p', 'o'])
    expect(res.results?.bindings).toHaveLength(1)
  })

  it('propagates a SPARQL error response without throwing (status stays in the payload)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ status: 'error', message: 'parse error' }), { status: 500 })),
      ),
    )
    // /api/sparql returns HTTP 500 with a JSON error body on a bad query — the
    // api client's `post()` treats any non-2xx as an ApiError.
    await expect(api.runSparqlQuery('SELECT malformed')).rejects.toThrow()
  })

  it('validateOntologyCandidate POSTs to /api/ontology/validate and unwraps the {status,result} envelope', async () => {
    const result = await api.validateOntologyCandidate({ source: 'ex:Dog a owl:Class .', source_type: 'text' })

    const call = calls.find((c) => c.url.includes('/api/ontology/validate'))
    expect(call).toBeDefined()
    expect(call?.init?.method).toBe('POST')
    const sent = parseBody(call!)
    expect(sent.source).toBe('ex:Dog a owl:Class .')
    expect(sent.source_type).toBe('text')
    // Envelope-unwrapped: `.result`, not the raw `{status, result}` envelope.
    expect(result.valid).toBe(true)
    expect(result.shacl_report?.conforms).toBe(true)
    expect(result.shacl_report?.text).toBe('Validation Report\nConforms: True\n')
  })

  it('sends only the fields the caller provides (server owns the source_type default)', async () => {
    await api.validateOntologyCandidate({ source: 'bad turtle' })
    const call = calls.find((c) => c.url.includes('/api/ontology/validate'))
    const sent = parseBody(call!)
    expect(sent.source).toBe('bad turtle')
    // No client-side default is injected for the omitted field — the FastAPI
    // pydantic model (`source_type: str = Field(default="auto")`) supplies it.
    expect(sent.source_type).toBeUndefined()
  })
})
