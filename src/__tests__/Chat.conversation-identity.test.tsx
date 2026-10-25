// spec: WEBUI-APPS-R049.1.5
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import Chat from '@/Chat'
import ChatPanel from '@/components/ChatPanel'
import { PageContextProvider } from '@/lib/page-context'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/__tests__/fixtures'
import { conversationOwnerKey } from '@/lib/chat-store'
import type { PageContextEnvelope } from '@/lib/page-context'

const caller = vi.hoisted(() => ({
  userKey: 'local',
  tenant: null as string | null,
  loading: false,
  needsSignIn: false,
}))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useIdentity: () => ({
    identity: {
      userKey: caller.userKey,
      role: 'admin',
      ssoConfigured: false,
      needsSignIn: caller.needsSignIn,
      raw: caller.tenant ? { tenant: caller.tenant } : null,
    },
    loading: caller.loading,
  }),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

const pageContext: PageContextEnvelope = {
  schemaVersion: '1.0',
  route: '/chat',
  view: 'chat',
  selection: [],
  filters: {},
  allowedActions: [],
  capturedAt: new Date().toISOString(),
}

let pendingSend = false
let responseMetadata: ((conversation: string) => unknown) | undefined
let changedStreamRun = false
let invalidateStreamUsage = false
let partialStreamUsage: 'message-metadata' | 'finish' | undefined
let sentBodies: Record<string, unknown>[] = []

let fetchImpl: (path: string) => Promise<Response> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/chat')
  window.localStorage.clear()
  fetchImpl = () => undefined
  sentBodies = []
  caller.userKey = 'local'
  caller.tenant = null
  caller.loading = false
  caller.needsSignIn = false
  pendingSend = false
  responseMetadata = undefined
  changedStreamRun = false
  invalidateStreamUsage = false
  partialStreamUsage = undefined

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const path = url.replace(/^https?:\/\/[^/]+/, '')

      if (path === '/api/chats/messages') {
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        if (pendingSend)
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
        const events: unknown[] = [{ type: 'start', messageId: 'reply' }]
        if (responseMetadata) {
          events.push(
            { type: 'text-start', id: 'text' },
            { type: 'text-delta', id: 'text', delta: 'Measured reply' },
            { type: 'text-end', id: 'text' },
            { type: 'message-metadata', messageMetadata: responseMetadata(String(sentBodies.at(-1)?.id)) },
          )
        }
        if (changedStreamRun) {
          const metadata = usageMetadata(String(sentBodies.at(-1)?.id))
          metadata.arbora_run.run_id = 'other-run'
          metadata.arbora.usage.runId = 'other-run'
          events.push({ type: 'message-metadata', messageMetadata: metadata })
        }
        if (invalidateStreamUsage) {
          events.push({
            type: 'message-metadata',
            messageMetadata: { ...usageMetadata(String(sentBodies.at(-1)?.id)), arbora: { usage: null } },
          })
        }
        if (partialStreamUsage) {
          const metadata = usageMetadata(String(sentBodies.at(-1)?.id))
          events.push({
            type: partialStreamUsage,
            messageMetadata: {
              ...metadata,
              arbora: { usage: { ...metadata.arbora.usage, counts: { total_tokens: 0 } } },
            },
          })
        }
        if (partialStreamUsage !== 'finish') events.push({ type: 'finish' })
        const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
        return Promise.resolve(
          new Response(body, {
            headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          }),
        )
      }
      const custom = fetchImpl(path)
      if (custom) return custom

      if (path.startsWith('/api/chats/')) {
        return Promise.resolve(jsonResponse({ messages: [] }))
      }

      if (path.startsWith('/api/configure')) {
        return Promise.resolve(
          jsonResponse({
            models: [
              { id: 'model-a', name: 'Model A', builtinTools: ['search'] },
              { id: 'model-b', name: 'Model B', builtinTools: [] },
            ],
            builtinTools: [{ id: 'search', name: 'Search' }],
          }),
        )
      }
      if (path.startsWith('/api/enhanced/models')) {
        return Promise.resolve(
          jsonResponse({
            models: [
              { id: 'model-a', name: 'Model A' },
              { id: 'model-b', name: 'Model B' },
            ],
            default_id: 'model-a',
          }),
        )
      }
      if (path.startsWith('/auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: false, roles: [] }))
      }
      return Promise.resolve(jsonResponse([]))
    }),
  )
})

