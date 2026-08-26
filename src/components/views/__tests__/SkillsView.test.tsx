import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SkillsView, {
  skillSchema,
  skillGraphSchema,
  skillWorkflowSchema,
  toolsDataSchema,
} from '@/components/views/SkillsView'

/**
 * GOC-60-W06c/d coverage for SkillsView:
 *
 * 1. A zod round-trip test proving `domain`/`tags`/`runnable`/`resource_type`/
 *    `kg_classified` actually survive backend-shaped JSON through the zod
 *    boundary. Before this fix, `SkillGraph`/`SkillWorkflow` kept only
 *    `{id, name, type, file_path, enabled}` and `Skill` had no `domain` at
 *    all, so zod's default key-stripping silently dropped everything else
 *    the backend already sent (`_parse_skill_md` extracts `domain`/`tags`
 *    for every SKILL.md).
 * 2. A render test proving the cognitive registry groups by `domain` instead
 *    of rendering one flat unsectioned list, and that a describe-only
 *    workflow reads as "Describe-only" while a KG-verified skill reads as
 *    "Runnable" -- runnability shown explicitly, not implied by which box
 *    it's in.
 */

describe('SkillsView zod schemas — domain/tags/runnable round-trip (GOC-60-W06c)', () => {
  it('skillSchema keeps domain, tags, runnable, resource_type, and kg_classified', () => {
    const raw = {
      id: 'gitlab-issues',
      name: 'gitlab-issues',
      description: 'Manage GitLab issues.',
      enabled: true,
      tags: ['gitlab', 'issues'],
      domain: 'devops',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    }
    const parsed = skillSchema.parse(raw)
    expect(parsed.domain).toBe('devops')
    expect(parsed.tags).toEqual(['gitlab', 'issues'])
    expect(parsed.runnable).toBe(true)
    expect(parsed.resource_type).toBe('AGENT_SKILL')
    expect(parsed.kg_classified).toBe(true)
  })

  it('skillGraphSchema keeps domain and tags (previously absent from the type entirely)', () => {
    const raw = {
      id: 'skill-graph:finance-pipeline',
      name: 'finance-pipeline',
      type: 'Skill Graph',
      file_path: 'skill://finance-pipeline',
      enabled: true,
      domain: 'finance',
      tags: ['pipeline', 'quant'],
    }
    const parsed = skillGraphSchema.parse(raw)
    expect(parsed.domain).toBe('finance')
    expect(parsed.tags).toEqual(['pipeline', 'quant'])
  })

  it('skillWorkflowSchema keeps domain, tags, and the KG runnability fields', () => {
    const raw = {
      id: 'pairs-trading-project',
      name: 'pairs-trading-project',
      type: 'Skill Workflow',
      file_path: 'skill://pairs-trading-project',
      enabled: true,
      domain: 'finance-workflows',
      tags: ['quant', 'pairs-trading'],
      runnable: false,
      resource_type: 'WORKFLOW_DEFINITION',
      kg_classified: true,
    }
    const parsed = skillWorkflowSchema.parse(raw)
    expect(parsed.domain).toBe('finance-workflows')
    expect(parsed.tags).toEqual(['quant', 'pairs-trading'])
    expect(parsed.runnable).toBe(false)
    expect(parsed.resource_type).toBe('WORKFLOW_DEFINITION')
    expect(parsed.kg_classified).toBe(true)
  })

  it('toolsDataSchema round-trips the full /api/enhanced/tools payload including skill_unclassified and skill_classification', () => {
    const raw = {
      mcp_tools: [],
      mcp_status: { source: 'multiplexer', error: null },
      builtin_tools: [],
      skills: [
        {
          id: 'a',
          name: 'a',
          enabled: true,
          tags: ['x'],
          domain: 'ops',
          type: 'Agent Skill',
          runnable: true,
          resource_type: 'AGENT_SKILL',
          kg_classified: true,
        },
      ],
      skill_graphs: [],
      skill_workflows: [],
      skill_unclassified: [
        {
          id: 'b',
          name: 'b',
          enabled: true,
          tags: [],
          domain: 'never-ingested',
          type: 'Unclassified',
          runnable: false,
          resource_type: null,
          kg_classified: false,
        },
      ],
      skill_classification: {
        source: 'kg_resource_type',
        kg_reachable: true,
        filesystem_skill_md_count: 2,
        kg_agent_skill_count: 1,
        kg_workflow_definition_count: 0,
        runnable_count: 1,
        describe_only_count: 0,
        unclassified_count: 1,
      },
    }
    const parsed = toolsDataSchema.parse(raw)
    expect(parsed.skills[0]?.domain).toBe('ops')
    expect(parsed.skill_unclassified[0]?.kg_classified).toBe(false)
    expect(parsed.skill_classification.unclassified_count).toBe(1)
  })
})

