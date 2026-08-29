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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

type FetchOverride = (url: string, init?: RequestInit) => Response | Promise<Response>

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolveDeferred!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
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

const EXISTING_TEMPLATE_SUMMARY = {
  name: 'future-template',
  title: 'Original title',
  goal: 'Original goal',
  core_directive: 'Original directive',
  file_path: '/tmp/future-template.json',
}
const EXISTING_TEMPLATE_DETAIL = {
  ...EXISTING_TEMPLATE_SUMMARY,
  model: 'qwen/qwen3',
  parameters: {
    temperature: 0.7,
    top_p: 0.8,
    max_tokens: 4096,
    reasoning_effort: 'inherit',
    provider_option: 'retain-me',
  },
  metadata: { owner: 'future-client', revision: 7 },
  future_field: { enabled: true },
}

/** GET routes the mock answers, checked in this order — same as the original
 * if-chain — via URL substring match. Each entry's `key` looks up an optional
 * per-test `overrides` responder before falling back to its default body. */
const GET_ROUTES: { match: string; key: string; fallback: () => Response }[] = [
  {
    match: '/llm/model-schema',
    key: 'schema',
    fallback: () => jsonResponse({ chat: CHAT_SCHEMA, embedding: EMBEDDING_SCHEMA }),
  },
  { match: '/llm/embedding-models', key: 'embeddingModels', fallback: () => jsonResponse([]) },
  { match: '/llm/model-detail', key: 'modelDetail', fallback: () => jsonResponse(EXISTING_CHAT_MODEL_DETAIL) },
  { match: '/llm/models', key: 'models', fallback: () => jsonResponse([EXISTING_CHAT_MODEL]) },
  {
    match: '/api/enhanced/prompts/',
    key: 'templateDetail',
    fallback: () => jsonResponse(EXISTING_TEMPLATE_DETAIL),
  },
  { match: '/api/enhanced/prompts', key: 'prompts', fallback: () => jsonResponse([]) },
]