describe('Chat conversation identity', () => {
  it('uses the first persisted conversation ID on first and subsequent sends', async () => {
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
    const input = await screen.findByRole('textbox', { name: /message input/i })
    await user.type(input, 'hello{Enter}')
    await waitFor(() => {
      expect(sentBodies).toHaveLength(1)
    })
    const entries = JSON.parse(
      window.localStorage.getItem('chat:["owner-v1",null,"local"]:conversationIds') ?? '[]',
    ) as { id: string }[]
    expect(entries).toHaveLength(1)
    expect(sentBodies[0].id).toBe(entries[0].id)
    await user.type(input, 'again{Enter}')
    await waitFor(() => {
      expect(sentBodies).toHaveLength(2)
    })
    expect(sentBodies[1].id).toBe(sentBodies[0].id)
  })

  it('uses selected conversation and never merges another conversation history', async () => {
    window.history.replaceState({}, '', '/chat?conversation=chosen')
    window.localStorage.setItem(
      'chat:["owner-v1",null,"local"]:messages:/chosen',
      JSON.stringify([{ id: 'prior', role: 'user', parts: [{ type: 'text', text: 'chosen history' }] }]),
    )
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
    const input = await screen.findByRole('textbox', { name: /message input/i })
    await user.type(input, 'next{Enter}')
    await waitFor(() => {
      expect(sentBodies).toHaveLength(1)
    })
    expect(sentBodies[0].id).toBe('/chosen')
    expect(JSON.stringify(sentBodies[0].messages)).toContain('chosen history')
  })
})

describe('in-flight conversation isolation', () => {
  it.each(['conversation', 'caller'] as const)('does not persist old messages while switching %s', async (kind) => {
    const historyError = vi.spyOn(console, 'error')
    pendingSend = true
    window.history.replaceState({}, '', '/chat?conversation=first')
    window.localStorage.setItem(
      'chat:["owner-v1",null,"local"]:messages:/first',
      JSON.stringify([{ id: 'existing', role: 'assistant', parts: [{ type: 'text', text: 'first session ready' }] }]),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const app = () => (
      <QueryClientProvider client={client}>
        <Chat pageContext={pageContext} />
      </QueryClientProvider>
    )
    const view = render(app())
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'private first turn{Enter}')
    await waitFor(() => {
      expect(sentBodies).toHaveLength(1)
    })
    const nextOwner = kind === 'caller' ? 'other' : 'local'
    const nextConversation = kind === 'conversation' ? '/second' : '/first'
    if (kind === 'caller') {
      caller.userKey = nextOwner
      view.rerender(app())
    } else {
      act(() => {
        window.history.pushState({}, '', '/chat?conversation=second')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
    }
    expect(screen.queryByText('private first turn')).not.toBeInTheDocument()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550))
    })
    expect(
      window.localStorage.getItem(
        `chat:${JSON.stringify(['owner-v1', null, nextOwner])}:messages:${nextConversation}`,
      ) ?? '',
    ).not.toContain('private first turn')
    expect(screen.queryByText('private first turn')).not.toBeInTheDocument()
    expect(historyError).not.toHaveBeenCalledWith('Failed to fetch messages for conversation', expect.anything())
  })
})

it('switches cached A to cached B without copying A into B before or after the throttle window', async () => {
  window.history.replaceState({}, '', '/chat?conversation=cached-a')
  const history = (text: string) => [{ id: text, role: 'assistant', parts: [{ type: 'text', text }] }]
  const first = history('Conversation A private reply')
  const second = history('Conversation B own reply')
  window.localStorage.setItem('chat:["owner-v1",null,"local"]:messages:/cached-a', JSON.stringify(first))
  window.localStorage.setItem('chat:["owner-v1",null,"local"]:messages:/cached-b', JSON.stringify(second))
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(await screen.findByText('Conversation A private reply')).toBeInTheDocument()
  act(() => {
    window.history.pushState({}, '', '/chat?conversation=cached-b')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.queryByText('Conversation A private reply')).not.toBeInTheDocument()
  expect(await screen.findByText('Conversation B own reply')).toBeInTheDocument()
  expect(
    JSON.parse(window.localStorage.getItem('chat:["owner-v1",null,"local"]:messages:/cached-b') ?? 'null'),
  ).toEqual(second)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550))
  })
  expect(screen.queryByText('Conversation A private reply')).not.toBeInTheDocument()
  expect(
    JSON.parse(window.localStorage.getItem('chat:["owner-v1",null,"local"]:messages:/cached-b') ?? 'null'),
  ).toEqual(second)
  expect(
    JSON.parse(window.localStorage.getItem('chat:["owner-v1",null,"local"]:messages:/cached-a') ?? 'null'),
  ).toEqual(first)
})