function mockFetch(body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
}

const GROUPED_PAYLOAD = {
  mcp_tools: [],
  mcp_status: { source: 'multiplexer', error: null },
  builtin_tools: [],
  skills: [
    {
      id: 'finance-skill',
      name: 'finance-skill',
      description: 'A runnable finance skill.',
      enabled: true,
      tags: ['quant'],
      domain: 'finance',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    },
    {
      id: 'ops-skill',
      name: 'ops-skill',
      description: 'A runnable ops skill.',
      enabled: true,
      tags: [],
      domain: 'ops',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    },
  ],
  skill_graphs: [],
  skill_workflows: [
    {
      id: 'finance-workflow',
      name: 'finance-workflow',
      type: 'Skill Workflow',
      file_path: 'skill://finance-workflow',
      enabled: true,
      domain: 'finance',
      tags: [],
      runnable: false,
      resource_type: 'WORKFLOW_DEFINITION',
      kg_classified: true,
    },
  ],
  skill_unclassified: [],
  skill_classification: {
    source: 'kg_resource_type',
    kg_reachable: true,
    filesystem_skill_md_count: 3,
    kg_agent_skill_count: 2,
    kg_workflow_definition_count: 1,
    runnable_count: 2,
    describe_only_count: 1,
    unclassified_count: 0,
  },
}

describe('SkillsView cognitive registry — grouped by domain (GOC-60-W06d)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(GROUPED_PAYLOAD))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('groups Agent Skills by domain and shows the Cognitive Skills tab count', async () => {
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    // The default active tab is MCP Servers; switch to Cognitive Skills.
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('finance-skill')).toBeInTheDocument()
    })
    // Both domain group headers render -- proof of grouping, not a flat list.
    // "finance" appears twice (Agent Skills box + Skill Workflows box).
    expect(screen.getAllByText('finance').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('ops')).toBeInTheDocument()
    expect(screen.getByText('ops-skill')).toBeInTheDocument()
  })

  it('shows a runnable skill and a describe-only workflow distinguished explicitly', async () => {
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('finance-workflow')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Runnable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Describe-only').length).toBeGreaterThan(0)
  })
})

const MCP_SERVER_SCHEMA = {
  properties: {
    command: { type: 'string', title: 'Command' },
    url: { type: 'string', title: 'Url' },
    args: { type: 'array', items: { type: 'string' }, title: 'Args', default: [] },
    env: { type: 'object', title: 'Env', default: {} },
    transport: { type: 'string', enum: ['', 'streamable-http', 'sse'], title: 'Transport', default: '' },
    headers: { type: 'object', title: 'Headers', default: {} },
    disabled: { type: 'boolean', title: 'Disabled', default: false },
    timeout: { type: 'number', title: 'Timeout', default: 300.0 },
    allowed_private_hosts: { type: 'array', items: { type: 'string' }, title: 'Allowed private hosts', default: [] },
  },
}

const EMPTY_TOOLS_PAYLOAD = {
  ...GROUPED_PAYLOAD,
  skills: [],
  skill_workflows: [],
}

/** Routes a fetch mock by URL/method so the Add-server flow (GET /tools ->
 * GET /mcp/server-schema -> POST /mcp/servers) can be exercised end to end. */
function routedFetch(routes: { match: (url: string, init?: RequestInit) => boolean; body: unknown }[]) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(url, init))
    return Promise.resolve(new Response(JSON.stringify(route ? route.body : {}), { status: route ? 200 : 404 }))
  })
}

describe('SkillsView — Add MCP Server (schema-derived form)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the live schema and POSTs the submitted server to /api/enhanced/mcp/servers', async () => {
    const fetchMock = routedFetch([
      { match: (u) => u.includes('/api/enhanced/tools'), body: EMPTY_TOOLS_PAYLOAD },
      { match: (u) => u.includes('/api/enhanced/mcp/server-schema'), body: MCP_SERVER_SCHEMA },
      {
        match: (u, i) => u.includes('/api/enhanced/mcp/servers') && i?.method === 'POST',
        body: { status: 'success' },
      },
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Add MCP Server')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add MCP Server'))

    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'ansible-tower-mcp' } })
    fireEvent.change(screen.getByLabelText(/Url/), {
      target: { value: 'https://ansible-tower-mcp.example/mcp' },
    })
    fireEvent.click(screen.getByText('Review preflight'))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[0].includes('/api/enhanced/mcp/servers') && c[1]?.method === 'POST',
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(String((postCall?.[1] as RequestInit).body))
      expect(body.name).toBe('ansible-tower-mcp')
      expect(body.config.url).toBe('https://ansible-tower-mcp.example/mcp')
    })
  })
})

