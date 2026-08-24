/**
 * 1:1 AgentConfig form: the field list, types, and dropdowns must come from
 * `GET /api/enhanced/config/schema` (`AgentConfig.model_json_schema()`),
 * never a hand-maintained list, and a literal-secret-shaped field must never
 * render or round-trip a value. Matches the repo's mocked-`fetch`
 * view-level-test convention (see LLMTemplatesView.test.tsx).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfigurationView from '@/components/views/ConfigurationView'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// A trimmed-but-real shape of what `AgentConfig.model_json_schema()` (default
// `by_alias=True`) produces: AgentConfig aliases nearly every field to an
// upper-cased env-var name, which is also how the persisted document and
// `/config/groups` key their fields -- this fixture matches that on purpose.
const AGENT_CONFIG_SCHEMA = {
  schema: {
    properties: {
      LOG_LEVEL: {
        type: 'string',
        enum: ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        title: 'Log Level',
      },
      GRAPH_TIMEOUT: { type: 'integer', title: 'Graph Timeout' },
      TLS_SYSTEM_TRUST: { type: 'boolean', title: 'Tls System Trust', default: true },
      OPENAI_API_KEY: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Openai Api Key' },
      OPENAI_API_KEY_REF: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Openai Api Key Ref' },
      chat_models: { type: 'array', items: {} },
      embedding_models: { type: 'array', items: {} },
    },
    required: [],
  },
  excluded_fields: ['chat_models', 'embedding_models'],
  secret_fields: ['OPENAI_API_KEY'],
  secret_clear_sentinel: 'mock-clear-sentinel',
}

const CONFIG_DOCUMENT = {
  LOG_LEVEL: 'INFO',
  GRAPH_TIMEOUT: 1200,
  TLS_SYSTEM_TRUST: true,
  OPENAI_API_KEY: '', // GET /config always redacts a literal secret to ''
}

const CONFIG_GROUPS = {
  fields: {
    LOG_LEVEL: 'General',
    GRAPH_TIMEOUT: 'General',
    TLS_SYSTEM_TRUST: 'TLS',
    OPENAI_API_KEY: 'Provider API Keys',
  },
}

const SECRET_STATUS = { fields: { OPENAI_API_KEY: true } }

function mockFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  const putCalls: { url: string; body: unknown }[] = []
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (init?.method === 'PUT') {
      putCalls.push({ url, body: init.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(overrides.put ? overrides.put() : jsonResponse({ status: 'success' }))
    }
    if (url.includes('/config/schema')) {
      return Promise.resolve(overrides.schema ? overrides.schema() : jsonResponse(AGENT_CONFIG_SCHEMA))
    }
    if (url.includes('/config/groups')) {
      return Promise.resolve(overrides.groups ? overrides.groups() : jsonResponse(CONFIG_GROUPS))
    }
    if (url.includes('/config/secret-status')) {
      return Promise.resolve(overrides.secretStatus ? overrides.secretStatus() : jsonResponse(SECRET_STATUS))
    }
    if (url.includes('/api/enhanced/config')) {
      return Promise.resolve(overrides.config ? overrides.config() : jsonResponse(CONFIG_DOCUMENT))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
  return putCalls
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ConfigurationView (1:1 AgentConfig form)', () => {
  it('renders schema-derived controls: an enum dropdown, a boolean switch, and a number field', async () => {
    mockFetch()
    render(<ConfigurationView />)

    // Grouped fields live inside collapsed sections -- open "General" (2 fields) and "TLS" (1 field).
    const generalTrigger = await screen.findByText('General')
    await userEvent.click(generalTrigger)
    const tlsTrigger = await screen.findByText('TLS')
    await userEvent.click(tlsTrigger)

    const logLevelSelect = (await screen.findByDisplayValue('INFO')) as HTMLSelectElement
    expect(logLevelSelect.tagName).toBe('SELECT')
    const optionValues = Array.from(logLevelSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(expect.arrayContaining(['DEBUG', 'INFO', 'WARNING', 'ERROR']))

    const timeoutInput = screen.getByDisplayValue('1200') as HTMLInputElement
    expect(timeoutInput.type).toBe('number')

    const tlsSwitch = screen.getByRole('switch', { name: /tls system trust/i })
    expect(tlsSwitch).toHaveAttribute('data-state', 'checked')
  })

  it('a literal-secret field is presence-only -- never a text box, never the value', async () => {
    mockFetch()
    render(<ConfigurationView />)

    expect(await screen.findByText('Configured (redacted)')).toBeInTheDocument()
    // The secret's own label appears once (in the Secrets card); it must
    // never be paired with an editable text input carrying the value.
    expect(screen.queryByDisplayValue(/sk-/)).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('sk-real-secret-value')
  })

  it('clearing a secret and saving sends the explicit clear sentinel, not a literal value', async () => {
    const putCalls = mockFetch()
    render(<ConfigurationView />)

    const clearButton = await screen.findByRole('button', { name: /clear/i })
    await userEvent.click(clearButton)
    expect(await screen.findByText('Will be cleared on save')).toBeInTheDocument()

    const saveButton = screen.getByRole('button', { name: /save settings/i })
    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(putCalls.some((c) => c.url.includes('/api/enhanced/config'))).toBe(true)
    })
    const call = putCalls.find((c) => c.url.includes('/api/enhanced/config'))
    const body = call?.body as Record<string, unknown>
    expect(body.OPENAI_API_KEY).toBe('mock-clear-sentinel')
  })

  it('chat_models/embedding_models are excluded with an explicit link-out, not silently dropped', async () => {
    mockFetch()
    render(<ConfigurationView />)

    expect(await screen.findByText(/chat_models, embedding_models/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open models/i })).toBeInTheDocument()
  })

  it('an unreachable schema/config renders a distinct unavailable state, not an empty form', async () => {
    mockFetch({ schema: () => jsonResponse({ detail: 'boom' }, 500) })
    render(<ConfigurationView />)

    await waitFor(() => {
      expect(screen.getByText(/could not be fetched/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/declared zero editable fields/i)).not.toBeInTheDocument()
  })

  it('a failed best-effort /config/groups degrades visibly rather than silently', async () => {
    mockFetch({ groups: () => jsonResponse({ detail: 'boom' }, 500) })
    render(<ConfigurationView />)

    await waitFor(() => {
      expect(screen.getByText(/field section grouping/i)).toBeInTheDocument()
    })
  })

  it('a failed best-effort /config/secret-status shows "Status unknown", never a fabricated Not set', async () => {
    mockFetch({ secretStatus: () => jsonResponse({ detail: 'boom' }, 500) })
    render(<ConfigurationView />)

    expect(await screen.findByText('Status unknown')).toBeInTheDocument()
    expect(screen.queryByText('Not set')).not.toBeInTheDocument()
  })
})