it('isolates the same subject when the observed tenant changes', async () => {
  caller.userKey = 'same-subject'
  caller.tenant = 'tenant-a'
  window.history.replaceState({}, '', '/chat?conversation=shared-label')
  const ownerA = conversationOwnerKey({
    userKey: caller.userKey,
    raw: { authenticated: true, roles: [], tenant: 'tenant-a' },
  })
  const ownerB = conversationOwnerKey({
    userKey: caller.userKey,
    raw: { authenticated: true, roles: [], tenant: 'tenant-b' },
  })
  const records = (text: string) => [{ id: text, role: 'assistant', parts: [{ type: 'text', text }] }]
  window.localStorage.setItem(`chat:${ownerA}:messages:/shared-label`, JSON.stringify(records('Tenant A reply')))
  window.localStorage.setItem(`chat:${ownerB}:messages:/shared-label`, JSON.stringify(records('Tenant B reply')))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  expect(await screen.findByText('Tenant A reply')).toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: /message input/i })
  // The fixture needs a populated draft, not per-character keyboard behavior.
  fireEvent.change(input, { target: { value: 'private tenant A draft' } })
  expect(input).toHaveValue('private tenant A draft')
  caller.tenant = 'tenant-b'
  view.rerender(app())
  expect(screen.queryByText('Tenant A reply')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /message input/i })).toHaveValue('')
  expect(await screen.findByText('Tenant B reply')).toBeInTheDocument()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550))
  })
  expect(JSON.parse(window.localStorage.getItem(`chat:${ownerB}:messages:/shared-label`) ?? 'null')).toEqual(
    records('Tenant B reply'),
  )
  expect(JSON.parse(window.localStorage.getItem(`chat:${ownerA}:messages:/shared-label`) ?? 'null')).toEqual(
    records('Tenant A reply'),
  )
})

it('does not mount history or start chat queries while identity is unresolved', () => {
  caller.loading = true
  window.history.replaceState({}, '', '/chat?conversation=old-local')
  window.localStorage.setItem(
    'chat:["owner-v1",null,"local"]:messages:/old-local',
    JSON.stringify([{ id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'Unresolved private history' }] }]),
  )
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(screen.getByRole('status')).toHaveTextContent('Checking conversation access')
  expect(screen.queryByText('Unresolved private history')).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const retirements = [
  [
    'subject change',
    () => {
      caller.userKey = 'new-owner'
    },
  ],
  [
    'tenant change',
    () => {
      caller.tenant = 'other-tenant'
    },
  ],
  [
    'session denial',
    () => {
      caller.needsSignIn = true
    },
  ],
  [
    'unresolved session',
    () => {
      caller.loading = true
    },
  ],
] as const

it.each(retirements)('does not continue pending SWE creation after %s', async (_label, retire) => {
  let finishCreate!: () => void
  vi.spyOn(api, 'createSweSession').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCreate = () => {
          resolve({ session_id: 'old-session', backend: 'local', workdir: '/workspace' })
        }
      }),
  )
  const actSpy = vi.spyOn(api, 'sweAct').mockResolvedValue({ ok: true })
  const eventSource = vi.fn()
  vi.stubGlobal('EventSource', eventSource)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /toggle swe mode/i }))
  await user.type(screen.getByRole('textbox', { name: /message input/i }), 'old owner command{Enter}')
  await waitFor(() => {
    expect(api.createSweSession).toHaveBeenCalledTimes(1)
  })
  retire()
  view.rerender(app())
  await act(async () => {
    finishCreate()
    await Promise.resolve()
  })
  expect(eventSource).not.toHaveBeenCalled()
  expect(actSpy).not.toHaveBeenCalled()
})

