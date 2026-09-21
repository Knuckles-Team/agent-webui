import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SkillsView, { catalogEntrySchema, toolsDataSchema } from '@/components/views/SkillsView'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const CATALOG = {
  source: 'epistemic_graph' as const,
  servers: [
    {
      server_id: 'server:search',
      name: 'search-mcp',
      url: 'https://search.example/mcp',
      status: 'available' as const,
      tool_count: 1,
    },
  ],
  components: [
    {
      id: 'tool:search',
      name: 'search',
      kind: 'tool' as const,
      description: 'Search indexed sources.',
      status: 'active' as const,
      authority: 'agent_component' as const,
      server_name: 'search-mcp',
      revision: 4,
      definition_digest: 'sha256:tool',
      content_digest: 'sha256:tool-content',
    },
    {
      id: 'skill:research',
      name: 'research',
      kind: 'skill' as const,
      description: 'Research a topic.',
      status: 'active' as const,
      authority: 'agent_component' as const,
      server_name: null,
      revision: 2,
      definition_digest: 'sha256:skill',
      content_digest: 'sha256:skill-content',
    },
    {
      id: 'workflow:review',
      name: 'review',
      kind: 'workflow' as const,
      description: 'Review a proposed change.',
      status: 'active' as const,
      authority: 'workflow_catalog' as const,
      server_name: null,
      revision: null,
      definition_digest: null,
      content_digest: null,
    },
  ],
  counts: { servers: 1, tools: 1, skills: 1, workflows: 1 },
}

function mockFetch(body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
}

describe('SkillsView catalog contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts the provenance-bearing GraphOS catalog projection', () => {
    const parsed = toolsDataSchema.parse(CATALOG)
    expect(parsed.source).toBe('epistemic_graph')
    expect(parsed.counts).toEqual({ servers: 1, tools: 1, skills: 1, workflows: 1 })
    expect(parsed.components[0]).toMatchObject({
      kind: 'tool',
      authority: 'agent_component',
      revision: 4,
      definition_digest: 'sha256:tool',
    })
  })

  it('rejects the removed filesystem/builtin aggregation shape', () => {
    expect(() =>
      toolsDataSchema.parse({
        mcp_tools: [],
        builtin_tools: [],
        skills: [],
        skill_graphs: [],
        skill_workflows: [],
      }),
    ).toThrow()
  })

  it('keeps workflow authority distinct from AgentComponent authority', () => {
    expect(
      catalogEntrySchema.parse({
        id: 'workflow:review',
        name: 'review',
        kind: 'workflow',
        description: 'Review changes.',
        status: 'active',
        authority: 'workflow_catalog',
      }).authority,
    ).toBe('workflow_catalog')
  })

  it('renders tools, skills, and workflows without a built-in or skill-graph bucket', async () => {
    vi.stubGlobal('fetch', mockFetch(CATALOG))
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Component Catalog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Component Catalog'))
    await waitFor(() => {
      expect(screen.getByText('research')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { level: 3, name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Workflows' })).toBeInTheDocument()
    expect(screen.queryByText('Built-in Tools')).not.toBeInTheDocument()
    expect(screen.queryByText('Skill Graphs')).not.toBeInTheDocument()
  })
})

describe('SkillsView MCP server catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not load server tools until the live server is expanded', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/enhanced/mcp/servers/search-mcp/tools')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tools: [{ name: 'search', description: 'Search', input_schema: {}, enabled: true }],
              total: 1,
              offset: 0,
              limit: 100,
              has_more: false,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(CATALOG), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('search-mcp')).toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/search-mcp/tools'))).toBe(false)
    fireEvent.click(screen.getByText('Manage MCP Tools'))
    await waitFor(() => {
      expect(screen.getByText('Search')).toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/search-mcp/tools'))).toBe(true)
  })

  it('shows a truthful empty state when the authoritative catalog has no registrations', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...CATALOG, servers: [], counts: { ...CATALOG.counts, servers: 0 } }))
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('No MCP servers registered.')).toBeInTheDocument()
    })
    expect(screen.getByText(/authoritative fleet catalog has no live server registrations/)).toBeInTheDocument()
  })
})
