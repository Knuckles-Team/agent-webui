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
import { render, screen, waitFor } from '@testing-library/react'
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

function mockFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  const putCalls: { url: string; body: unknown }[] = []
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (init?.method === 'PUT') {
      putCalls.push({ url, body: init.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(overrides.put ? overrides.put() : jsonResponse({ status: 'success' }))
    }
    if (/\/api\/enhanced\/prompts\/[^/]+$/.test(url)) {
      return Promise.resolve(overrides.detail ? overrides.detail() : jsonResponse(EXISTING_PROMPT_DETAIL))
    }
    if (url.includes('/api/enhanced/prompts')) {
      return Promise.resolve(overrides.list ? overrides.list() : jsonResponse([EXISTING_PROMPT_SUMMARY]))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
  return putCalls
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
})
