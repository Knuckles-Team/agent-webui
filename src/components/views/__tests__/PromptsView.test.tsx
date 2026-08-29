/**
 * Lane 4 fix: the Prompts Registry (`PromptsView.tsx`) had a sidebar list
 * and an edit panel bound to an existing prompt, but no way to reach a
 * blank "create a new prompt" form. `PUT /api/enhanced/prompts/{name}` is a
 * genuine upsert with no server-side existence check, so the fix must also
 * guard against a "create" silently overwriting an existing name.
 *
 * Mirrors this repo's convention for view-level catalog tests
 * (see LLMTemplatesView.test.tsx) — a mocked global `fetch` standing in for
 * `/api/enhanced/prompts*`.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PromptsView from '@/components/views/PromptsView'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const EXISTING_PROMPT_SUMMARY = {
  name: 'release-notes-writer',
  title: 'Release Notes Writer',
  goal: 'Summarize a diff into release notes',
  core_directive: 'Write terse, accurate release notes.',
  file_path: '/prompts/release-notes-writer.json',
}

const EXISTING_PROMPT_DETAIL = {
  task: 'release-notes-writer',
  type: 'prompt',
  title: 'Release Notes Writer',
  goal: 'Summarize a diff into release notes',
  core_directive: 'Write terse, accurate release notes.',
  version: '1.0.0',
  identity: { role: 'Release Notes Writer', goal: 'Summarize a diff into release notes' },
  instructions: { core_directive: 'Write terse, accurate release notes.' },
  tools: [],
  metadata: { topic: '', tone: '', style: '' },
}

type PromptFetchOverrides = Partial<Record<'put' | 'detail' | 'list', () => Response>>

function recordPutCall(putCalls: { url: string; body: unknown }[], url: string, init?: RequestInit): void {
  putCalls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null })
}

function promptDetailOrListResponse(url: string, overrides: PromptFetchOverrides): Response | null {
  if (/\/api\/enhanced\/prompts\/[^/]+$/.test(url)) {
    return overrides.detail?.() ?? jsonResponse(EXISTING_PROMPT_DETAIL)
  }
  if (url.includes('/api/enhanced/prompts')) return overrides.list?.() ?? jsonResponse([EXISTING_PROMPT_SUMMARY])
  return null
}

function mockPromptResponse(
  url: string,
  init: RequestInit | undefined,
  overrides: PromptFetchOverrides,
  putCalls: { url: string; body: unknown }[],
): Promise<Response> {
  if (init?.method === 'PUT') {
    recordPutCall(putCalls, url, init)
    return Promise.resolve(overrides.put?.() ?? jsonResponse({ status: 'success' }))
  }
  const response = promptDetailOrListResponse(url, overrides)
  return response ? Promise.resolve(response) : Promise.reject(new Error(`unexpected fetch: ${url}`))
}

function mockFetch(overrides: PromptFetchOverrides = {}) {
  const putCalls: { url: string; body: unknown }[] = []
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    mockPromptResponse(urlOf(input), init, overrides, putCalls),
  ) as unknown as typeof fetch
  return putCalls
}

interface DelayedDetailState {
  pendingDetails: Map<string, (response: Response) => void>
  detailSignals: Map<string, AbortSignal | null | undefined>
}

function delayedDetailResponse(
  url: string,
  init: RequestInit | undefined,
  state: DelayedDetailState,
): Promise<Response> | null {
  if (!/\/api\/enhanced\/prompts\/[^/]+$/.test(url)) return null
  const name = url.slice(url.lastIndexOf('/') + 1)
  return new Promise<Response>((resolve) => {
    // Deliberately ignore abort here: a real server may still finish a
    // response after the client aborts, so the sequence guard must be
    // independently responsible for preventing stale state writes.
    state.pendingDetails.set(name, resolve)
    state.detailSignals.set(name, init?.signal)
  })
}

function delayedPromptResponse(
  url: string,
  init: RequestInit | undefined,
  state: DelayedDetailState,
  listResponse: unknown,
): Promise<Response> {
  const detailResponse = delayedDetailResponse(url, init, state)
  if (detailResponse) return detailResponse
  if (url === '/api/enhanced/prompts') return Promise.resolve(jsonResponse(listResponse))
  return Promise.reject(new Error(`unexpected fetch: ${url}`))
}

function resolveDelayedDetail(state: DelayedDetailState, name: string, response: Response): void {
  const resolve = state.pendingDetails.get(name)
  if (resolve) resolve(response)
}

function signalWasAborted(state: DelayedDetailState, name: string): boolean {
  const signal = state.detailSignals.get(name)
  return signal ? signal.aborted : false
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PromptsView — create a new prompt (Lane 4)', () => {
  it('the "New" button reveals an editable blank form', async () => {
    mockFetch()
    render(<PromptsView />)

    const newButton = await screen.findByTitle('New prompt')
    await userEvent.click(newButton)

    expect(screen.getByText('New Prompt')).toBeInTheDocument()
    const nameInput = screen.getByLabelText('Prompt Name (id) *') as HTMLInputElement
    expect(nameInput).toBeInTheDocument()
    expect(nameInput.value).toBe('')
    // Blank editable directive field, not bound to any prior GET.
    expect(screen.getByRole('button', { name: /create prompt/i })).toBeInTheDocument()
  })

  it('refreshing while editing a new prompt preserves the draft form', async () => {
    mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    const nameInput = screen.getByLabelText('Prompt Name (id) *')
    await userEvent.type(nameInput, 'refresh-safe-draft')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh prompts' }))

    await waitFor(() => {
      expect(screen.getByText('New Prompt')).toBeInTheDocument()
      expect(screen.getByLabelText('Prompt Name (id) *')).toHaveValue('refresh-safe-draft')
    })
  })

  it('saving a new prompt PUTs to the correct URL with the entered name', async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    const newButton = await screen.findByTitle('New prompt')
    await userEvent.click(newButton)

    const nameInput = screen.getByLabelText('Prompt Name (id) *')
    await userEvent.type(nameInput, 'my-new-prompt')

    const saveButton = screen.getByRole('button', { name: /create prompt/i })
    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(putCalls.some((c) => c.url.includes('/api/enhanced/prompts/my-new-prompt'))).toBe(true)
    })
  })

  it('an invalid name is rejected client-side with a visible error and does NOT issue a request', async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    const newButton = await screen.findByTitle('New prompt')
    await userEvent.click(newButton)

    const nameInput = screen.getByLabelText('Prompt Name (id) *')
    await userEvent.type(nameInput, 'bad name!!')

    const saveButton = screen.getByRole('button', { name: /create prompt/i })
    await userEvent.click(saveButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/letters, numbers/i)
    expect(putCalls.length).toBe(0)
  })

  it('creating a name that already exists does NOT silently overwrite', async () => {
    const putCalls = mockFetch()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PromptsView />)

    const newButton = await screen.findByTitle('New prompt')
    await userEvent.click(newButton)

    // Wait for the existing prompt to have loaded into the sidebar list so
    // the collision check has something to compare against.
    await screen.findByText('Release Notes Writer')

    const nameInput = screen.getByLabelText('Prompt Name (id) *')
    await userEvent.type(nameInput, 'release-notes-writer')

    const saveButton = screen.getByRole('button', { name: /create prompt/i })
    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled()
    })
    expect(putCalls.length).toBe(0)
  })

  it("accepts a tool identifier at the server's exact 512 UTF-8-byte boundary", async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    await userEvent.type(screen.getByLabelText('Prompt Name (id) *'), 'utf8-boundary')
    await userEvent.click(screen.getByRole('button', { name: /raw json/i }))

    // 256 copies of `é` are 256 JavaScript characters but exactly 512 UTF-8
    // bytes. A character-count check would exercise a different contract.
    const toolName = 'é'.repeat(256)
    const jsonEditor = screen.getByLabelText('Prompt configuration JSON')
    fireEvent.change(jsonEditor, { target: { value: JSON.stringify({ tools: [toolName] }) } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /create prompt/i }))

    await waitFor(() => {
      expect(putCalls).toHaveLength(1)
    })
    expect((putCalls[0].body as { tools: string[] }).tools).toEqual([toolName])
  })

  it('rejects a tool identifier at 513 UTF-8 bytes before issuing a PUT', async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    await userEvent.type(screen.getByLabelText('Prompt Name (id) *'), 'utf8-too-long')
    await userEvent.click(screen.getByRole('button', { name: /raw json/i }))

    const toolName = `${'é'.repeat(256)}a`
    fireEvent.change(screen.getByLabelText('Prompt configuration JSON'), {
      target: { value: JSON.stringify({ tools: [toolName] }) },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/512 UTF-8 bytes or fewer/)
    expect(screen.getByRole('button', { name: /create prompt/i })).toBeDisabled()
    expect(putCalls).toHaveLength(0)
  })

  it("accepts a tool collection at the server's exact 256-item boundary", async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    await userEvent.type(screen.getByLabelText('Prompt Name (id) *'), 'tool-count-boundary')
    await userEvent.click(screen.getByRole('button', { name: /raw json/i }))

    const tools = Array.from({ length: 256 }, (_, index) => `tool-${index}`)
    fireEvent.change(screen.getByLabelText('Prompt configuration JSON'), {
      target: { value: JSON.stringify({ tools }) },
    })
    await userEvent.click(screen.getByRole('button', { name: /create prompt/i }))

    await waitFor(() => {
      expect(putCalls).toHaveLength(1)
    })
    expect((putCalls[0].body as { tools: string[] }).tools).toHaveLength(256)
  })

  it('rejects a 257-item tool collection before issuing a PUT', async () => {
    const putCalls = mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    await userEvent.type(screen.getByLabelText('Prompt Name (id) *'), 'tool-count-too-large')
    await userEvent.click(screen.getByRole('button', { name: /raw json/i }))

    const tools = Array.from({ length: 257 }, (_, index) => `tool-${index}`)
    fireEvent.change(screen.getByLabelText('Prompt configuration JSON'), {
      target: { value: JSON.stringify({ tools }) },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 256 tools/)
    expect(screen.getByRole('button', { name: /create prompt/i })).toBeDisabled()
    expect(putCalls).toHaveLength(0)
  })

  it('accepts a valid identifier beyond the former 128-character client limit', async () => {
    mockFetch()
    render(<PromptsView />)

    await userEvent.click(await screen.findByTitle('New prompt'))
    const toolName = 't'.repeat(129)
    const toolInput = screen.getByPlaceholderText(/Enter tool or skill name/i)
    await userEvent.type(toolInput, toolName)
    await userEvent.click(screen.getByRole('button', { name: /bind tool/i }))

    expect(screen.getByRole('button', { name: `Remove ${toolName}` })).toBeInTheDocument()
  })

  it('aborts the previous detail request and ignores its delayed response', async () => {
    const user = userEvent.setup()
    const alphaSummary = {
      ...EXISTING_PROMPT_SUMMARY,
      name: 'alpha-prompt',
      title: 'Alpha Prompt',
      goal: 'Alpha goal',
    }
    const betaSummary = {
      ...EXISTING_PROMPT_SUMMARY,
      name: 'beta-prompt',
      title: 'Beta Prompt',
      goal: 'Beta goal',
    }
    const alphaDetail = {
      ...EXISTING_PROMPT_DETAIL,
      title: 'Alpha Prompt',
      goal: 'Alpha goal',
      identity: { role: 'Alpha Prompt', goal: 'Alpha goal' },
    }
    const betaDetail = {
      ...EXISTING_PROMPT_DETAIL,
      title: 'Beta Prompt',
      goal: 'Beta goal',
      identity: { role: 'Beta Prompt', goal: 'Beta goal' },
    }
    const pendingDetails = new Map<string, (response: Response) => void>()
    const detailSignals = new Map<string, AbortSignal | null | undefined>()
    const delayedState = { pendingDetails, detailSignals }

    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      delayedPromptResponse(urlOf(input), init, delayedState, [alphaSummary, betaSummary]),
    ) as unknown as typeof fetch

    render(<PromptsView />)
    await screen.findByRole('button', { name: 'Edit prompt Alpha Prompt' })
    await waitFor(() => {
      expect(pendingDetails.has('alpha-prompt')).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: 'Edit prompt Beta Prompt' }))
    await waitFor(() => {
      expect(pendingDetails.has('beta-prompt')).toBe(true)
    })
    expect(signalWasAborted(delayedState, 'alpha-prompt')).toBe(true)

    await act(async () => {
      resolveDelayedDetail(delayedState, 'beta-prompt', jsonResponse(betaDetail))
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('Beta goal')).toBeInTheDocument()
    })

    // Resolve the stale response after the current selection has rendered.
    await act(async () => {
      resolveDelayedDetail(delayedState, 'alpha-prompt', jsonResponse(alphaDetail))
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('Beta goal')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Alpha goal')).not.toBeInTheDocument()
    })
  })
})
