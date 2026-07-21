import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import CatalogueView from '@/components/views/CatalogueView'

/**
 * Mirrors SchemaView.test.tsx's strategy (see that file's header comment for
 * why): assert the view is a renderable default export that mounts without
 * throwing, and exercise the REAL data-access it performs
 * (`GET /api/ontology/catalogue` via `api.getOntologyCatalogue`) against a
 * mocked fetch — no stubs, real request contracts.
 */

interface FetchCall {
  url: string
}
let calls: FetchCall[] = []

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function mockFetch(
  body: unknown = {
    status: 'success',
    result: {
      count: 1,
      ontologies: [
        {
          iri: 'http://example.org/pets',
          version: '1.0.0',
          n_classes: 3,
          n_properties: 2,
          n_axioms: 6,
          category: 'animals',
          tags: ['demo'],
          active: true,
        },
      ],
    },
  },
) {
  return vi.fn((input: RequestInfo | URL) => {
    calls.push({ url: urlOf(input) })
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

describe('CatalogueView', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof CatalogueView).toBe('function')
    expect(() => render(<CatalogueView />)).not.toThrow()
  })

  it('fetches the catalogue from GET /api/ontology/catalogue on mount', async () => {
    render(<CatalogueView />)
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/ontology/catalogue'))).toBe(true)
    })
  })

  it('never sends empty filter query params on the initial unfiltered load', async () => {
    render(<CatalogueView />)
    await vi.waitFor(() => {
      const call = calls.find((c) => c.url.includes('/api/ontology/catalogue'))
      expect(call).toBeDefined()
      expect(call?.url).toBe('/api/ontology/catalogue')
    })
  })

  it('propagates a non-OK catalogue response without crashing the view', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )
    expect(() => render(<CatalogueView />)).not.toThrow()
  })
})
