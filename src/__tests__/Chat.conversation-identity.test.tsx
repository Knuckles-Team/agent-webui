// spec: WEBUI-APPS-R049.1.5
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import Chat from '@/Chat'
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
        return Promise.resolve(
          new Response('data: {"type":"start","messageId":"reply"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          }),
        )
      }
      const custom = fetchImpl(path)
      if (custom) return custom

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
  await userEvent.setup().type(screen.getByRole('textbox', { name: /message input/i }), 'private tenant A draft')
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
