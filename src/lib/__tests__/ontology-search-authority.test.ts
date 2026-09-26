import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

const result = { ids: ['n1'], rows: [{ id: 'n1', name: 'A' }], count: 1 }

afterEach(() => vi.unstubAllGlobals())

describe('ontology search authority', () => {
  it('uses GraphOS for an unfiltered concrete-label browse', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const response = await api.ontologySearch({ object_type: 'Position', query: '', filters: [] })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/enhanced/ontology/object-set/by-label')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ label: 'Position', limit: 50 })
    expect(response.objects[0]).toMatchObject({ id: 'n1', type: 'Position', title: 'A' })
  })

  it('keeps filtered search on the full-search route until its engine authority exists', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await api.ontologySearch({ object_type: 'Position', query: 'A' })

    expect(fetch.mock.calls[0][0]).toBe('/api/enhanced/ontology/object-set/search')
  })
})
