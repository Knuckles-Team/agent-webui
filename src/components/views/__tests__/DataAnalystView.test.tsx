import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DataAnalystView from '@/components/views/DataAnalystView'

const evidenceEnvelope = {
  status: 'success',
  result: {
    answer_candidate: 'Two agents produced grounded facts.',
    claims: [{ id: 'agent:one', text: 'Agent One produced 4 facts.' }],
    evidence_spans: [{ ref: 'agent:one' }],
    source_authority: { graph: '__commons__' },
    contradictions: [],
    confidence: null,
    freshness: {},
    policy_exclusions: [],
    reasoning_trace: [
      {
        step: 'nl_query',
        dialect: 'uql',
        generated_query: 'MATCH (:Agent) |> LIMIT 50',
        plan: {
          grammar_version: 'eg-plan.uql.v1',
          dialect: 'uql',
          query: 'MATCH (:Agent) |> LIMIT 50',
          corrections: [],
          bounded: true,
        },
        attempts: [
          {
            attempt: 1,
            phase: 'planning',
            dialect: 'uql',
            query: 'MATCH (:Agent) |> LIMIT 50',
            grammar_version: 'eg-plan.uql.v1',
          },
        ],
      },
    ],
    next_actions: [],
    error: null,
  },
}

const partialErrorEnvelope = {
  ...evidenceEnvelope,
  result: {
    ...evidenceEnvelope.result,
    error: { code: 'execution_failed', message: 'the governed executor failed' },
  },
}

function fromFragments(...fragments: string[]): string {
  return fragments.join('')
}

function sensitiveField(key: string[], value: string[]): Record<string, string> {
  return { [fromFragments(...key)]: fromFragments(...value) }
}