it.each([
  ...retirements,
  [
    'conversation change',
    () => {
      window.history.pushState({}, '', '/chat?conversation=other')
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
  ],
] as const)('does not append a late attachment read after %s', async (_label, retire) => {
  let finishRead!: () => void
  class DeferredFileReader {
    onload: ((event: { target: { result: string } }) => void) | null = null
    readAsDataURL() {
      finishRead = () => {
        this.onload?.({ target: { result: 'data:image/png;base64,eA==' } })
      }
    }
  }
  vi.stubGlobal('FileReader', DeferredFileReader)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  await userEvent.setup().upload(input, new File(['x'], 'private.png', { type: 'image/png' }))
  act(() => {
    retire()
  })
  view.rerender(app())
  act(() => {
    finishRead()
  })
  expect(screen.queryByAltText('Attachment 1')).not.toBeInTheDocument()
})

it('preserves ambiguous legacy history and explains the migration gap without displaying its content', () => {
  const old = JSON.stringify([{ id: '/old', firstMessage: 'Private legacy content', timestamp: 1 }])
  window.localStorage.setItem('chat:local:conversationIds', old)
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(screen.getByText(/Older browser-only conversations are preserved/)).toBeInTheDocument()
  expect(screen.queryByText('Private legacy content')).not.toBeInTheDocument()
  expect(window.localStorage.getItem('chat:local:conversationIds')).toBe(old)
})

it('does not mount conversation state for a denied session', () => {
  caller.needsSignIn = true
  const reads = vi.spyOn(Storage.prototype, 'getItem')
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(screen.getByText(/Conversation access is not authorized/)).toBeInTheDocument()
  expect(reads).not.toHaveBeenCalled()
  expect(sentBodies).toEqual([])
})

describe('current assistant response task wiring', () => {
  it('shows only the latest matching non-streaming response task and withdraws it on conversation change', async () => {
    window.history.replaceState({}, '', '/chat?conversation=first')
    window.localStorage.setItem(
      'chat:["owner-v1",null,"local"]:messages:/first',
      JSON.stringify([
        {
          id: 'linked-reply',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Task completed' }],
          metadata: {
            arbora_run: {
              conversation_context: 'webui:/first',
              task_id: 'task-explicit',
              context_id: 'opaque-context',
            },
          },
        },
      ]),
    )
    renderWithProviders(<Chat pageContext={pageContext} />)
    const link = await screen.findByRole('link', { name: 'Inspect response task' })
    expect(screen.getByRole('log')).toHaveClass('min-h-24', 'shrink-0')
    expect(screen.getByTestId('chat-flow')).toHaveClass('overflow-auto')
    expect(screen.getByTestId('chat-composer')).toHaveClass('relative', 'shrink-0')
    expect(screen.getByTestId('chat-composer')).not.toHaveClass('sticky')
    expect(link).toHaveAttribute('href', '/workspace/work?conversation=%2Ffirst&task=task-explicit')
    act(() => {
      window.history.pushState({}, '', '/chat?conversation=second')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Inspect response task' })).not.toBeInTheDocument()
    })
  })
})

function usageMetadata(conversation = '/usage') {
  return {
    arbora_run: {
      conversation_context: `webui:${conversation}`,
      task_id: 'task',
      context_id: 'context',
      run_id: 'run',
    },
    arbora: {
      usage: {
        runId: 'run',
        taskId: 'task',
        contextId: 'context',
        scope: 'turn',
        counts: { requests: 0, input_tokens: 23 },
      },
    },
    // FunctionModel estimates must not masquerade as producer measurements.
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  }
}

function cacheUsage(messages: unknown[]) {
  window.history.replaceState({}, '', '/chat?conversation=usage')
  window.localStorage.setItem('chat:["owner-v1",null,"local"]:messages:/usage', JSON.stringify(messages))
}

function usageMessage(id: string, metadata: unknown = usageMetadata()) {
  return { id, role: 'assistant', metadata, parts: [{ type: 'text', text: `Reply ${id}` }] }
}

it('renders only known canonical counts, including zero, once per task/run replay', async () => {
  cacheUsage([usageMessage('first'), usageMessage('replay')])
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  expect(screen.getAllByRole('region', { name: 'Turn usage' })).toHaveLength(1)
  expect(screen.getByText('Requests:').parentElement).toHaveTextContent('Requests:0')
  expect(screen.getByText('Input tokens:').parentElement).toHaveTextContent('Input tokens:23')
  expect(screen.queryByText('Output tokens:')).not.toBeInTheDocument()
  expect(screen.queryByText('Total tokens:')).not.toBeInTheDocument()
  expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
})

it.each(['unavailable', 'denied', 'invalid', 'missing'])(
  'clears prior canonical counts on a %s replay',
  async (state) => {
    const metadata = usageMetadata()
    const usage =
      state === 'invalid'
        ? { ...metadata.arbora.usage, runId: 'foreign' }
        : state === 'missing'
          ? undefined
          : { status: state }
    cacheUsage([usageMessage('first'), usageMessage('replay', { ...metadata, arbora: { usage } })])
    renderWithProviders(<Chat pageContext={pageContext} />)
    expect(await screen.findByText('Turn usage: unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Turn usage' })).not.toBeInTheDocument()
    expect(screen.queryByText('Input tokens:')).not.toBeInTheDocument()
    expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
  },
)