function mockFetch(overrides: Partial<Record<string, FetchOverride>> = {}) {
  const putCalls: { url: string; body: unknown }[] = []
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (init?.method === 'PUT') {
      putCalls.push({ url, body: init.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(overrides.put ? overrides.put(url, init) : jsonResponse({ status: 'success' }))
    }
    const route = GET_ROUTES.find((r) => url.includes(r.match))
    if (route) {
      const override = overrides[route.key]
      return Promise.resolve(override ? override(url, init) : route.fallback())
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
  return putCalls
}

function delayedDetailResponse(
  url: string,
  init: RequestInit | undefined,
  firstMatch: string,
  firstDetail: Deferred<Response>,
  secondDetail: Deferred<Response>,
  detailSignals: AbortSignal[],
): Promise<Response> {
  if (!url.includes(firstMatch)) return secondDetail.promise
  if (init?.signal) detailSignals.push(init.signal)
  return firstDetail.promise
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

    const idInput = await screen.findByPlaceholderText('e.g. qwen/qwen3.8-27b')
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

  it('switching from a new model draft to a new template clears model-entry mode', async () => {
    mockFetch()
    render(<LLMTemplatesView />)

    await userEvent.click(await screen.findByRole('button', { name: /new chat model/i }))
    expect(screen.getAllByText('New chat model')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'New template' }))

    expect(screen.getAllByText('qwen/qwen3')).toHaveLength(2)
    expect(screen.getAllByText('New chat model')).toHaveLength(1)
    expect(screen.getByLabelText('Template name (id) *')).toBeInTheDocument()
  })

  it('a Literal-typed model field renders a real dropdown of its permitted values, not free text', async () => {
    const ENUM_CHAT_SCHEMA = {
      properties: {
        id: { type: 'string', title: 'Id' },
        provider: { type: 'string', title: 'Provider' },
        intelligence_level: { type: 'string', enum: ['low', 'normal', 'high'], title: 'Intelligence Level' },
      },
      required: ['id', 'provider'],
    }
    mockFetch({
      schema: () => jsonResponse({ chat: ENUM_CHAT_SCHEMA, embedding: EMBEDDING_SCHEMA }),
      modelDetail: () => jsonResponse({ id: 'qwen/qwen3', provider: 'openai', intelligence_level: 'normal' }),
    })
    render(<LLMTemplatesView />)

    const modelButton = await screen.findByText('qwen/qwen3')
    await userEvent.click(modelButton)

    const select = (await screen.findByLabelText('Intelligence Level')) as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(expect.arrayContaining(['low', 'normal', 'high']))
    expect(select.value).toBe('normal')
  })

  it('removing a model PUTs the registry WITHOUT it (native remove)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const putCalls = mockFetch()
    render(<LLMTemplatesView />)

    const modelButton = await screen.findByText('qwen/qwen3')
    await userEvent.click(modelButton)

    const removeButton = await screen.findByRole('button', { name: /remove model/i })
    await userEvent.click(removeButton)

    await waitFor(() => {
      expect(putCalls.some((c) => c.url.includes('/llm/models'))).toBe(true)
    })
    const call = putCalls.find((c) => c.url.includes('/llm/models'))
    const body = call?.body as { models: { id: string }[] }
    expect(body.models.some((m) => m.id === 'qwen/qwen3')).toBe(false)
  })

  it('an unreachable model registry renders a distinct unavailable state, not "no models configured"', async () => {
    mockFetch({ models: () => jsonResponse({ detail: 'boom' }, 500) })
    render(<LLMTemplatesView />)

    await waitFor(() => {
      expect(screen.getByText(/could not be fetched/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/no chat models are configured/i)).not.toBeInTheDocument()
  })

  it('keeps invalid JSON raw, reports the parse error, and blocks model saves', async () => {
    const jsonSchema = {
      ...CHAT_SCHEMA,
      properties: {
        ...CHAT_SCHEMA.properties,
        routing: { type: 'object', title: 'Routing', default: { mode: 'fast' } },
      },
    }
    const putCalls = mockFetch({
      schema: () => jsonResponse({ chat: jsonSchema, embedding: EMBEDDING_SCHEMA }),
      modelDetail: () => jsonResponse({ ...EXISTING_CHAT_MODEL_DETAIL, routing: { mode: 'fast' } }),
    })
    render(<LLMTemplatesView />)

    await userEvent.click(await screen.findByText('qwen/qwen3'))
    const routing = await screen.findByLabelText('Routing (JSON)')
    fireEvent.change(routing, { target: { value: '{"mode":' } })

    await waitFor(() => {
      expect(routing).toHaveValue('{"mode":')
      expect(routing).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent(/valid JSON/i)
    })
    const saveButton = screen.getByRole('button', { name: /save model settings/i })
    expect(saveButton).toBeDisabled()
    expect(putCalls.filter((call) => call.url.includes('/llm/models'))).toHaveLength(0)
  })

  it('renders and enforces nested anyOf numeric constraints, including integer multipleOf', async () => {
    const nestedSchema = {
      properties: {
        id: { type: 'string', title: 'Id' },
        provider: { type: 'string', title: 'Provider' },
        sampling_ratio: {
          title: 'Sampling Ratio',
          anyOf: [
            {
              anyOf: [{ type: 'number', minimum: 0.25, maximum: 2, multipleOf: 0.25 }, { type: 'null' }],
            },
            { type: 'null' },
          ],
        },
        batch_size: {
          title: 'Batch Size',
          anyOf: [
            {
              anyOf: [{ type: 'integer', minimum: 2, maximum: 18, multipleOf: 4 }, { type: 'null' }],
            },
            { type: 'null' },
          ],
        },
      },
      required: ['id', 'provider'],
    }
    const putCalls = mockFetch({
      schema: () => jsonResponse({ chat: nestedSchema, embedding: EMBEDDING_SCHEMA }),
      modelDetail: () => jsonResponse({ id: 'qwen/qwen3', provider: 'openai', sampling_ratio: 0.5, batch_size: 8 }),
    })
    render(<LLMTemplatesView />)

    await userEvent.click(await screen.findByText('qwen/qwen3'))
    const ratio = (await screen.findByLabelText('Sampling Ratio')) as HTMLInputElement
    const batchSize = (await screen.findByLabelText('Batch Size')) as HTMLInputElement
    expect(ratio).toHaveAttribute('min', '0.25')
    expect(ratio).toHaveAttribute('max', '2')
    expect(ratio).toHaveAttribute('step', '0.25')
    expect(batchSize).toHaveAttribute('min', '2')
    expect(batchSize).toHaveAttribute('max', '18')
    expect(batchSize).toHaveAttribute('step', '4')

    fireEvent.change(ratio, { target: { value: '0.3' } })
    await waitFor(() => {
      expect(ratio).toHaveValue(0.3)
    })
    await userEvent.click(screen.getByRole('button', { name: /save model settings/i }))
    expect(putCalls.filter((call) => call.url.includes('/llm/models'))).toHaveLength(0)
  })

  it('retains unknown template fields and accepts provider-specific parameter ranges', async () => {
    const putCalls = mockFetch({
      prompts: () => jsonResponse([EXISTING_TEMPLATE_SUMMARY]),
      templateDetail: () => jsonResponse(EXISTING_TEMPLATE_DETAIL),
    })
    render(<LLMTemplatesView />)

    const picker = await screen.findByRole('combobox')
    await userEvent.click(picker)
    await userEvent.click(await screen.findByRole('option', { name: 'Original title' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Display title')).toHaveValue('Original title')
    })

    fireEvent.change(screen.getByLabelText('Display title'), { target: { value: 'Edited title' } })
    const temperature = screen.getByLabelText('Temperature')
    expect(temperature).not.toHaveAttribute('min')
    expect(temperature).not.toHaveAttribute('max')
    expect(temperature).toHaveAttribute('step', 'any')
    fireEvent.change(temperature, { target: { value: '3' } })
    await userEvent.click(screen.getByRole('button', { name: /save template/i }))

    await waitFor(() => {
      expect(putCalls.some((call) => call.url.endsWith('/api/enhanced/prompts/future-template'))).toBe(true)
    })
    const call = putCalls.find((entry) => entry.url.endsWith('/api/enhanced/prompts/future-template'))
    const body = call?.body as {
      title: string
      metadata: { owner: string; revision: number }
      future_field: { enabled: boolean }
      parameters: { temperature: number; provider_option: string }
    }
    expect(body.title).toBe('Edited title')
    expect(body.metadata).toEqual(EXISTING_TEMPLATE_DETAIL.metadata)
    expect(body.future_field).toEqual(EXISTING_TEMPLATE_DETAIL.future_field)
    expect(body.parameters.temperature).toBe(3)
    expect(body.parameters.provider_option).toBe('retain-me')
  })

  it('discards a slower model detail response after the user selects another model', async () => {
    const firstDetail = deferred<Response>()
    const secondDetail = deferred<Response>()
    const detailSignals: AbortSignal[] = []
    const models = [
      { id: 'model-a', provider: 'openai' },
      { id: 'model-b', provider: 'openai' },
    ]
    mockFetch({
      models: () => jsonResponse(models),
      modelDetail: (url, init) =>
        delayedDetailResponse(url, init, 'model-a', firstDetail, secondDetail, detailSignals),
    })
    render(<LLMTemplatesView />)

    await screen.findByText('model-a')
    await userEvent.click(screen.getByText('model-a'))
    await userEvent.click(screen.getByText('model-b'))
    expect(detailSignals).toHaveLength(1)
    expect(detailSignals[0].aborted).toBe(true)
    await act(async () => {
      secondDetail.resolve(jsonResponse({ id: 'model-b', provider: 'openai', context_window: 222 }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Context Window')).toHaveValue(222)
    })

    await act(async () => {
      firstDetail.resolve(jsonResponse({ id: 'model-a', provider: 'openai', context_window: 111 }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Context Window')).toHaveValue(222)
    })
  })

  it('discards a slower template detail response after the user selects another template', async () => {
    const firstDetail = deferred<Response>()
    const secondDetail = deferred<Response>()
    const detailSignals: AbortSignal[] = []
    const summaries = [
      { ...EXISTING_TEMPLATE_SUMMARY, name: 'template-a', title: 'Template A' },
      { ...EXISTING_TEMPLATE_SUMMARY, name: 'template-b', title: 'Template B' },
    ]
    mockFetch({
      prompts: () => jsonResponse(summaries),
      templateDetail: (url, init) =>
        delayedDetailResponse(url, init, '/template-a', firstDetail, secondDetail, detailSignals),
    })
    render(<LLMTemplatesView />)

    const picker = await screen.findByRole('combobox')
    await userEvent.click(picker)
    await userEvent.click(await screen.findByRole('option', { name: 'Template A' }))
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Template B' }))
    expect(detailSignals).toHaveLength(1)
    expect(detailSignals[0].aborted).toBe(true)
    await act(async () => {
      secondDetail.resolve(jsonResponse({ ...EXISTING_TEMPLATE_DETAIL, title: 'Template B' }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Display title')).toHaveValue('Template B')
    })

    await act(async () => {
      firstDetail.resolve(jsonResponse({ ...EXISTING_TEMPLATE_DETAIL, title: 'Template A' }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Display title')).toHaveValue('Template B')
    })
  })
})