/**
 * Regression coverage for the "Manage MCP Tools" expand/collapse control
 * (the tools view's own box/panel toggle, `expandedMcp` in SkillsView).
 * Guards against the exact bug shape reported against this page -- an
 * expand handler that only ever sets state to `true`, or a stale/unkeyed
 * read that makes a second click a no-op -- by asserting a full
 * expand -> collapse -> expand -> collapse round trip, and that two
 * independent server panels don't share state. Also verified against a
 * real Chromium render (Playwright, StrictMode) during investigation; both
 * confirm the toggle is already symmetric on this code path.
 */
describe('SkillsView — Manage MCP Tools panel toggles both ways (fix/tools-collapse)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const TWO_SERVER_PAYLOAD = {
    ...GROUPED_PAYLOAD,
    skills: [],
    skill_workflows: [],
    mcp_tools: [
      { name: 'server-a', type: 'mcp', status: 'ok', enabled: true, tool_count: 1 },
      { name: 'server-b', type: 'mcp', status: 'ok', enabled: true, tool_count: 1 },
    ],
  }

  function routeTwoServerFetch() {
    return vi.fn((url: string) => {
      if (url.includes('/api/enhanced/mcp/servers/server-a/tools')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'ta1', description: 'x', input_schema: {}, enabled: true }]), {
            status: 200,
          }),
        )
      }
      if (url.includes('/api/enhanced/mcp/servers/server-b/tools')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'tb1', description: 'x', input_schema: {}, enabled: true }]), {
            status: 200,
          }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(TWO_SERVER_PAYLOAD), { status: 200 }))
    })
  }

  it('a single server panel survives expand -> collapse -> expand -> collapse', async () => {
    vi.stubGlobal('fetch', routeTwoServerFetch())
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('server-a')).toBeInTheDocument()
    })

    const buttons = screen.getAllByText('Manage MCP Tools')
    const btn = buttons[0]

    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByText('ta1')).toBeInTheDocument()
    })

    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.queryByText('ta1')).not.toBeInTheDocument()
    })

    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByText('ta1')).toBeInTheDocument()
    })

    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.queryByText('ta1')).not.toBeInTheDocument()
    })
  })

  it('collapsing one server panel does not affect an independently expanded sibling panel', async () => {
    vi.stubGlobal('fetch', routeTwoServerFetch())
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('server-a')).toBeInTheDocument()
    })
    expect(screen.getByText('server-b')).toBeInTheDocument()

    const [btnA, btnB] = screen.getAllByText('Manage MCP Tools')

    fireEvent.click(btnA)
    await waitFor(() => {
      expect(screen.getByText('ta1')).toBeInTheDocument()
    })
    fireEvent.click(btnB)
    await waitFor(() => {
      expect(screen.getByText('tb1')).toBeInTheDocument()
    })

    fireEvent.click(btnA)
    await waitFor(() => {
      expect(screen.queryByText('ta1')).not.toBeInTheDocument()
    })
    expect(screen.getByText('tb1')).toBeInTheDocument()

    fireEvent.click(btnB)
    await waitFor(() => {
      expect(screen.queryByText('tb1')).not.toBeInTheDocument()
    })
  })
})

/**
 * Defect 1 (a server with 1,131 tools cannot display them) and Defect 2
 * (skills are not organised by kind, and there is a spurious fourth column).
 *
 * Defect 1 measured live: `GET /api/enhanced/mcp/servers/arr-mcp/tools`
 * answered 503 for every one of `arr-mcp`'s 1,131 tools, because the route
 * bounded the WHOLE delegated list before slicing and the shared bound
 * rejects any collection over 256 items. The route now pages; this view must
 * lazily load ONE page on expand, state the TRUE total, and offer the rest.
 */