it('keeps generic provider estimates separate from canonical turn counts', async () => {
  cacheUsage([
    usageMessage('canonical'),
    usageMessage('generic', { usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }),
  ])
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  expect(await screen.findByText(/Provider estimate: 5 tokens/)).toBeInTheDocument()
  expect(screen.queryByText(/Provider estimate: 305/)).not.toBeInTheDocument()
})

it.each(retirements)('clears canonical usage immediately on %s', async (_label, retire) => {
  cacheUsage([usageMessage('private')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  retire()
  view.rerender(app())
  expect(screen.queryByRole('region', { name: 'Turn usage' })).not.toBeInTheDocument()
  expect(screen.queryByText('Input tokens:')).not.toBeInTheDocument()
})

it('does not show canonical usage from a different conversation', async () => {
  cacheUsage([usageMessage('foreign', usageMetadata('/other'))])
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(await screen.findByText('Reply foreign')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Turn usage' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
})

it('shows and persists canonical metadata from the actual AI SDK message stream', async () => {
  responseMetadata = usageMetadata
  const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'measure{Enter}')
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  expect(screen.getByText('Requests:').parentElement).toHaveTextContent('Requests:0')
  expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
  await waitFor(() => {
    const stored = JSON.parse(
      window.localStorage.getItem(`chat:["owner-v1",null,"local"]:messages:${String(sentBodies[0].id)}`) ?? '[]',
    ) as { metadata?: unknown }[]
    expect(stored).toHaveLength(2)
    expect(stored.at(-1)?.metadata).toEqual(usageMetadata(String(sentBodies[0].id)))
  })
})

it('clears a prior receipt when unavailable metadata updates the same streamed message', async () => {
  responseMetadata = usageMetadata
  invalidateStreamUsage = true
  const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'measure{Enter}')
  expect(await screen.findByText('Turn usage: unavailable')).toBeInTheDocument()
  expect(screen.queryByText('Input tokens:')).not.toBeInTheDocument()
  expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
})

it.each([undefined, 'changed-run'])('clears stale counts on replay with outer run %s', async (runId) => {
  const changed = usageMetadata()
  const identity: { run_id?: string } = changed.arbora_run
  identity.run_id = runId
  if (runId) changed.arbora.usage.runId = runId
  cacheUsage([usageMessage('first'), usageMessage('changed', changed)])
  renderWithProviders(<Chat pageContext={pageContext} />)
  expect(await screen.findByText('Turn usage: unavailable')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Turn usage' })).not.toBeInTheDocument()
})

it.each(['message-metadata', 'finish'] as const)(
  'replaces valid receipts with partial %s metadata without retaining omitted counters',
  async (chunk) => {
    responseMetadata = usageMetadata
    partialStreamUsage = chunk
    const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
    await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'measure{Enter}')
    expect(await screen.findByText('Total tokens:')).toBeInTheDocument()
    expect(screen.getByText('Total tokens:').parentElement).toHaveTextContent('Total tokens:0')
    expect(screen.queryByText('Requests:')).not.toBeInTheDocument()
    expect(screen.queryByText('Input tokens:')).not.toBeInTheDocument()
    expect(screen.queryByText(/Provider estimate:/)).not.toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(`chat:["owner-v1",null,"local"]:messages:${String(sentBodies[0].id)}`) ?? '[]',
      ) as { metadata?: { arbora?: { usage?: { counts: unknown } } } }[]
      expect(stored.at(-1)?.metadata?.arbora?.usage?.counts).toEqual({ total_tokens: 0 })
    })
  },
)

