import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  signal?: AbortSignal
}
let calls: FetchCall[] = []

interface FetchOverride {
  matches: (url: string, init?: RequestInit) => boolean
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

interface PendingAgentRequest {
  request: Deferred<Response>
  signal?: AbortSignal
}

interface PostedNameCapture {
  value: string | undefined
}

function respondWithPostedName(capture: PostedNameCapture, _url: string, init?: RequestInit): Response {
  capture.value = postedNameFromBody(init?.body)
  return jsonResponse({ id: 'resource:skill:unicode-agent' })
}

function respondWithPendingAgent(
  pendingAgents: PendingAgentRequest[],
  _url: string,
  init?: RequestInit,
): Promise<Response> {
  const request = deferred<Response>()
  pendingAgents.push({ request, signal: init?.signal ?? undefined })
  return request.promise
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function isPostRequest(_url: string, init?: RequestInit): boolean {
  return init?.method === 'POST'
}

function isAgentListRequest(url: string, init?: RequestInit): boolean {
  return url.endsWith('/api/enhanced/agent-library/agents') && !init?.method
}

function postedNameFromBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body !== 'string') return undefined
  return (JSON.parse(body) as { name?: string }).name
}

interface JsonFixture {
  path: string
  body: unknown
}

const defaultJsonFixtures: JsonFixture[] = [
  {
    path: '/agent-library/agents',
    body: [
      {
        id: 'resource:skill:demo-agent',
        name: 'demo-agent',
        description: 'A demo agent.',
        kind: 'local',
        mcp_server: null,
        runnable_bound: true,
        status: 'active',
      },
    ],
  },
  {
    path: '/agent-library/suggestions',
    body: [{ mcp_server: 'demo-mcp', tool_count: 3, sample_tools: ['a', 'b'], reason: 'unused tools' }],
  },
  {
    path: '/agent-library/tools',
    body: [{ id: 'tool:1', name: 'demo_tool', mcp_server: 'demo-mcp', tags: [] }],
  },
  {
    path: '/agent-library/config-summary',
    body: { app_profile: 'dev', deployment_profile: 'tiny', chat_models: [], embedding_models: [] },
  },
]

function jsonFor(url: string): unknown {
  return defaultJsonFixtures.find((fixture) => url.includes(fixture.path))?.body ?? {}
}

function routedFetch(overrides: FetchOverride[], input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input)
  calls.push({ url, signal: init?.signal ?? undefined })
  const override = overrides.find((candidate) => candidate.matches(url, init))
  const response = override?.respond(url, init) ?? jsonResponse(jsonFor(url))
  return Promise.resolve(response)
}

function installFetch(overrides: FetchOverride[] = []): void {
  vi.stubGlobal('fetch', vi.fn(routedFetch.bind(null, overrides)))
}

