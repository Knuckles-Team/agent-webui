/**
 * BUG-260: LLM template creation must allow creating a template AND
 * adding/modifying the model-settings fields AgentConfig actually permits,
 * for both chat and embedding models, with the editable field set DERIVED
 * from AgentConfig's own JSON Schema rather than hand-maintained.
 *
 * This proves the whole discover -> render -> edit -> save path against a
 * mocked `fetch` standing in for `/api/enhanced/llm/*`, matching the repo's
 * convention for view-level catalog tests (IntegrationsView.test.tsx).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LLMTemplatesView from '@/components/views/LLMTemplatesView'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A trimmed-but-real shape of what `ChatModelConfig.model_json_schema()`
 * (flattened server-side) produces -- enough fields to prove the form is
 * genuinely schema-driven: a required string (`provider`), a boolean
 * (`vision`), and an integer (`context_window`). */
const CHAT_SCHEMA = {
  properties: {
    id: { type: 'string', title: 'Id' },
    provider: { type: 'string', title: 'Provider' },
    vision: { type: 'boolean', title: 'Vision', default: false },
    context_window: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      title: 'Context Window',
      default: null,
    },
  },
  required: ['id', 'provider'],
}
const EMBEDDING_SCHEMA = {
  properties: {
    id: { type: 'string', title: 'Id' },
    provider: { type: 'string', title: 'Provider' },
    chunk_size: { type: 'integer', title: 'Chunk Size', default: 768 },
  },
  required: ['id', 'provider'],
}

const EXISTING_CHAT_MODEL = { id: 'qwen/qwen3', provider: 'openai', vision: true, context_window: 131072 }
const EXISTING_CHAT_MODEL_DETAIL = {
  id: 'qwen/qwen3',
  provider: 'openai',
  vision: true,
  context_window: 131072,
}

function mockFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  const putCalls: { url: string; body: unknown }[] = []
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (init?.method === 'PUT') {
      putCalls.push({ url, body: init.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(overrides.put ? overrides.put() : jsonResponse({ status: 'success' }))
    }
    if (url.includes('/llm/model-schema')) {
      return Promise.resolve(
        overrides.schema ? overrides.schema() : jsonResponse({ chat: CHAT_SCHEMA, embedding: EMBEDDING_SCHEMA }),
      )
    }
    if (url.includes('/llm/embedding-models')) {
      return Promise.resolve(overrides.embeddingModels ? overrides.embeddingModels() : jsonResponse([]))
    }
    if (url.includes('/llm/model-detail')) {
      return Promise.resolve(
        overrides.modelDetail ? overrides.modelDetail() : jsonResponse(EXISTING_CHAT_MODEL_DETAIL),
      )
    }
    if (url.includes('/llm/models')) {
      return Promise.resolve(overrides.models ? overrides.models() : jsonResponse([EXISTING_CHAT_MODEL]))
    }
    if (url.includes('/api/enhanced/prompts')) {
      return Promise.resolve(overrides.prompts ? overrides.prompts() : jsonResponse([]))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
  return putCalls
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LLMTemplatesView (BUG-260)', () => {
  it('renders the model list and its badges from AgentConfig chat_models', async () => {
    mockFetch()
    render(<LLMTemplatesView />)

    await waitFor(() => {
      expect(screen.getByText('qwen/qwen3')).toBeInTheDocument()
    })
    expect(screen.getByText('vision')).toBeInTheDocument()
  })

  it('selecting a model renders a schema-derived, EDITABLE settings form (not read-only)', async () => {
    mockFetch()
    render(<LLMTemplatesView />)

    const modelButton = await screen.findByText('qwen/qwen3')
    await userEvent.click(modelButton)

    // The schema declares "Vision" (boolean) and "Context Window" (integer) --
    // both must render as real, editable form controls, not static text.
    await waitFor(() => {
      expect(screen.getByLabelText('Vision')).toBeInTheDocument()
    })
    const visionSwitch = screen.getByLabelText('Vision')
    expect(visionSwitch).toHaveAttribute('data-state', 'checked') // detail said vision: true

    const contextWindowInput = screen.getByLabelText('Context Window') as HTMLInputElement
    expect(contextWindowInput.tagName).toBe('INPUT')
    expect(contextWindowInput.value).toBe('131072')
  })

  it('editing a field and saving PUTs the full upserted registry, validated by the server contract', async () => {
    const putCalls = mockFetch()
    render(<LLMTemplatesView />)

    const modelButton = await screen.findByText('qwen/qwen3')
    await userEvent.click(modelButton)

    const contextWindowInput = await screen.findByLabelText('Context Window')
    await userEvent.clear(contextWindowInput)
    await userEvent.type(contextWindowInput, '65536')

    const saveButton = screen.getByRole('button', { name: /save model settings/i })
    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(putCalls.some((c) => c.url.includes('/llm/models'))).toBe(true)
    })
    const call = putCalls.find((c) => c.url.includes('/llm/models'))
    const body = call?.body as { models: { id: string; context_window: number }[] }
    const saved = body.models.find((m) => m.id === 'qwen/qwen3')
    expect(saved?.context_window).toBe(65536)
  })

  it('supports creating a BRAND NEW embedding model via the schema-derived form', async () => {
    const putCalls = mockFetch()
    render(<LLMTemplatesView />)

    // Switch to the "Embedding models" tab.
    const embeddingTab = await screen.findByRole('tab', { name: /embedding models/i })
    await userEvent.click(embeddingTab)

    const newModelButton = screen.getByRole('button', { name: /new embedding model/i })
    await userEvent.click(newModelButton)

    const idInput = await screen.findByPlaceholderText('e.g. qwen/qwen3.6-27b')
    await userEvent.type(idInput, 'bge-m3')
    const providerInput = screen.getByPlaceholderText('openai')
    await userEvent.type(providerInput, 'openai')

    // Chunk Size is embedding-only (BUG-260: BOTH kinds are editable).
    const chunkSizeInput = within(screen.getByText('Chunk Size').closest('div') as HTMLElement).getByRole('spinbutton')
    await userEvent.clear(chunkSizeInput)
    await userEvent.type(chunkSizeInput, '512')

    const saveButton = screen.getByRole('button', { name: /save model settings/i })
    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(putCalls.some((c) => c.url.includes('/llm/embedding-models'))).toBe(true)
    })
    const call = putCalls.find((c) => c.url.includes('/llm/embedding-models'))
    const body = call?.body as { models: { id: string; provider: string; chunk_size: number }[] }
    const saved = body.models.find((m) => m.id === 'bge-m3')
    expect(saved?.provider).toBe('openai')
    expect(saved?.chunk_size).toBe(512)
  })
})