it('refuses self-consistent run substitution within one streamed assistant message', async () => {
  responseMetadata = usageMetadata
  changedStreamRun = true
  const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'measure{Enter}')
  expect(await screen.findByText('Turn usage: unavailable')).toBeInTheDocument()
  expect(screen.queryByText('Input tokens:')).not.toBeInTheDocument()
  await waitFor(() => {
    const stored = JSON.parse(
      window.localStorage.getItem(`chat:["owner-v1",null,"local"]:messages:${String(sentBodies[0].id)}`) ?? '[]',
    ) as { metadata?: { arbora_run?: { run_id: string }; arbora?: { usage: unknown } } }[]
    expect(stored).toHaveLength(2)
    expect(stored.at(-1)?.metadata?.arbora?.usage).toBeNull()
    expect(stored.at(-1)?.metadata?.arbora_run?.run_id).toBe('other-run')
  })
})

it('retires transport correlation on owner change before accepting the new owner receipt', async () => {
  cacheUsage([usageMessage('initial', {})])
  window.localStorage.setItem(
    'chat:["owner-v1",null,"other-owner"]:messages:/usage',
    JSON.stringify([usageMessage('other-initial', {})]),
  )
  responseMetadata = usageMetadata
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'first{Enter}')
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  caller.userKey = 'other-owner'
  view.rerender(app())
  expect(screen.queryByRole('region', { name: 'Turn usage' })).not.toBeInTheDocument()
  responseMetadata = (conversation) => {
    const metadata = usageMetadata(conversation)
    metadata.arbora_run.run_id = 'other-owner-run'
    metadata.arbora.usage.runId = 'other-owner-run'
    return metadata
  }
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'second{Enter}')
  expect(await screen.findByRole('region', { name: 'Turn usage' })).toBeInTheDocument()
  expect(screen.queryByText('Turn usage: unavailable')).not.toBeInTheDocument()
  expect(screen.getByText('Input tokens:').parentElement).toHaveTextContent('Input tokens:23')
})

// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3
it('retains the real dock composer across context changes and sends the current page context', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = (context: string) => (
    <QueryClientProvider client={client}>
      <PageContextProvider route={`/workspace/${context}`} view={context}>
        <ChatPanel currentView={context} isPrimary={false} />
      </PageContextProvider>
    </QueryClientProvider>
  )
  const view = render(app('work'))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  const input = await screen.findByRole('textbox', { name: /message input/i })
  await user.type(input, 'A retained workspace question')
  for (const context of ['explore', 'operate', 'work', 'explore']) {
    view.rerender(app(context))
    expect(screen.getAllByRole('textbox', { name: /message input/i })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: /message input/i })).toBe(input)
    expect(input).toHaveFocus()
    expect(input).toHaveValue('A retained workspace question')
  }
  const options = screen.getByRole('button', { name: 'Message options', hidden: true })
  fireEvent.click(options)
  expect(options).toHaveAttribute('aria-expanded', 'true')
  expect(input).toHaveValue('A retained workspace question')
  expect(sentBodies).toHaveLength(0)
  fireEvent.click(options)
  expect(options).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'Restore chat size' }))
  expect(input).not.toBeVisible()
  expect(input).toHaveValue('A retained workspace question')
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  expect(screen.getByRole('textbox', { name: /message input/i })).toBe(input)
  await user.click(screen.getByRole('button', { name: 'Focus message input' }))
  await user.keyboard('{Enter}')
  await waitFor(() => {
    expect(sentBodies).toHaveLength(1)
  })
  expect(JSON.stringify(sentBodies[0])).toContain('/workspace/explore')
  expect(JSON.stringify(sentBodies[0])).not.toContain('/workspace/work')
  expect(screen.getByRole('region', { name: 'Workspace assistant' })).toBeVisible()
})