describe('AgentLibraryView', () => {
  beforeEach(() => {
    calls = []
    installFetch()
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

  it('accepts a server-valid Unicode name with internal whitespace at 120 characters', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const postedName: PostedNameCapture = { value: undefined }
    installFetch([
      {
        matches: isPostRequest,
        respond: respondWithPostedName.bind(null, postedName),
      },
    ])

    render(<AgentLibraryView />)
    await user.click(screen.getByText('Compose an Agent'))

    const name = `${'😀'.repeat(60)} ${'😀'.repeat(59)}`
    const nameInput = screen.getByPlaceholderText('e.g. release-notes-writer')
    expect(Array.from(name)).toHaveLength(120)
    expect(nameInput).not.toHaveAttribute('maxLength')
    expect(nameInput).not.toHaveAttribute('pattern')
    fireEvent.change(nameInput, {
      target: { value: name },
    })
    fireEvent.change(screen.getByPlaceholderText('You are a specialist that...'), {
      target: { value: 'Do the thing.' },
    })

    await user.click(screen.getByRole('button', { name: 'Save agent to the Library' }))

    await waitFor(() => {
      expect(postedName.value).toBe(name)
    })
  })

  it('rejects a name longer than the server character bound before posting', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    let postCount = 0
    installFetch([
      {
        matches: isPostRequest,
        respond: () => {
          postCount += 1
          return jsonResponse({ id: 'resource:skill:too-long' })
        },
      },
    ])

    render(<AgentLibraryView />)
    await user.click(screen.getByText('Compose an Agent'))
    fireEvent.change(screen.getByPlaceholderText('e.g. release-notes-writer'), {
      target: { value: '😀'.repeat(121) },
    })
    fireEvent.change(screen.getByPlaceholderText('You are a specialist that...'), {
      target: { value: 'Do the thing.' },
    })

    await user.click(screen.getByRole('button', { name: 'Save agent to the Library' }))

    expect(postCount).toBe(0)
  })

  it('accepts an external URL at the server UTF-8-byte boundary', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<AgentLibraryView />)

    await user.click(screen.getByRole('tab', { name: 'External Agents' }))
    const url = `https://example.com/${'é'.repeat(1014)}`
    expect(new TextEncoder().encode(url).byteLength).toBe(2_048)
    fireEvent.change(screen.getByLabelText('Agent URL'), { target: { value: url } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register external agent' }))

    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/api/enhanced/agent-library/a2a'))).toBe(true)
    })
  })

  it('rejects an external URL one UTF-8 byte beyond the server bound', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    let postCount = 0
    installFetch([
      {
        matches: isPostRequest,
        respond: () => {
          postCount += 1
          return jsonResponse({ id: 'resource:agent:too-long-url' })
        },
      },
    ])
    render(<AgentLibraryView />)

    await user.click(screen.getByRole('tab', { name: 'External Agents' }))
    const url = `https://example.com/${'é'.repeat(1014)}a`
    expect(new TextEncoder().encode(url).byteLength).toBe(2_049)
    fireEvent.change(screen.getByLabelText('Agent URL'), { target: { value: url } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/2,048 UTF-8 bytes or fewer/)
    expect(screen.getByRole('button', { name: 'Register external agent' })).toBeDisabled()
    expect(postCount).toBe(0)
  })

  it('renders a malformed 2xx agent list as unavailable instead of confirmed empty', async () => {
    installFetch([{ matches: isAgentListRequest, respond: () => jsonResponse({}) }])

    render(<AgentLibraryView />)

    expect(await screen.findByText(/The Agent Library could not be fetched/)).toBeInTheDocument()
    expect(screen.queryByText(/No agents yet/)).not.toBeInTheDocument()
  })

  it('renders a valid empty 2xx agent list as confirmed empty', async () => {
    installFetch([{ matches: isAgentListRequest, respond: () => jsonResponse([]) }])

    render(<AgentLibraryView />)

    expect(await screen.findByText(/No agents yet/)).toBeInTheDocument()
    expect(screen.queryByText(/The Agent Library could not be fetched/)).not.toBeInTheDocument()
  })

  it('aborts superseded agent fetches and ignores a stale response', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const pendingAgents: PendingAgentRequest[] = []
    const oldAgent = {
      id: 'resource:skill:old-agent',
      name: 'old-agent',
      description: 'The stale response.',
      kind: 'local' as const,
    }
    const newAgent = {
      id: 'resource:skill:new-agent',
      name: 'new-agent',
      description: 'The current response.',
      kind: 'local' as const,
    }

    installFetch([
      {
        matches: isAgentListRequest,
        respond: respondWithPendingAgent.bind(null, pendingAgents),
      },
      {
        matches: isPostRequest,
        respond: () => jsonResponse({ id: 'resource:skill:created-agent' }),
      },
    ])

    render(<AgentLibraryView />)
    await waitFor(() => {
      expect(pendingAgents).toHaveLength(1)
    })

    await user.click(screen.getByText('Compose an Agent'))
    fireEvent.change(screen.getByPlaceholderText('e.g. release-notes-writer'), {
      target: { value: 'created-agent' },
    })
    fireEvent.change(screen.getByPlaceholderText('You are a specialist that...'), {
      target: { value: 'Do the thing.' },
    })
    await user.click(screen.getByRole('button', { name: 'Save agent to the Library' }))

    await waitFor(() => {
      expect(pendingAgents).toHaveLength(2)
    })
    expect(pendingAgents[0].signal).toBeDefined()
    expect(pendingAgents[0].signal!.aborted).toBe(true)

    await act(async () => {
      pendingAgents[1].request.resolve(new Response(JSON.stringify([newAgent]), { status: 200 }))
    })
    await waitFor(() => {
      expect(screen.getByText('new-agent')).toBeInTheDocument()
    })

    await act(async () => {
      pendingAgents[0].request.resolve(new Response(JSON.stringify([oldAgent]), { status: 200 }))
    })
    await waitFor(() => {
      expect(screen.getByText('new-agent')).toBeInTheDocument()
    })
    expect(screen.queryByText('old-agent')).not.toBeInTheDocument()
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

    installFetch([
      {
        matches: isPostRequest,
        respond: () => jsonResponse({ id: 'resource:skill:my-agent', name: 'my-agent' }),
      },
    ])
    await user.click(screen.getByText('Save agent to the Library'))
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/api/enhanced/agent-library/agents'))).toBe(true)
    })
  })
})
