import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MCPProvider, useMCP } from '@/lib/mcp-context'

function ToolsProbe() {
  const { tools, totalTools, isLoadingTools, toolsError, catalogStatus, reloadTools } = useMCP()
  return (
    <>
      <pre data-testid="mcp-tools-probe">
        {JSON.stringify({ tools, totalTools, isLoadingTools, toolsError, catalogStatus })}
      </pre>
      <button type="button" data-testid="mcp-tools-reload" onClick={reloadTools}>
        reload
      </button>
    </>
  )
}

function readProbe(): {
  tools: unknown
  totalTools: number | null
  isLoadingTools: boolean
  toolsError: string | null
  catalogStatus: string
} {
  return JSON.parse(screen.getByTestId('mcp-tools-probe').textContent ?? '{}') as {
    tools: unknown
    totalTools: number | null
    isLoadingTools: boolean
    toolsError: string | null
    catalogStatus: string
  }
}

function jsonResponse(status: number, body: unknown, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(statusText),
  } as unknown as Response
}

describe('MCPProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the shared provider mounted without probing the catalog when disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider enabled={false}>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('idle')
    })
    expect(readProbe().isLoadingTools).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts loading immediately, then reports the real catalog fetched from the governed BFF route (BUG-010)', async () => {
    const tools = [{ name: 'graph_search', description: 'Search the graph', input_schema: {}, enabled: true }]
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        tools,
        total: 17,
        offset: 0,
        limit: 200,
        has_more: true,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    // Loading starts synchronously with the effect -- never a silent stuck `false`.
    expect(readProbe().isLoadingTools).toBe(true)
    expect(readProbe().catalogStatus).toBe('loading')

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('available')
    })

    const probe = readProbe()
    expect(probe.tools).toEqual(tools)
    expect(probe.totalTools).toBe(17)
    expect(probe.isLoadingTools).toBe(false)
    expect(probe.toolsError).toBeNull()
    // Paginated route: the client asks for its whole documented page budget
    // (MAX_CATALOG_TOOLS) rather than letting the backend's smaller default
    // silently narrow the catalog to its alphabetically-first slice.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enhanced/mcp/servers/graph-os/tools?limit=200',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    )
  })

  it('settles to an explicit "unavailable" status (never a fabricated catalog) when the backend delegation is not configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(501, {}, 'Governed MCP inventory delegation is not configured'))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('unavailable')
    })

    const probe = readProbe()
    expect(probe.tools).toBeNull()
    expect(probe.totalTools).toBeNull()
    expect(probe.isLoadingTools).toBe(false)
    expect(typeof probe.toolsError).toBe('string')
    expect(probe.toolsError).toContain('501')
  })

  it('settles to "error" (distinct from a backend refusal) on a network-level transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('error')
    })

    const probe = readProbe()
    expect(probe.tools).toBeNull()
    expect(probe.totalTools).toBeNull()
    expect(probe.isLoadingTools).toBe(false)
    expect(probe.toolsError).toBeTruthy()
  })

  it('drops invalid entries and de-duplicates tool names, keeping the first occurrence', async () => {
    const payload = [
      { name: 'graph_search', description: 'first', input_schema: {}, enabled: true },
      { name: 'graph_search', description: 'second (dropped as a duplicate)', input_schema: {}, enabled: false },
      null,
      'not-a-tool',
      { name: 'missing_fields' },
      { name: '', description: 'empty name is invalid', input_schema: {}, enabled: true },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('available')
    })

    const probe = readProbe() as unknown as { tools: { name: string; description: string }[] }
    expect(probe.tools).toHaveLength(1)
    expect(probe.tools[0]).toMatchObject({ name: 'graph_search', description: 'first' })
  })

  it('caps the catalog at 200 tools (the lane bounded per-page budget)', async () => {
    const huge = Array.from({ length: 250 }, (_, index) => ({
      name: `tool_${String(index)}`,
      description: '',
      input_schema: {},
      enabled: true,
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, huge))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('available')
    })

    const probe = readProbe() as unknown as { tools: unknown[]; totalTools: number | null }
    expect(probe.tools).toHaveLength(200)
    expect(probe.totalTools).toBe(250)
  })

  it('reloads through the shared provider and publishes the newest catalog only', async () => {
    const firstTools = [{ name: 'first', description: '', input_schema: {}, enabled: true }]
    const secondTools = [{ name: 'second', description: '', input_schema: {}, enabled: true }]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tools: firstTools, total: 4 }))
      .mockResolvedValueOnce(jsonResponse(200, { tools: secondTools, total: 9 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().tools).toEqual(firstTools)
    })
    fireEvent.click(screen.getByTestId('mcp-tools-reload'))
    await waitFor(() => {
      expect(readProbe().tools).toEqual(secondTools)
      expect(readProbe().totalTools).toBe(9)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts the in-flight catalog request when the provider unmounts', () => {
    const abortListener = vi.fn()
    // Never resolves -- proves the unmount aborts the request rather than
    // racing a resolved response.
    const neverSettle = (): void => undefined
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', abortListener)
      return new Promise<Response>(neverSettle)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )
    unmount()

    expect(abortListener).toHaveBeenCalledTimes(1)
  })

  it('re-fetches for a new server and never lets a stale in-flight response overwrite the current one', async () => {
    let resolveFirst: ((value: Response) => void) | undefined
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const secondTools = [{ name: 'other_server_tool', description: '', input_schema: {}, enabled: true }]
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce(jsonResponse(200, secondTools))
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <MCPProvider server="server-a">
        <ToolsProbe />
      </MCPProvider>,
    )

    rerender(
      <MCPProvider server="server-b">
        <ToolsProbe />
      </MCPProvider>,
    )

    await waitFor(() => {
      expect(readProbe().catalogStatus).toBe('available')
    })
    expect(readProbe().tools).toEqual(secondTools)

    // The stale first-server response landing late must not clobber the
    // already-settled second-server catalog.
    resolveFirst?.(jsonResponse(200, [{ name: 'stale_tool', description: '', input_schema: {}, enabled: true }]))
    await Promise.resolve()
    expect(readProbe().tools).toEqual(secondTools)
  })

  it('throws when useMCP is called outside a provider', () => {
    // Suppress the expected React error-boundary console noise for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<ToolsProbe />)).toThrow('useMCP must be used within MCPProvider')
    spy.mockRestore()
  })
})