it('retires the real native dock draft on owner change and session loss', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <PageContextProvider route="/workspace/explore" view="explore">
        <ChatPanel currentView="explore" isPrimary={false} />
      </PageContextProvider>
    </QueryClientProvider>
  )
  const view = render(app())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  const input = await screen.findByRole('textbox', { name: /message input/i })
  fireEvent.change(input, { target: { value: 'Private owner draft' } })
  expect(input).toHaveValue('Private owner draft')
  caller.tenant = 'new-tenant'
  view.rerender(app())
  expect(screen.getByRole('textbox', { name: /message input/i })).toHaveValue('')
  const nextInput = screen.getByRole('textbox', { name: /message input/i })
  fireEvent.change(nextInput, { target: { value: 'Private new-owner draft' } })
  expect(nextInput).toHaveValue('Private new-owner draft')
  caller.needsSignIn = true
  view.rerender(app())
  expect(screen.queryByRole('textbox', { name: /message input/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/Private.*draft/)).not.toBeInTheDocument()
  expect(sentBodies).toHaveLength(0)
})

it('derives compact status from the canonical pending request and retires it with the owner', async () => {
  pendingSend = true
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <PageContextProvider route="/workspace/work" view="work">
        <header>
          <div id="workspace-assistant-entry-slot" />
        </header>
        <ChatPanel currentView="work" isPrimary={false} />
      </PageContextProvider>
    </QueryClientProvider>
  )
  const view = render(app())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  await user.type(await screen.findByRole('textbox', { name: /message input/i }), 'Pending turn{Enter}')
  await waitFor(() => {
    expect(sentBodies).toHaveLength(1)
  })
  await user.click(screen.getByRole('button', { name: 'Restore chat size' }))
  expect(document.getElementById('workspace-assistant')).not.toBeVisible()
  expect(screen.getByText('Waiting for reply…')).toHaveClass('chat-compact-status')
  expect(document.getElementById('workspace-assistant-entry-slot')).toContainElement(
    screen.getByText('Waiting for reply…'),
  )
  caller.needsSignIn = true
  view.rerender(app())
  expect(screen.queryByText('Waiting for reply…')).not.toBeInTheDocument()
  expect(screen.getByText('Conversation access is not authorized. Sign in to continue.')).toBeVisible()
})

it('retires the existing pending approval presence when the conversation owner changes', async () => {
  window.history.replaceState({}, '', '/chat?conversation=pending-review')
  localStorage.setItem(
    'chat:["owner-v1",null,"local"]:messages:/pending-review',
    JSON.stringify([
      {
        id: 'pending',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Private review parameters' }],
        annotations: [{ event: 'approval_required', data: { tool_call_id: 'review-1', tool_name: 'synthetic' } }],
      },
    ]),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = () => (
    <QueryClientProvider client={client}>
      <Chat pageContext={pageContext} />
    </QueryClientProvider>
  )
  const view = render(app())
  expect(await screen.findByRole('group', { name: 'Required approval' })).toHaveAttribute('data-chat-approval-pending')
  caller.tenant = 'new-owner'
  view.rerender(app())
  expect(document.querySelector('[data-chat-approval-pending]')).toBeNull()
  expect(screen.queryByText('Private review parameters')).not.toBeInTheDocument()
  expect(sentBodies).toHaveLength(0)
})

it('does not steal fresh task-entry focus for a native secondary assistant', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = (show: boolean) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <div>
          <button>Current task</button>
          {show && (
            <PageContextProvider route="/workspace/explore" view="explore">
              <ChatPanel currentView="explore" isPrimary={false} />
            </PageContextProvider>
          )}
        </div>
      </QueryClientProvider>
    </StrictMode>
  )
  const view = render(app(false))
  const task = screen.getByRole('button', { name: 'Current task' })
  task.focus()
  view.rerender(app(true))
  await screen.findByLabelText('Message input', { exact: true })
  expect(task).toHaveFocus()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Expand chat' }))
  await userEvent.setup().click(screen.getByRole('button', { name: 'Focus message input' }))
  expect(screen.getByRole('textbox', { name: /message input/i })).toHaveFocus()
})
