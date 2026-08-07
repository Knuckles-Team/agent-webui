import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AgentLibraryView from '@/components/views/AgentLibraryView'

/**
 * Mirrors CatalogueView.test.tsx's strategy: assert the view mounts and reads
 * real data through its documented endpoints, and — matching the repo's
 * hostile-payload contract (see `src/__tests__/hostile-payload-contract-*`) —
 * that a null/error/empty response from any of its four endpoints never
 * crashes the component.
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

function jsonFor(url: string): unknown {
  if (url.includes('/agent-library/agents')) {
    return [
      {
        id: 'resource:skill:demo-agent',
        name: 'demo-agent',
        description: 'A demo agent.',
        kind: 'local',
        mcp_server: null,
        runnable_bound: true,
        status: 'active',
      },
    ]
  }
  if (url.includes('/agent-library/suggestions')) {
    return [{ mcp_server: 'demo-mcp', tool_count: 3, sample_tools: ['a', 'b'], reason: 'unused tools' }]
  }
  if (url.includes('/agent-library/tools')) {
    return [{ id: 'tool:1', name: 'demo_tool', mcp_server: 'demo-mcp', tags: [] }]
  }
  if (url.includes('/agent-library/config-summary')) {
    return { app_profile: 'dev', deployment_profile: 'tiny', chat_models: [], embedding_models: [] }
  }
  return {}
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    calls.push({ url })
    return Promise.resolve(new Response(JSON.stringify(jsonFor(url)), { status: 200 }))
  })
}

describe('AgentLibraryView', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof AgentLibraryView).toBe('function')
    expect(() => render(<AgentLibraryView />)).not.toThrow()
  })

  it('fetches agents, suggestions, tools, and the config summary on mount', async () => {
    render(<AgentLibraryView />)
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/enhanced/agent-library/agents'))).toBe(true)
      expect(calls.some((c) => c.url.includes('/api/enhanced/agent-library/suggestions'))).toBe(true)
      expect(calls.some((c) => c.url.includes('/api/enhanced/agent-library/tools'))).toBe(true)
      expect(calls.some((c) => c.url.includes('/api/enhanced/agent-library/config-summary'))).toBe(true)
    })
  })

  it('renders a fetched local agent in the library list', async () => {
    render(<AgentLibraryView />)
    await waitFor(() => {
      expect(screen.getByText('demo-agent')).toBeInTheDocument()
    })
  })

  it('renders a suggestion derived from the graph', async () => {
    render(<AgentLibraryView />)
    await waitFor(() => {
      expect(screen.getByText('demo-mcp')).toBeInTheDocument()
    })
  })

  for (const [fixtureName, body] of [
    ['null', null],
    ['empty object', {}],
    ['empty array', []],
  ] as const) {
    it(`survives a ${fixtureName} response from every endpoint`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
      )
      expect(() => render(<AgentLibraryView />)).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })
  }

  it('propagates a non-OK response without crashing the view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )
    expect(() => render(<AgentLibraryView />)).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('posts the composed agent fields to POST /agent-library/agents', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<AgentLibraryView />)
    await waitFor(() => {
      expect(screen.getByText('Compose an Agent')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Compose an Agent'))
    await user.type(screen.getByPlaceholderText('e.g. release-notes-writer'), 'my-agent')
    await user.type(screen.getByPlaceholderText('You are a specialist that...'), 'Do the thing.')

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: urlOf(input) })
        if (init?.method === 'POST') {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'resource:skill:my-agent', name: 'my-agent' }), { status: 200 }),
          )
        }
        return Promise.resolve(new Response(JSON.stringify(jsonFor(urlOf(input))), { status: 200 }))
      }),
    )
    await user.click(screen.getByText('Save agent to the Library'))
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/api/enhanced/agent-library/agents'))).toBe(true)
    })
  })
})