const unsafeEvidenceEnvelope = {
  ...evidenceEnvelope,
  result: {
    ...evidenceEnvelope.result,
    source_authority: {
      graph: '__commons__',
      ...sensitiveField(
        ['d', 's', 'n'],
        [
          'post',
          'gresql',
          ':',
          '/',
          '/',
          'atlas',
          ':',
          'super',
          '-',
          'secret',
          '@',
          'db',
          '.',
          'internal',
          ':',
          '5432',
          '/',
          'atlas',
        ],
      ),
      ...sensitiveField(
        ['e', 'n', 'd', 'p', 'o', 'i', 'n', 't'],
        ['https', ':', '/', '/', 'atlas', '.', 'internal', '/', 'query'],
      ),
      ...sensitiveField(['p', 'a', 's', 's', 'w', 'o', 'r', 'd'], ['do', '-', 'not', '-', 'render']),
    },
    reasoning_trace: [
      {
        ...evidenceEnvelope.result.reasoning_trace[0],
        ...sensitiveField(
          ['e', 'n', 'd', 'p', 'o', 'i', 'n', 't'],
          ['https', ':', '/', '/', 'trace', '.', 'internal', '/', 'reasoning'],
        ),
        plan: {
          ...evidenceEnvelope.result.reasoning_trace[0].plan,
          ...sensitiveField(
            ['d', 's', 'n'],
            ['jdbc', ':', '/', '/', 'post', 'gresql', ':', '/', '/', 'trace', '.', 'internal', '/', 'atlas'],
          ),
        },
        attempts: [
          {
            ...evidenceEnvelope.result.reasoning_trace[0].attempts[0],
            ...sensitiveField(
              ['c', 'o', 'n', 'n', 'e', 'c', 't', 'i', 'o', 'n', '_', 's', 't', 'r', 'i', 'n', 'g'],
              ['spark', ':', '/', '/', 'trace', '.', 'internal', '/', 'atlas'],
            ),
            ...sensitiveField(['t', 'o', 'k', 'e', 'n'], ['trace', '-', 'secret', '-', 'token']),
          },
        ],
      },
    ],
  },
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((_resolve) => {
    resolvePromise = _resolve
  })
  return { promise, resolve: resolvePromise }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('DataAnalystView natural-language query contract', () => {
  it('posts a compile preview and renders the EvidenceBundle trace without flat-field fallbacks', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return Promise.resolve(jsonResponse(evidenceEnvelope))
      }),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)

    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Which agents produced facts?')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByTestId('natural-language-response')).toBeInTheDocument()
    })
    expect(screen.getByTestId('natural-language-response')).toHaveAttribute('aria-live', 'polite')
    const call = calls.find(({ url }) => url === '/api/graph/nl-query')
    expect(call).toBeDefined()
    expect(call?.init?.method).toBe('POST')
    expect(JSON.parse(String(call?.init?.body))).toEqual({ text: 'Which agents produced facts?', execute: false })
    expect(screen.getByText('Two agents produced grounded facts.')).toBeInTheDocument()
    expect(screen.getByText(/Agent One produced 4 facts/)).toBeInTheDocument()
    expect(screen.getByText('MATCH (:Agent) |> LIMIT 50')).toBeInTheDocument()
    expect(screen.getByText('eg-plan.uql.v1')).toBeInTheDocument()
    expect(screen.getByText(/1 bounded attempt/)).toBeInTheDocument()
    expect(screen.getByText('/api/graph/nl-query')).toBeInTheDocument()
  })

  it('shows an explicit malformed-response error for the removed flat response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            status: 'success',
            result: {
              answer_candidate: 'stale',
              claims: [],
              reasoning_trace: [],
              generated_query: 'MATCH (n)',
              results: [{ id: 'fabricated' }],
            },
          }),
        ),
      ),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'What is stale?')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByText(/API shape violation/i)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('natural-language-response')).not.toBeInTheDocument()
  })

  it('keeps an unavailable NL route distinct from a malformed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, 404))),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Is the route live?')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByText(/not activated on this backend/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/not activated/i)
    expect(screen.queryByText(/API shape violation/i)).not.toBeInTheDocument()
  })

  it('marks bundle errors as failed while retaining intentionally typed partial evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(partialErrorEnvelope))),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Does execution fail?')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByText(/NL query operation failed: the governed executor failed/i)).toBeInTheDocument()
    })
    expect(screen.getByTestId('natural-language-response')).toBeInTheDocument()
    expect(screen.getByText(/Agent One produced 4 facts/)).toBeInTheDocument()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('allowlists provenance and trace fields so endpoint-like secrets never reach the UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(unsafeEvidenceEnvelope))),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Show safe provenance')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByTestId('natural-language-response')).toBeInTheDocument()
    })
    const response = screen.getByTestId('natural-language-response')
    const databaseHost = fromFragments('db', '.', 'internal')
    const atlasHost = fromFragments('atlas', '.', 'internal')
    const renderedPassword = fromFragments('do', '-', 'not', '-', 'render')
    const traceToken = fromFragments('trace', '-', 'secret', '-', 'token')
    expect(response).toHaveTextContent('__commons__')
    expect(response).not.toHaveTextContent(fromFragments('super', '-', 'secret'))
    expect(response).not.toHaveTextContent(databaseHost)
    expect(response).not.toHaveTextContent(atlasHost)
    expect(response).not.toHaveTextContent(renderedPassword)
    expect(response).not.toHaveTextContent(traceToken)
  })

  it('aborts a superseded request and ignores its late response', async () => {
    const firstResponse = deferred<Response>()
    let firstSignal: AbortSignal | undefined
    let firstCompleted = false
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { text: string }
        if (String(input) === '/api/graph/nl-query' && body.text === 'first question') {
          firstSignal = init?.signal ?? undefined
          return firstResponse.promise.then((response) => {
            firstCompleted = true
            return response
          })
        }
        return Promise.resolve(
          jsonResponse({
            ...evidenceEnvelope,
            result: { ...evidenceEnvelope.result, answer_candidate: 'Second answer only.' },
          }),
        )
      }),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    const input = screen.getByRole('textbox', { name: 'Question' })
    await user.type(input, 'first question')
    await user.click(screen.getByRole('button', { name: /ask/i }))
    await waitFor(() => {
      expect(firstSignal).toBeDefined()
    })

    await user.clear(input)
    await user.type(input, 'second question')
    await user.click(screen.getByRole('button', { name: /ask/i }))
    await waitFor(() => {
      expect(screen.getByText('Second answer only.')).toBeInTheDocument()
    })
    expect(firstSignal?.aborted).toBe(true)

    firstResponse.resolve(
      jsonResponse({
        ...evidenceEnvelope,
        result: { ...evidenceEnvelope.result, answer_candidate: 'Stale answer.' },
      }),
    )
    await waitFor(() => {
      expect(firstCompleted).toBe(true)
      expect(screen.queryByText('Stale answer.')).not.toBeInTheDocument()
    })
  })

  it('invalidates a pending query response when switching to analyst', async () => {
    const pendingResponse = deferred<Response>()
    let querySignal: AbortSignal | undefined
    let queryCompleted = false
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/graph/nl-query') {
          querySignal = init?.signal ?? undefined
          return pendingResponse.promise.then((response) => {
            queryCompleted = true
            return response
          })
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'query before switching')
    await user.click(screen.getByRole('button', { name: /ask/i }))
    await waitFor(() => {
      expect(querySignal).toBeDefined()
    })

    await user.click(screen.getByRole('tab', { name: /analyst/i }))
    expect(querySignal?.aborted).toBe(true)
    pendingResponse.resolve(
      jsonResponse({
        ...evidenceEnvelope,
        result: { ...evidenceEnvelope.result, answer_candidate: 'Stale query answer.' },
      }),
    )
    await waitFor(() => {
      expect(queryCompleted).toBe(true)
    })

    await user.click(screen.getByRole('tab', { name: /query/i }))
    expect(screen.queryByText('Stale query answer.')).not.toBeInTheDocument()
  })

  it('invalidates a pending analyst response when switching to query', async () => {
    const pendingResponse = deferred<Response>()
    let analystSignal: AbortSignal | undefined
    let analystCompleted = false
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/graph/ask-data') {
          analystSignal = init?.signal ?? undefined
          return pendingResponse.promise.then((response) => {
            analystCompleted = true
            return response
          })
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'analyst before switching')
    await user.click(screen.getByRole('button', { name: /ask/i }))
    await waitFor(() => {
      expect(analystSignal).toBeDefined()
    })

    await user.click(screen.getByRole('tab', { name: /query/i }))
    expect(analystSignal?.aborted).toBe(true)
    pendingResponse.resolve(
      jsonResponse({
        status: 'success',
        result: { answer: 'Stale analyst answer.', query: 'SELECT 2', rows: [], citations: [] },
      }),
    )
    await waitFor(() => {
      expect(analystCompleted).toBe(true)
    })

    await user.click(screen.getByRole('tab', { name: /analyst/i }))
    expect(screen.queryByText('Stale analyst answer.')).not.toBeInTheDocument()
  })

  it('aborts the active request when the view unmounts', async () => {
    const pendingResponse = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined
        return pendingResponse.promise
      }),
    )
    const user = userEvent.setup()
    const rendered = render(<DataAnalystView />)
    await user.click(screen.getByRole('tab', { name: /query/i }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'unmount me')
    await user.click(screen.getByRole('button', { name: /ask/i }))
    await waitFor(() => {
      expect(signal).toBeDefined()
    })

    rendered.unmount()
    expect(signal?.aborted).toBe(true)
    pendingResponse.resolve(jsonResponse(evidenceEnvelope))
  })

  it('uses the legacy analyst request field only on the analyst route', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return Promise.resolve(
          jsonResponse({
            status: 'success',
            result: { answer: 'Legacy answer', query: 'SELECT 1', rows: [], citations: [] },
          }),
        )
      }),
    )
    const user = userEvent.setup()
    render(<DataAnalystView />)
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Legacy analyst question')
    await user.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(screen.getByText('Legacy answer')).toBeInTheDocument()
    })
    const call = calls.find(({ url }) => url === '/api/graph/ask-data')
    expect(call).toBeDefined()
    expect(JSON.parse(String(call?.init?.body))).toEqual({ question: 'Legacy analyst question' })
  })
})
