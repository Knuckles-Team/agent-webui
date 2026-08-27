import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import Chat from '@/Chat'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { PageContextEnvelope } from '@/lib/page-context'

/**
 * Characterization coverage for `handleSlashCommand` (WC1-WEB-01). No prior
 * test in this repo exercised this function at all, so these tests pin its
 * OBSERVED behaviour against the unmodified source before any refactor, one
 * assertion per switch arm. Must remain byte-identical and green through
 * the refactor commit.
 */

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

let fetchImpl: (path: string) => Promise<Response> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  fetchImpl = () => undefined

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const path = url.replace(/^https?:\/\/[^/]+/, '')

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

async function sendSlashCommand(text: string) {
  const { user } = renderWithProviders(<Chat pageContext={pageContext} />)
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: /message input/i })).toBeInTheDocument()
  })
  const textarea = screen.getByRole('textbox', { name: /message input/i })
  await user.type(textarea, `${text}{Enter}`)
  return { user, textarea }
}

describe('Chat handleSlashCommand', () => {
  it('/help lists the available slash commands', async () => {
    await sendSlashCommand('/help')
    await waitFor(() => {
      expect(screen.getByText(/Agent WebUI Slash Commands/i)).toBeInTheDocument()
    })
    expect(screen.getByText((_, el) => el?.tagName === 'CODE' && el.textContent === '/mode')).toBeInTheDocument()
  })

  it('/clear wipes messages and the input, without appending a reply', async () => {
    await sendSlashCommand('/clear')
    await waitFor(() => {
      const textarea = screen.getByRole('textbox', { name: /message input/i }) as HTMLTextAreaElement
      expect(textarea.value).toBe('')
    })
    expect(screen.queryByText(/Agent WebUI Slash Commands/i)).not.toBeInTheDocument()
  })

  it('/new starts a fresh conversation with a welcome message', async () => {
    await sendSlashCommand('/new')
    await waitFor(() => {
      expect(screen.getByText(/Started a fresh conversation/i)).toBeInTheDocument()
    })
  })

  it('/new with an unmatched model keeps the active model and says so', async () => {
    await sendSlashCommand('/new totally-unknown-model')
    await waitFor(() => {
      expect(screen.getByText(/not found, keeping active model/i)).toBeInTheDocument()
    })
  })

  it('/tools lists the tools available for the active model', async () => {
    await sendSlashCommand('/tools')
    await waitFor(() => {
      expect(screen.getByText(/Available Tools for/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Search')).toBeInTheDocument()
  })

  it('/model with no argument reports the active model', async () => {
    await sendSlashCommand('/model')
    await waitFor(() => {
      expect(screen.getByText(/Active Model:/i)).toBeInTheDocument()
    })
  })

  it('/model with an unmatched name reports not found', async () => {
    await sendSlashCommand('/model no-such-model')
    await waitFor(() => {
      expect(screen.getByText(/not found\. Available models:/i)).toBeInTheDocument()
    })
  })

  it('/mode with no argument reports the active mode', async () => {
    await sendSlashCommand('/mode')
    await waitFor(() => {
      expect(screen.getByText(/Active agent interaction mode:/i)).toBeInTheDocument()
    })
  })

  it('/mode with an invalid value reports the error', async () => {
    await sendSlashCommand('/mode not-a-real-mode')
    await waitFor(() => {
      expect(screen.getByText(/Valid options are:/i)).toBeInTheDocument()
    })
  })

  it('/mode with a valid value switches modes', async () => {
    await sendSlashCommand('/mode plan')
    await waitFor(() => {
      expect(screen.getByText(/Interaction mode switched to/i)).toBeInTheDocument()
    })
    expect(screen.getByText('plan')).toBeInTheDocument()
  })

  it('/system renders the fetched system prompt', async () => {
    fetchImpl = (path) => {
      if (path.startsWith('/api/enhanced/system')) {
        return Promise.resolve(jsonResponse({ system_prompt: 'You are a helpful agent.' }))
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/system')
    await waitFor(() => {
      expect(screen.getByText(/You are a helpful agent\./)).toBeInTheDocument()
    })
  })

  it('/system reports a failure when the fetch is not ok', async () => {
    fetchImpl = (path) => {
      if (path.startsWith('/api/enhanced/system')) {
        return Promise.resolve(jsonResponse({}, false))
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/system')
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch active system prompt/i)).toBeInTheDocument()
    })
  })

  it('/prompt with no argument lists registered prompt profiles', async () => {
    fetchImpl = (path) => {
      if (path.startsWith('/api/enhanced/prompts')) {
        return Promise.resolve(jsonResponse([{ name: 'mobile_programmer', title: 'Mobile Programmer' }]))
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/prompt')
    await waitFor(() => {
      expect(screen.getByText(/Registered Prompt Profiles/i)).toBeInTheDocument()
    })
  })

  it('/prompt with a name fetches and renders that profile', async () => {
    fetchImpl = (path) => {
      if (path === '/api/enhanced/prompts/mobile_programmer') {
        return Promise.resolve(
          jsonResponse({ title: 'Mobile Programmer', goal: 'Ship mobile code.', core_directive: 'Be concise.' }),
        )
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/prompt mobile_programmer')
    await waitFor(() => {
      expect(screen.getByText(/Prompt Profile:/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Ship mobile code\./)).toBeInTheDocument()
  })

  it('an unrecognized command is executed server-side and its markdown reply rendered', async () => {
    fetchImpl = (path) => {
      if (path === '/api/enhanced/commands/execute') {
        return Promise.resolve(
          jsonResponse({ response_markdown: 'Server handled the graph stats command.', client_actions: [] }),
        )
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/graph stats')
    await waitFor(() => {
      expect(screen.getByText(/Server handled the graph stats command\./)).toBeInTheDocument()
    })
  })

  it('an unrecognized command reports a gateway failure when the request is not ok', async () => {
    fetchImpl = (path) => {
      if (path === '/api/enhanced/commands/execute') {
        return Promise.resolve(jsonResponse({}, false))
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/unknown-thing')
    await waitFor(() => {
      expect(screen.getByText(/on the gateway server\./i)).toBeInTheDocument()
    })
  })

  it('a server-returned set_model client action switches the active model', async () => {
    fetchImpl = (path) => {
      if (path === '/api/enhanced/commands/execute') {
        return Promise.resolve(
          jsonResponse({
            response_markdown: 'Switched.',
            client_actions: [{ action: 'set_model', value: 'model-b' }],
          }),
        )
      }
      return undefined as unknown as Promise<Response>
    }
    const { user, textarea } = await sendSlashCommand('/whatever')
    await waitFor(() => {
      expect(screen.getByText(/Switched\./)).toBeInTheDocument()
    })

    await user.type(textarea, '/model{Enter}')
    await waitFor(() => {
      expect(screen.getByText(/Active Model:/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText('Model B').length).toBeGreaterThan(0)
  })

  it('BUG: a server-returned clear_chat client action does NOT wipe the conversation', async () => {
    // Pins an observed defect, not fixed here (see lane report): `clear_chat`
    // calls `setMessages([])` mid-branch, but the unconditional
    // `setMessages([...messages, userMsg, replyMsg])` that runs right after
    // the switch (using the stale pre-command `messages` closure) overwrites
    // it in the same tick, so the reply -- and the clear -- never actually
    // takes visible effect.
    fetchImpl = (path) => {
      if (path === '/api/enhanced/commands/execute') {
        return Promise.resolve(
          jsonResponse({
            response_markdown: 'Clearing now.',
            client_actions: [{ action: 'clear_chat' }],
          }),
        )
      }
      return undefined as unknown as Promise<Response>
    }
    await sendSlashCommand('/whatever')
    await waitFor(() => {
      expect(screen.getByText(/Clearing now\./)).toBeInTheDocument()
    })
  })
})