describe('SkillsView — MCP tool pagination (Defect 1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const BIG_SERVER_PAYLOAD = {
    ...GROUPED_PAYLOAD,
    mcp_tools: [{ name: 'arr-mcp', type: 'mcp', status: 'ok', enabled: true, tool_count: 1131 }],
  }

  function page(offset: number, size: number, total: number) {
    return {
      server: 'arr-mcp',
      tools: Array.from({ length: size }, (_unused, i) => ({
        name: `tool_${String(offset + i).padStart(4, '0')}`,
        description: 'x',
        input_schema: {},
        enabled: true,
      })),
      total,
      offset,
      limit: size,
      has_more: offset + size < total,
    }
  }

  function routeBigServer() {
    return vi.fn((url: string) => {
      if (url.includes('/api/enhanced/mcp/servers/arr-mcp/tools')) {
        const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset') ?? '0')
        return Promise.resolve(new Response(JSON.stringify(page(offset, 100, 1131)), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(BIG_SERVER_PAYLOAD), { status: 200 }))
    })
  }

  it('fetches nothing for a server until its panel is expanded', async () => {
    const fetchMock = routeBigServer()
    vi.stubGlobal('fetch', fetchMock)
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('arr-mcp')).toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/arr-mcp/tools'))).toBe(false)
  })

  it('loads one page on expand and states the true total, not the page length', async () => {
    vi.stubGlobal('fetch', routeBigServer())
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('arr-mcp')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByText('Manage MCP Tools')[0])
    await waitFor(() => {
      expect(screen.getByText('tool_0000')).toBeInTheDocument()
    })
    // "Showing 100 of 1131 tools" -- never a silently truncated list.
    expect(screen.getByText(/Showing/).textContent?.replace(/\s+/g, ' ')).toContain('Showing 100 of 1131 tools')
    expect(screen.getByText(/Load 100 more/)).toBeInTheDocument()
  })

  it('appends the next page instead of replacing the loaded one', async () => {
    vi.stubGlobal('fetch', routeBigServer())
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('arr-mcp')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByText('Manage MCP Tools')[0])
    await waitFor(() => {
      expect(screen.getByText('tool_0000')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/Load 100 more/))
    await waitFor(() => {
      expect(screen.getByText('tool_0100')).toBeInTheDocument()
    })
    // The first page is still there -- "load more", not "replace".
    expect(screen.getByText('tool_0000')).toBeInTheDocument()
  })

  it('renders a failed tool read as a stated error, never as a healthy empty server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/enhanced/mcp/servers/arr-mcp/tools')) {
          return Promise.resolve(new Response('MCP inventory unavailable', { status: 503 }))
        }
        return Promise.resolve(new Response(JSON.stringify(BIG_SERVER_PAYLOAD), { status: 200 }))
      }),
    )
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('arr-mcp')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByText('Manage MCP Tools')[0])
    await waitFor(() => {
      expect(screen.getByText(/could not be read/)).toBeInTheDocument()
    })
  })
})

describe('SkillsView — a catalog error is visible even when servers did list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows mcp_status.error above a non-empty server list', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GROUPED_PAYLOAD,
        mcp_status: { source: 'sql_catalog', error: 'The MCP fleet catalog could not be read.' },
        mcp_tools: [{ name: 'arr-mcp', type: 'mcp', status: 'ok', enabled: true, tool_count: 1131 }],
      }),
    )
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('arr-mcp')).toBeInTheDocument()
    })
    // Previously this banner lived only in the `length === 0` branch, so a
    // degraded read rendered as a healthy fleet.
    expect(screen.getByText('The MCP fleet catalog could not be read.')).toBeInTheDocument()
  })
})

describe('SkillsView — skills grouped by kind, no fourth column (Defect 2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const UNCLASSIFIED_PAYLOAD = {
    ...GROUPED_PAYLOAD,
    skill_unclassified: [
      {
        id: 'mystery-skill',
        name: 'mystery-skill',
        description: 'Kind could not be determined.',
        enabled: true,
        tags: [],
        domain: 'ops',
        type: 'Unclassified',
        runnable: false,
        resource_type: null,
        kg_classified: false,
      },
    ],
    skill_classification: { ...GROUPED_PAYLOAD.skill_classification, unclassified_count: 1 },
  }

  it('renders exactly three kind columns — skill, skill-graph, skill-workflow', async () => {
    vi.stubGlobal('fetch', mockFetch(UNCLASSIFIED_PAYLOAD))
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('Skills')).toBeInTheDocument()
    })
    expect(screen.getByText('Skill Graphs')).toBeInTheDocument()
    expect(screen.getByText('Skill Workflows')).toBeInTheDocument()
    // The owner is explicit: there is no separate "unclassified" column.
    expect(screen.queryByText('Unclassified')).not.toBeInTheDocument()
  })

  it('lists an unclassified skill among the skills, carrying an "unclassified" badge', async () => {
    vi.stubGlobal('fetch', mockFetch(UNCLASSIFIED_PAYLOAD))
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('mystery-skill')).toBeInTheDocument()
    })
    expect(screen.getByText('unclassified')).toBeInTheDocument()
  })
})
